// Regression-lock test: no bare numeric literals in perf/e2e timing assertions.
//
// Issue #195 — several bot-authored PRs hit CI failures because a perf
// assertion used a bare numeric literal as its budget
// (`expect(p95).toBeLessThan(500)`) but the CI macOS runner paces 3× slower
// than the dev machine. The fix is to wrap budgets with:
//   `N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`
//
// This test prevents regression: scan every `e2e/**/*.spec.ts` and
// `src/perf/**/*.{ts,test.ts}` file for the bare-literal shape and assert
// zero matches.
//
// Allowlist entries are documented inline — each entry explains WHY the bare
// literal is not a timing budget (count/ratio/length checks that would be
// wrong to multiply by a CI pacing factor).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { resolve } from 'path';

// ── File collection ──────────────────────────────────────────────────────────

function collectFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (pattern.test(full)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results.sort();
}

const ROOT = resolve(__dirname, '../../..');
const E2E_FILES = collectFiles(join(ROOT, 'e2e'), /\.spec\.ts$/);
const PERF_FILES = collectFiles(join(ROOT, 'src', 'perf'), /\.(?:ts|test\.ts)$/);

// ── The bad shape: bare numeric literal directly as matcher argument ─────────
//
// Matches:  .toBeLessThan(500)
//           .toBeLessThanOrEqual(200)
//           .toBeGreaterThan(1)
//           .toBeGreaterThan(0.8)
//
// Does NOT match:
//   .toBeLessThan(500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))
//   .toBeLessThan(budget)
//   .toBeGreaterThan(sizeKB * 0.8)   ← expression, not bare literal
//
// The regex requires the argument to be ONLY a number (with optional decimal),
// nothing else. Whitespace inside the parens is allowed.

const BARE_LITERAL = /\.(toBeLessThan|toBeLessThanOrEqual|toBeGreaterThan)\(\s*(\d+(?:\.\d+)?)\s*\)/g;

// ── Allowlist (non-timing bare literals) ────────────────────────────────────
//
// Files here contain bare numeric literals that are NOT timing budgets —
// they are count, length, or ratio checks where multiplying by
// PERF_BUDGET_MULTIPLIER would be semantically wrong.

type AllowedMatch = { line: number; reason: string };
type Allowlist = Map<string, AllowedMatch[]>;

const ALLOWLIST: Allowlist = new Map([
  [
    join(ROOT, 'e2e', 'tests', 'file-operations.spec.ts'),
    [
      // writeCalls.length >= 1 — count of IPC calls, not a timing budget
      { line: 143, reason: 'count check (writeCalls.length >= 1)' },
      // content.length > 0 — string length check, not a timing budget
      { line: 152, reason: 'length check (content.length > 0)' },
    ],
  ],
  [
    join(ROOT, 'e2e', 'tests', 'editor', 'fixture-contract.spec.ts'),
    [
      // workspaceDir.length > 0 — filesystem path length check
      { line: 37, reason: 'length check (workspaceDir.length > 0)' },
    ],
  ],
  [
    join(ROOT, 'e2e', 'tests', 'preview-fidelity.spec.ts'),
    [
      // ratio > 0.8 and ratio < 1.2 — proportional fidelity ratio, not ms
      { line: 250, reason: 'ratio check (ratio > 0.8) — not a timing budget' },
      { line: 251, reason: 'ratio check (ratio < 1.2) — not a timing budget' },
      // delays.length > 15 — sample count sanity check, not a timing budget
      { line: 323, reason: 'sample count check (delays.length > 15)' },
    ],
  ],
  [
    join(ROOT, 'e2e', 'tests', 'app-loads.spec.ts'),
    [
      // rootContent.length > 0 — DOM content length check
      { line: 25, reason: 'length check (rootContent.length > 0)' },
    ],
  ],
  [
    join(ROOT, 'e2e', 'tests', 'editor', 'find-bar.spec.ts'),
    [
      // totalMatches >= 1 — match count assertion, not a timing budget
      { line: 39, reason: 'count check (totalMatches >= 1)' },
    ],
  ],
]);

// ── Helper: find all bare-literal matches in a file ──────────────────────────

interface BareMatch {
  lineNumber: number;
  lineText: string;
  matcher: string;
  value: string;
}

function findBareLiterals(filePath: string): BareMatch[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: BareMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    BARE_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BARE_LITERAL.exec(line)) !== null) {
      matches.push({
        lineNumber: i + 1,
        lineText: line.trim(),
        matcher: m[1],
        value: m[2],
      });
    }
  }

  return matches;
}

// ── Inline negative controls ─────────────────────────────────────────────────
//
// Demonstrate the regex catches bad shapes AND skips good shapes.

describe('BARE_LITERAL regex — self-tests', () => {
  it('detects bare numeric literal', () => {
    const line = '    expect(p95).toBeLessThan(500);';
    BARE_LITERAL.lastIndex = 0;
    expect(BARE_LITERAL.test(line)).toBe(true);
  });

  it('detects bare decimal literal', () => {
    const line = '    expect(ratio).toBeGreaterThan(0.8);';
    BARE_LITERAL.lastIndex = 0;
    expect(BARE_LITERAL.test(line)).toBe(true);
  });

  it('skips multiplied literal', () => {
    const line =
      '    expect(p95).toBeLessThan(500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1));';
    BARE_LITERAL.lastIndex = 0;
    expect(BARE_LITERAL.test(line)).toBe(false);
  });

  it('skips identifier reference', () => {
    const line = '    expect(result.elapsed).toBeLessThan(budget);';
    BARE_LITERAL.lastIndex = 0;
    expect(BARE_LITERAL.test(line)).toBe(false);
  });

  it('skips expression argument', () => {
    const line = '    expect(actualKB).toBeGreaterThan(sizeKB * 0.8);';
    BARE_LITERAL.lastIndex = 0;
    expect(BARE_LITERAL.test(line)).toBe(false);
  });
});

// ── Main assertion: e2e + perf files must have zero bare-literal timing budgets

describe('No bare numeric literals in timing assertions (e2e + perf)', () => {
  const ALL_FILES = [...E2E_FILES, ...PERF_FILES];

  it('found at least one file to check', () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  for (const filePath of ALL_FILES) {
    const rel = relative(ROOT, filePath);
    const allowedForFile = ALLOWLIST.get(filePath);

    it(`${rel} — no bare-literal timing budgets`, () => {
      const matches = findBareLiterals(filePath);

      const violations = matches.filter((m) => {
        if (!allowedForFile) return true;
        // A match is allowed if its line number appears in the allowlist
        return !allowedForFile.some((a) => a.line === m.lineNumber);
      });

      if (violations.length > 0) {
        const detail = violations
          .map((v) => `  Line ${v.lineNumber}: ${v.lineText}`)
          .join('\n');
        throw new Error(
          `${rel} has ${violations.length} bare-literal timing budget(s).\n` +
            `Wrap each as: N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)\n\n` +
            `Violations:\n${detail}`,
        );
      }
    });
  }
});
