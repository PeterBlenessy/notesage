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
  },
});
