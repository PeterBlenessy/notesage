import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * `t()` at module scope is a silent mistranslation.
 *
 * `t(key)` resolves against whatever locale is active WHEN IT RUNS. A call in
 * a module-level constant runs exactly once, at import, and the string it
 * produced is then frozen into that constant for the life of the process — so
 * the label keeps the language the app happened to start in even after the
 * user switches, and no test that renders the component in Swedish can see it
 * (the constant was built before the test set the locale).
 *
 * The fix is always the same shape: store the message KEY in the constant
 * (`labelKey: MessageKey`) and call `t(labelKey)` at render.
 * `buildSettingsNav` is the reference implementation, and
 * `settings-i18n.test.tsx` guards it by round-tripping the locale.
 *
 * This test is the general form of that guard: it parses every source file
 * that imports the i18n module and fails on a `t(...)` call that is not inside
 * a function. It exists because the trap was introduced twice after the first
 * one was fixed — in `ModelSelectionForm`, `LocalAISettings`,
 * `LocalAgentSetupDialog`, `StepEditor` and `CommitDialog` — each time as a
 * perfectly ordinary-looking lookup table, and each time invisible to review
 * until someone went looking for it by name.
 */

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `t(...)` call in `file` that sits outside any function body. */
function frozenCalls(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('@/lib/i18n')) return [];

  const src = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: string[] = [];
  const walk = (node: ts.Node, insideFunction: boolean) => {
    const opensScope =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node);

    if (
      !insideFunction &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't'
    ) {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${relative(SRC, file)}:${line + 1}: ${node.getText().slice(0, 80)}`);
    }

    ts.forEachChild(node, (child) => walk(child, insideFunction || opensScope));
  };
  ts.forEachChild(src, (child) => walk(child, false));
  return found;
}

describe('i18n: no frozen translations', () => {
  it('never calls t() at module scope', () => {
    const offenders = sourceFiles(SRC).flatMap(frozenCalls);
    expect(offenders).toEqual([]);
  });
});
