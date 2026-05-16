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
  },
});
