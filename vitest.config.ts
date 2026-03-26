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
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    // Coverage: install @vitest/coverage-istanbul@4.0.18 and uncomment when Node < 25
    // coverage: {
    //   provider: 'istanbul',
    //   reporter: ['text', 'json-summary'],
    //   reportsDirectory: './coverage',
    // },
    // NOTE: setupFiles intentionally omitted. Tests that need Tauri IPC mocking
    // import '@/test/tauri-mock' directly. This avoids conflicts with tests that
    // provide their own localStorage mocks (e.g. persistence-roundtrip tests).
  },
});
