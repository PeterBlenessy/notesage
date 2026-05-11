// Regression-lock test: perf-test budgets must honour PERF_BUDGET_MULTIPLIER.
//
// Issue #195 — every bot-authored PR that adds a perf assertion without wrapping
// the numeric budget in PERF_BUDGET_MULTIPLIER flakes on CI because macos-latest
// runners pace ~1.5–3× slower than a local Apple Silicon machine. The fix is a
// one-line wrap; this test catches the pattern at PR-write time so the repair
// skill never needs to fire.
//
// Detection: regex-scan `e2e/**/*.spec.ts` and `src/perf/**/*.ts` for
// `.toBeLessThan(N)`, `.toBeLessThanOrEqual(N)`, `.toBeGreaterThan(N)` where
// the argument is a bare numeric literal (not multiplied by PERF_BUDGET_MULTIPLIER
// or a named constant). Assert zero matches per file.
//
// How to fix a flagged assertion:
//   expect(elapsed).toBeLessThan(500)
//   → expect(elapsed).toBeLessThan(500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))
//
// How to add an allowlist entry (for non-timing bare literals such as ratio
// checks, array-length sanity checks, or match-count guards):
//   Add the file path to ALLOWLISTED_FILES below with a comment explaining
//   why the literal is not a timing budget.
//
// Mirror of the aw-workflow-pat.test.ts pattern: walk a fixed file set, regex-parse,
// assert convention.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "../../..");

function findFiles(dir: string, ext: string): string[] {
  const abs = resolve(ROOT, dir);
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));
}

const PERF_FILES = [
  ...findFiles("e2e", ".spec.ts"),
  ...findFiles("src/perf", ".ts"),
];

const MATCHERS = ["toBeLessThan", "toBeLessThanOrEqual", "toBeGreaterThan"];
const BARE_LITERAL = new RegExp(
  `\\.(?:${MATCHERS.join("|")})\\(\\s*(\\d+(?:\\.\\d+)?)\\s*\\)`,
  "g",
);

// Files whose bare-literal assertions are provably NON-timing (ratio checks,
// array/string length sanity checks, match-count guards). Each entry requires
// a comment explaining why it is not a timing budget.
// To add an entry: verify ALL bare literals in that file are non-timing, then
// add the path here with a rationale comment.
const ALLOWLISTED_FILES = new Set<string>([
  // `expect(rootContent.length).toBeGreaterThan(0)` — array length, not timing
  "e2e/tests/app-loads.spec.ts",

  // `expect(writeCalls.length).toBeGreaterThanOrEqual(1)` and
  // `expect((args.content as string).length).toBeGreaterThan(0)` — call counts
  // and string lengths, not timing budgets
  "e2e/tests/file-operations.spec.ts",

  // `expect(ratio).toBeGreaterThan(0.8)` / `toBeLessThan(1.2)` — ratio bounds,
  // not timing; `expect(delays.length).toBeGreaterThan(15)` — sample count
  "e2e/tests/preview-fidelity.spec.ts",

  // `expect(totalMatches).toBeGreaterThanOrEqual(1)` — match count, not timing
  "e2e/tests/editor/find-bar.spec.ts",

  // `expect(workspaceDir.length).toBeGreaterThan(0)` — path length, not timing
  "e2e/tests/editor/fixture-contract.spec.ts",
]);

describe("perf-test budgets honour PERF_BUDGET_MULTIPLIER", () => {
  it.each(PERF_FILES)("%s uses scaled budgets", (file) => {
    if (ALLOWLISTED_FILES.has(file)) return;

    const src = readFileSync(resolve(ROOT, file), "utf8");
    const matches = [...src.matchAll(BARE_LITERAL)];
    expect(
      matches,
      `bare numeric budget in ${file} — wrap as N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`,
    ).toHaveLength(0);
  });

  it("negative control: regex catches the bad shape", () => {
    const badSrc = `expect(elapsed).toBeLessThan(500);`;
    const matches = [...badSrc.matchAll(BARE_LITERAL)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("500");
  });

  it("negative control: regex skips a multiplied literal", () => {
    const goodSrc = `expect(elapsed).toBeLessThan(500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1));`;
    const matches = [...goodSrc.matchAll(BARE_LITERAL)];
    expect(matches).toHaveLength(0);
  });

  it("negative control: regex skips a named-constant reference", () => {
    const goodSrc = `expect(elapsed).toBeLessThan(BUDGET_MS);`;
    const matches = [...goodSrc.matchAll(BARE_LITERAL)];
    expect(matches).toHaveLength(0);
  });
});
