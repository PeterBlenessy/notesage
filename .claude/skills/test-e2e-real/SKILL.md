---
name: test-e2e-real
description: Run real E2E tests against a live Tauri app (WebDriverIO)
user-invocable: true
---

# Real E2E Tests

Tests the real running app via WebDriverIO + `tauri-plugin-webdriver` — real Rust backend, real IPC, real filesystem watcher, real editor.

## Commands

**Full lifecycle (recommended):**

```bash
pnpm test:e2e-real-full                 # Start app + driver, run tests, clean up
pnpm test:e2e-real-full --no-build      # Skip app build (app already running)
```

**Manual 3-terminal debugging:**

```bash
pnpm tauri:test       # Terminal 1 — start app with WebDriver plugin
tauri-webdriver       # Terminal 2 — start WebDriver bridge
pnpm test:e2e-real    # Terminal 3 — run tests
```

## Prerequisites

- `cargo install tauri-webdriver --locked` (one-time)
- First build with `e2e-testing` feature: ~36s (subsequent builds are incremental)

## What's Covered

App startup, project open, editor typing, save, tab switching, dirty indicator, external file changes, theme toggle, focus mode, large document load, keystroke latency, resize.

Tests: `e2e-real/tests/*.test.ts` | Helpers: `e2e-real/helpers/` | Fixtures: `e2e-real/fixtures/test-project/`

## When Tests Fail

- **App won't start:** check `/tmp/notesage-e2e-tauri.log` for build errors
- **Driver connection refused:** ensure `tauri-webdriver` is installed and the app started with `pnpm tauri:test` (not `pnpm tauri dev`)
- **Timing flakes:** thresholds are hardware-dependent; if a timing test fails occasionally, raise the threshold in that test file
- **Can't find elements:** the app needs at least one explorer folder open; fixtures at `e2e-real/fixtures/test-project/` are used automatically

## When to Run

- Before releases — catches integration bugs mocked tests miss
- After major editor, watcher, or IPC changes
- **Not on every PR** — slower than mocked E2E

## Related

- `/test-e2e` — faster mocked alternative
- `/release` — release prep (runs real E2E)
- `/test` — umbrella
