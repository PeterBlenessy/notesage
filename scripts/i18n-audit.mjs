#!/usr/bin/env node
/**
 * Find user-visible English strings that never reach the translation table.
 *
 * Deliberately conservative: it flags only things a user can read — JSX text
 * nodes and the props that render as text — and it ignores anything already
 * wrapped in t(). False negatives are fine; the point is a floor, not a census.
 *
 * Two consumers:
 *   - CLI:  `node scripts/i18n-audit.mjs src/components/settings --detail`
 *   - test: `src/lib/__tests__/i18n-coverage.test.ts` imports `scan()` and
 *           ratchets the count down. See that file for why a ceiling rather
 *           than a hard zero.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import ts from "typescript";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const TEXT_PROPS = [
  "label",
  "title",
  "placeholder",
  "aria-label",
  "description",
  "tooltip",
  "alt",
  "heading",
  "emptyText",
  "confirmLabel",
];

function walk(dir, out = []) {
  // Accept a single file as well as a directory — auditing one file while
  // translating it is the common case, and ENOTDIR is a useless error there.
  if (statSync(dir).isFile()) return [dir];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (/(__tests__|node_modules|\.git)/.test(entry)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      // `.ts` as well as `.tsx`. The native menus, action sheets and nav shell
      // are plain TypeScript — `src/components/mobile` alone holds seventeen
      // `.ts` files — and `object-title` was added precisely for that
      // non-JSX surface, so scanning only `.tsx` made the rule half blind and
      // the hard zero read broader than it was.
      out.push(full);
    }
  }
  return out;
}

// Two or more words of prose, or one capitalised word of 4+ chars.
const PROSE =
  /^[A-Z][A-Za-z]{2,}(?:[ ,'’\-—:.!?][A-Za-z0-9][A-Za-z0-9 ,'’\-—:.!?%()]*)?$/;
const SKIP = /^(true|false|null|undefined|px|rem|auto|none|div|span|button)$/i;

/**
 * Proper nouns that stay in English in every language.
 *
 * Without this the ratchet counts strings nobody can ever action, and a PR
 * that adds a provider called "Mistral AI" pushes the number up and fails a
 * test whose only sound remedy — raising the ceiling — the file forbids.
 */
const BRANDS = new Set([
  "Anthropic",
  "Claude Code",
  "OpenAI",
  "OpenAI Codex",
  "GitHub Copilot",
  "GitHub Copilot CLI",
  "Gemini CLI",
  "Notesage",
  "Ollama",
  "Hugging Face",
  "TestFlight",
  "iCloud",
  "iCloud Drive",
  "Markdown",
  "JSON",
]);

/**
 * Is this string something a user reads, rather than an id, a path or a class?
 *
 * Unchanged from the regex era, and still the only place a judgement is made:
 * the parser above decides WHERE a string is, this decides whether it is prose.
 * The length rule lives here too — putting a minimum in the matching pattern
 * once made a three-letter literal swallow its own closing quote.
 */
function looksTranslatable(s) {
  const t = s.trim();
  if (t.length < 4 || t.length > 120) return false;
  if (SKIP.test(t)) return false;
  if (BRANDS.has(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^[a-z-]+$/.test(t)) return false; // css class / kebab id
  if (/^\w+\.\w+/.test(t)) return false; // file.ext, obj.prop
  if (/^(https?:|\/|#|@)/.test(t)) return false; // urls, paths, selectors
  // A single word, with whatever punctuation it wears. The anchored `$` used
  // to reject every one of `Transcribing…`, `Saved!`, `Copied!`, `Note:` —
  // and "verb + ellipsis" is the standard idiom for an in-progress toast and
  // for a menu item that opens something. `<p>Saving…</p>` would have passed
  // a directory certified at hard zero.
  if (!/\s/.test(t) && !/^[A-Z][a-z]{3,}[…:!?.]*$/.test(t)) return false;
  // A single word wearing punctuation is prose and needs no further test —
  // `PROSE` below describes SENTENCES and its character class has no `…`, so
  // `Transcribing…` cleared the gate above only to be rejected here.
  if (/^[A-Z][a-z]{3,}[…:!?.]+$/.test(t)) return true;
  return PROSE.test(t) || /\s[a-z]/.test(t);
}

/**
 * Walk the real syntax tree.
 *
 * This scanner was hand-rolled — regexes, then a small quote-tracking blanker —
 * and review found a tokenizer bug in it six times running: a `>` inside a
 * string literal dragged code into findings; a glob in a placeholder attribute
 * opened a "comment" that blanked thirteen lines out of the scan; an apostrophe in `won't` opened a
 * phantom string that desynced quote state to the end of the file, which
 * happened in eleven files including one in a directory certified at HARD ZERO.
 *
 * Every one of those is a thing a parser already knows. TypeScript is a
 * dependency of this repo and its parser is exact about the distinctions that
 * kept being got wrong: comment vs string, apostrophe vs delimiter, regex
 * literal vs division, template vs quote, JSX text vs code. Nothing below
 * inspects characters.
 */
function findingsIn(file, findings) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const push = (node, kind, value) => {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (looksTranslatable(cleaned)) findings.push({ file, line: at(node), kind, text: cleaned });
  };

  /** Is this literal an argument to `t(...)`? Then it is a key, not prose. */
  const isTranslationKey = (node) =>
    ts.isCallExpression(node.parent) &&
    ts.isIdentifier(node.parent.expression) &&
    node.parent.expression.text === "t";

  const visit = (node) => {
    // 1. JSX text — the wrapped prose that started all this.
    if (ts.isJsxText(node) && node.text.trim()) push(node, "jsx-text", node.text);

    // 2. Text-bearing attributes, whether the value is a literal or an
    //    expression: `label="x"`, `label={cond ? "a" : "b"}`. A parser makes
    //    these one case instead of two regexes that disagreed about wrapping.
    if (ts.isJsxAttribute(node) && node.name && TEXT_PROPS.includes(node.name.getText(source))) {
      const kind = node.name.getText(source);
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) push(init, kind, init.text);
      if (init && ts.isJsxExpression(init) && init.expression) {
        const walkExpr = (n) => {
          if (ts.isStringLiteral(n) && !isTranslationKey(n)) push(n, kind, n.text);
          ts.forEachChild(n, walkExpr);
        };
        walkExpr(init.expression);
      }
    }

    // 3. Object-literal titles and `.title =` assignments — the native menus,
    //    action sheets and accessible names, which are not JSX at all.
    if (
      ts.isPropertyAssignment(node) &&
      OBJECT_TEXT_KEYS.includes(node.name.getText(source)) &&
      ts.isStringLiteral(node.initializer)
    ) {
      push(node.initializer, "object-title", node.initializer.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      OBJECT_TEXT_KEYS.includes(node.left.name.text) &&
      ts.isStringLiteral(node.right)
    ) {
      push(node.right, "object-title", node.right.text);
    }

    // 4. Toasts — user-facing by definition.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "toast" &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      push(node.arguments[0], "toast", node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
}

/** Keys whose value is shown to a user when they appear in an object. */
const OBJECT_TEXT_KEYS = ["title", "label", "confirmLabel", "ariaLabel"];

/** @returns {{file: string, line: number, kind: string, text: string}[]} */
export function scan(root = "src") {
  const findings = [];
  for (const file of walk(root)) findingsIn(file, findings);
  return findings;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "src";
  const findings = scan(root);

  const byFile = new Map();
  for (const f of findings) {
    const key = relative(process.cwd(), f.file);
    byFile.set(key, (byFile.get(key) || []).concat(f));
  }

  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(
    `${findings.length} untranslated user-visible strings across ${byFile.size} files\n`,
  );

  const detail = process.argv.includes("--detail");
  for (const [file, items] of ranked) {
    console.log(`${String(items.length).padStart(4)}  ${file}`);
    if (detail) {
      for (const it of items.slice(0, 40)) {
        console.log(`        ${String(it.line).padStart(4)} [${it.kind}] ${it.text}`);
      }
      if (items.length > 40) console.log(`        … ${items.length - 40} more`);
    }
  }
}
