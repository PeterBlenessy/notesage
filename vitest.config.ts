import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    // Run test FILES sequentially (not in parallel). Several suites are
    // order-dependent: they mutate real Zustand stores / module singletons and
    // don't fully reset them between tests (e.g. AgentOrb reads the real
    // session-run-store; comment-store accumulates replies; skill discovery's
    // first-run flag). Under parallel sharding / shuffle this surfaces as stale
    // state — counts come out +N, text accumulates, "first run" is already
    // consumed (assertion failures, never timeouts). Sequential execution runs
    // files in the one deterministic order that passes (verified 5652/5652).
    //
    // Why not the "proper" fix (a global zustand store auto-reset in a setup
    // file)? Tried it — `vi.mock('zustand')` auto-resetting every store after
    // each test broke 111 tests across 10 suites (many tests legitimately rely
    // on store state across their own flow), far worse than the flake it cured.
    // Per-file resets would be open-ended. Sequential is the contained, proven
    // fix; revisit if run time becomes painful.
    fileParallelism: false,
    // Only the marketing-site *generator* is excluded: gen.test.ts reads the
    // compiled app CSS (dist/assets, a `vite build` output CI's unit job never
    // produces) and writes into content/site. Run it via `pnpm gen:site`
    // (vitest.gen.config.ts). Its companion quality.test.ts is a pure static
    // check with no build/browser dependency, so it DOES run here in CI.
    exclude: ['e2e/**', 'e2e-real/**', 'node_modules/**', 'bundled-skills/**/node_modules/**', '.claude/worktrees/**', 'scripts/gen-site/gen.test.ts', 'src/perf/**/*.perf.test.ts', 'src/perf/**/*.perf.test.tsx'],
    // Note: perf benchmarks (*.perf.test.{ts,tsx}) are excluded from default runs.
    // Run them separately via `pnpm test:perf` which uses vitest.perf.config.ts.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // `all: true` + an explicit `include` instrument EVERY source file, not
      // just the ones a test happens to import. Without this, Istanbul reports
      // only imported files, so the baseline covered ~11% of the tree (72 of
      // 628 files) and a security-relevant module could ship at 0% coverage
      // while the headline % looked healthy (2026-07-08 test-coverage audit,
      // HIGH). Uncovered files now count as 0% instead of being invisible.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test/**',            // test-only infrastructure (mocks, harness)
        'src/perf/**',            // perf benchmarks run under vitest.perf.config
        'src/**/*.d.ts',
        'src/vite-env.d.ts',
        'src/main.tsx',           // app entry point — not unit-testable
      ],
      // Thresholds stay at 0: with the full tree now visible, overall coverage
      // is honestly low, so a hard threshold would block unrelated PRs today.
      // Per-file regression on CHANGED files is enforced separately by
      // scripts/coverage-check.sh (which now also flags new-but-uncovered
      // files). Raising these is a follow-up policy decision.
      thresholds: {
        perFile: true,
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    // NOTE: setupFiles intentionally omitted. Tests that need Tauri IPC mocking
    // import '@/test/tauri-mock' directly. This avoids conflicts with tests that
    // provide their own localStorage mocks (e.g. persistence-roundtrip tests).
  },
});
