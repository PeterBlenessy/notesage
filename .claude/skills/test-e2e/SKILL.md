---
name: test-e2e
description: Run Playwright E2E tests (Chromium, mocked Tauri IPC)
user-invocable: true
---

# Playwright E2E Tests

End-to-end tests with mocked Tauri IPC. Fast enough to run on every PR.

## Commands

```bash
pnpm test:e2e                          # Full E2E suite (Chromium)
pnpm test:e2e -- --grep "<name>"       # Single test by name
pnpm test:e2e -- --debug                # Step-through debug mode
```

One-time setup: `npx playwright install chromium`

## What's Covered

- App loading, file operations, editor interactions, navigation, chat panel
- Starts Vite dev server on `http://localhost:1420`
- Tauri IPC mocked via `window.__TAURI_INTERNALS__` (`e2e/fixtures/tauri-mock.ts`)

Test files: `e2e/tests/*.spec.ts` | Config: `playwright.config.ts`

## When Tests Fail

1. Open `playwright-report/index.html` — auto-opens on failure with screenshots and traces
2. Isolate: `pnpm test:e2e -- --grep "<name>"`
3. Step through: `pnpm test:e2e -- --debug`
4. Verify the Tauri mock covers every command the test exercises
5. If Vite won't start on port 1420, check for a leftover process

## CI

`forbidOnly: true`, single worker, 2 retries. Report uploaded as artifact on failure.

## Related

- `/test-e2e-real` — real running app (slower, pre-release coverage)
- `/test-frontend` — unit tests (much faster feedback)
- `/test` — umbrella
