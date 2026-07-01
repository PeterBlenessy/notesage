import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit project for engine fidelity. Notesage ships on WKWebView
    // (WebKit); Chromium (Blink) can mask engine-specific bugs in
    // contenteditable/ProseMirror, CSS, and selection behaviour. Playwright's
    // WebKit is its own build (not Apple's embedded WKWebView), so it's close
    // but not identical — the real-E2E (e2e-real/) suite remains the truth for
    // the embedded webview + the Tauri IPC boundary.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
  },
});
