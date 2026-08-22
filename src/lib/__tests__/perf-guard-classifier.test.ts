// Locks the assumption `scripts/perf-ci-guard.mjs` is built on.
//
// That script decides whether a failing perf benchmark merely exceeded its
// budget (tolerable noise on a shared CI runner) or threw before measuring
// anything (a broken benchmark with no coverage at all, which must fail the
// build). It decides by matching the failure message against:
//
//     /expected false to be true/
//
// which is the text Vitest produces for `expect(result.passed).toBe(true)`.
// That is a match on generic assertion boilerplate, not on which assertion
// failed — so it is only correct for as long as EVERY `.toBe(true)` in the
// perf suite is asserting on `result.passed`.
//
// The day someone adds an unrelated boolean assertion — `expect(cacheHit)
// .toBe(true)`, `expect(flagEnabled).toBe(true)` — a genuine functional
// regression starts reporting as a tolerated budget overrun, and CI goes quiet
// about exactly the class of failure the guard exists to catch. That is the
// cmdbar incident again, one level up: not a broken benchmark this time, but a
// broken detector for broken benchmarks.
//
// So this test fails loudly at the moment the assumption stops holding, rather
// than silently much later. `.toBe(false)` is deliberately NOT restricted:
// `harness.test.ts` asserts `expect(result.passed).toBe(false)` to prove the
// harness reports an over-budget run as failing, and if THAT ever breaks it is
// a functional regression which the guard should — correctly — call a crash.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const PERF_DIR = resolve(__dirname, "../../perf");
const REPO_ROOT = resolve(__dirname, "../../..");

/** The only `.toBe(true)` subject the classifier's regex can safely assume. */
const ALLOWED_SUBJECT = "result.passed";

function collectPerfTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectPerfTests(full));
    } else if (/\.(test|perf\.test)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("perf-ci-guard classifier assumption", () => {
  const files = collectPerfTests(PERF_DIR);

  it("finds perf test files to check", () => {
    // A collector that silently matched nothing would make every assertion
    // below vacuously true — the failure mode this whole file is about.
    expect(files.length).toBeGreaterThan(0);
  });

  it("only ever asserts .toBe(true) on result.passed", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const match = line.match(/expect\(([^)]*)\)\s*\.toBe\(true\)/);
        if (match && match[1].trim() !== ALLOWED_SUBJECT) {
          offenders.push(`${relative(REPO_ROOT, file)}:${i + 1} — expect(${match[1].trim()}).toBe(true)`);
        }
      });
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These assertions break scripts/perf-ci-guard.mjs's crash-vs-overrun classification, ` +
          `because a failure of theirs produces the same "expected false to be true" message a ` +
          `budget overrun does — so a real regression would be silently tolerated in CI.\n\n` +
          offenders.map((o) => `  ${o}`).join("\n") +
          `\n\nEither assert on \`result.passed\`, or make the classifier structural ` +
          `(e.g. have the harness throw a distinctively-worded error on budget failure) ` +
          `and update this test.`,
    ).toEqual([]);
  });

  it("still matches the message shape the guard greps for", () => {
    // Pins the other half of the coupling: if Vitest ever rewords this, the
    // classifier stops recognising overruns and starts failing CI on every
    // timing flake — the opposite failure, equally bad.
    let message = "";
    try {
      expect(false).toBe(true);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/expected false to be true/);
  });
});
