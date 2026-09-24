import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // The React plugin handles JSX/TSX transformation. Required by component
  // perf tests (e.g. sidebar-filter.perf.test.tsx) that render real React
  // trees through @testing-library/react.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    include: ['src/perf/**/*.perf.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/perf/setup.ts'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    // Perf benchmarks run 3 iterations per test. With PERF_BUDGET_MULTIPLIER=4
    // on CI, a single budgeted iteration can take up to ~2s (508ms × 4) for
    // 100KB markdown parse. Three iterations + overhead can exceed vitest's
    // default 5000ms testTimeout on a slow runner, causing a spurious failure
    // independent of the perf-budget gate.
    // 60s timeout absorbs runner variance while still catching genuine hangs.
    testTimeout: 60_000,
    // Benchmarks must not run concurrently with each other. Every test here
    // measures wall-clock against a fixed budget, so eight files racing on the
    // same cores measure contention rather than the code — and the harness
    // then blames whichever test happened to lose. Observed on 2026-09-24:
    // the full suite failed 1 test, then 5 across 3 different files, while
    // each of those files passed alone; forcing sequential execution gave
    // 45/45 three runs running. That is also the flake the CI job's
    // `continue-on-error` comment describes ("the markdown-parse 50KB case
    // still spiked ... and blocked a release on a pure timing flake"), so the
    // fix belongs here rather than in another budget multiplier.
    //
    // `vitest.config.ts` sets the same flag for the main suite, for a
    // different reason (order-dependent store state, #501).
    fileParallelism: false,
  },
});
