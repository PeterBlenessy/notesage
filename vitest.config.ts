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
    exclude: ['e2e/**', 'node_modules/**', 'bundled-skills/**/node_modules/**', '.claude/worktrees/**'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
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
