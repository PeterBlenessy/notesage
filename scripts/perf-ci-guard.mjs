#!/usr/bin/env node
/**
 * Classify perf-suite failures so CI can tolerate the flaky ones without going
 * blind to the real ones.
 *
 * Why this exists
 * ---------------
 * The "Performance benchmarks" step in `.github/workflows/test.yml` is
 * deliberately `continue-on-error: true`. Wall-clock benchmarks on a shared
 * `macos-latest` runner have irreducible variance — the budget multiplier was
 * bumped 3 → 4 → 5 and the markdown-parse case STILL spiked under contention
 * and blocked a release on a pure timing flake. Gating merges on shared-runner
 * wall-clock is unreliable, and that decision stands.
 *
 * But `continue-on-error` does not distinguish *why* a benchmark failed, and
 * the two reasons are not equally tolerable:
 *
 *   - **Budget overrun** — the benchmark ran and was slower than its budget.
 *     On a shared runner this is usually noise. Tolerate.
 *   - **Crash** — the benchmark never executed at all. This is not noise, it is
 *     a broken benchmark, and it means that code path has NO perf coverage.
 *     Fail.
 *
 * On 2026-08-22 three `cmdbar.perf.test.ts` benchmarks had been dying in a
 * passive effect with `TypeError: useChatStore.subscribe is not a function`
 * (the perf file's chat-store mock had not followed `FloatingCommandBar` when
 * it began mounting `useMessageQueueDrain`). CI was green throughout. The
 * benchmarks were not slow — they were absent, which is worse and reads
 * identically on the dashboard.
 *
 * How it classifies
 * -----------------
 * Every budget assertion in `src/perf/` is the same shape:
 *
 *     expect(result.passed).toBe(true);
 *
 * so a genuine overrun always surfaces as `expected false to be true`. Any
 * other failure message means the benchmark threw before it could assert.
 * Unrecognised shapes fail loudly rather than being assumed benign — a guard
 * that silently reclassifies the unknown as harmless is the bug it exists to
 * prevent.
 *
 * KNOWN FRAGILITY, and why it is acceptable. This matches on generic Vitest
 * boilerplate, not on *which* assertion failed. A `.toBe(true)` on anything
 * other than `result.passed` would fail with the identical message, and a real
 * functional regression would then be waved through as a tolerated timing
 * flake — this guard going blind in exactly the way the benchmarks it watches
 * once did. Rather than leave that to vigilance,
 * `src/lib/__tests__/perf-guard-classifier.test.ts` fails the moment any perf
 * test asserts `.toBe(true)` on a different subject, and points here. If that
 * test ever becomes an obstacle, the honest fix is to make the classification
 * structural — have the harness throw a distinctively-worded error on budget
 * failure — not to loosen the regex.
 *
 * Usage:
 *   vitest run --config vitest.perf.config.ts --reporter=json --outputFile=<f>
 *   node scripts/perf-ci-guard.mjs <f>
 */
import { readFileSync } from "node:fs";

const BUDGET_OVERRUN = /expected false to be true/;

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/perf-ci-guard.mjs <vitest-json-output>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  // No parseable report means the run died before writing one — that is itself
  // a structural failure, not something to shrug at.
  console.error(`[perf-guard] could not read ${file}: ${err.message}`);
  process.exit(1);
}

const overruns = [];
const crashes = [];

for (const suite of report.testResults ?? []) {
  for (const test of suite.assertionResults ?? []) {
    if (test.status !== "failed") continue;
    const messages = test.failureMessages ?? [];
    const name = test.fullName || test.title;
    // Budget only when EVERY message looks like the budget assertion. A test
    // that overran and also threw is a crash.
    if (messages.length > 0 && messages.every((m) => BUDGET_OVERRUN.test(m))) {
      overruns.push(name);
    } else {
      crashes.push({ name, detail: (messages[0] ?? "no failure message").split("\n")[0] });
    }
  }
}

for (const name of overruns) {
  console.log(`[perf-guard] budget overrun (tolerated on shared runners): ${name}`);
}
for (const { name, detail } of crashes) {
  console.error(`[perf-guard] BENCHMARK DID NOT RUN: ${name}`);
  console.error(`[perf-guard]   ${detail}`);
}

if (crashes.length > 0) {
  console.error(
    `\n[perf-guard] ${crashes.length} benchmark(s) failed for a reason other than exceeding ` +
      `their budget — they did not measure anything. Timing flakes are tolerated here; ` +
      `broken benchmarks are not.`,
  );
  process.exit(1);
}

console.log(
  `[perf-guard] ok — ${overruns.length} budget overrun(s), 0 crashes. ` +
    `Overruns are advisory on shared runners; the strict signal is local ` +
    `\`pnpm test:perf\` at multiplier 1.`,
);
