---
name: test
description: Run all project tests including markdown round-trip tests
user-invocable: true
---

# Test Suite

Runs the complete test suite for Notesage: type checking, unit tests with coverage, Playwright E2E tests, Rust backend tests, and markdown round-trip tests.

## Quick Reference

| Command | What it runs |
| --- | --- |
| `pnpm typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `pnpm test` | Vitest unit tests (fast, no coverage) |
| `pnpm test:coverage` | Unit tests + Istanbul coverage (text + JSON + HTML in `./coverage/`) |
| `pnpm test:e2e` | Playwright E2E tests (Chromium, starts Vite dev server) |
| `pnpm test:all` | Unit tests + E2E tests combined |
| `cd src-tauri && cargo test` | Rust backend tests |

## What It Runs

### 1. TypeScript Type Checking

```bash
pnpm typecheck
```

Verifies:
- No TypeScript errors
- All types resolve correctly
- No `any` types (use `unknown` instead)
- Import paths valid

### 2. Unit Tests with Coverage

```bash
pnpm test:coverage
```

Runs all Vitest tests with Istanbul coverage reporting:
- Component rendering tests (React Testing Library)
- Hook and utility tests
- Store tests
- Markdown round-trip tests (`src/lib/__tests__/markdown-roundtrip.test.ts`)
- Frontmatter tests
- Persistence round-trip tests

**Coverage output** lands in `./coverage/` (gitignored):
- `text` — console summary table
- `json-summary` — machine-readable summary
- `html` — browsable HTML report (open `coverage/index.html`)

**Requires Node 22** (pinned in `.nvmrc`). Coverage provider: `@vitest/coverage-istanbul`.

### 3. Playwright E2E Tests

```bash
pnpm test:e2e
```

Runs end-to-end tests in Chromium via Playwright:
- Automatically starts Vite dev server on `http://localhost:1420`
- Tauri IPC mocked via `window.__TAURI_INTERNALS__` shim (`e2e/fixtures/tauri-mock.ts`)
- Tests cover: app loading, file operations, editor interactions, navigation, chat panel

**Browser install** (one-time): `npx playwright install chromium`

**Reports:** HTML report in `playwright-report/` (gitignored), opens on failure.

**CI configuration:** `playwright.config.ts` sets `forbidOnly: true`, single worker, 2 retries in CI.

### 4. Real E2E Tests (WebDriverIO + Tauri WebDriver)

```bash
pnpm test:e2e-real-full
```

Tests the **real running app** via WebDriverIO and `tauri-plugin-webdriver` — real Rust backend, real IPC, real filesystem watcher, real editor.

**What it tests:**

- App startup and project open (file tree renders, files open in editor)
- Editor typing, save (Cmd+S), slash commands, find in document
- Tab switching, dirty indicator, close tab, undo/redo across tabs
- External file changes (watcher detects modify/create/delete on disk)
- Navigation: theme toggle, chat panel, sidebar toggle, focus mode
- Performance: large document load, keystroke latency, resize, rapid tab switching

**Full lifecycle (recommended):**

```bash
pnpm test:e2e-real-full          # Starts app + driver, runs tests, cleans up
pnpm test:e2e-real-full --no-build  # Skip app start (if already running)
```

**Manual 3-terminal setup (for debugging):**

```bash
# Terminal 1: Start app with WebDriver plugin
pnpm tauri:test

# Terminal 2: Start WebDriver bridge
tauri-webdriver

# Terminal 3: Run tests
pnpm test:e2e-real
```

**Prerequisites:**

- `cargo install tauri-webdriver --locked` (one-time)
- First build with `e2e-testing` feature takes ~36s (subsequent builds are incremental)

**When to run:**

- Before releases — catches integration bugs that mocked tests miss
- After major editor, watcher, or IPC changes
- NOT on every PR — these are slower than mocked tests

**Troubleshooting:**

- **App won't start:** Check `/tmp/notesage-e2e-tauri.log` for build errors
- **Driver connection refused:** Ensure `tauri-webdriver` is installed and the app started with `pnpm tauri:test` (not `pnpm tauri dev`)
- **Timing flakes:** Thresholds are generous but hardware-dependent. If a timing test fails occasionally, increase the threshold in the test file.
- **Tests can't find elements:** The app must have at least one explorer folder open for sidebar tests. The test fixtures at `e2e-real/fixtures/test-project/` are used automatically.

**Test files:** `e2e-real/tests/*.test.ts` | **Helpers:** `e2e-real/helpers/*.ts` | **Fixtures:** `e2e-real/fixtures/test-project/`

### 5. Rust Backend Tests

```bash
cd src-tauri && cargo test
```

Runs:
- Unit tests in Rust backend modules
- Integration tests for Tauri commands
- Parser tests (GGUF, markdown-to-typst, frontmatter, etc.)

### 6. Full Suite

```bash
pnpm typecheck && pnpm test:coverage && pnpm test:e2e && cd src-tauri && cargo test
```

Or for a quick pass without coverage:

```bash
pnpm test:all && cd src-tauri && cargo test
```

For a complete pass including real E2E:

```bash
pnpm test:all && pnpm test:e2e-real-full && cd src-tauri && cargo test
```

## When Tests Fail

### TypeScript Errors
1. Fix the type errors immediately
2. Don't use `@ts-ignore` to bypass
3. Add proper types or use `unknown`

### Unit Test Failures
1. Check if component logic changed
2. Update tests if behavior is intentional
3. Fix code if behavior is wrong
4. Run `pnpm test -- --reporter=verbose` for detailed output

### Round-Trip Failures
**This is critical** — markdown must round-trip correctly.

1. Identify which fixture fails
2. Debug the conversion (parse -> inspect -> serialize -> compare)
3. Check markdown library config (`prosemirror-markdown`)
4. Fix and re-test — ensure all other fixtures still pass
5. Use the `markdown-roundtrip` skill for detailed guidance

### E2E Failures
1. Check the HTML report in `playwright-report/` for screenshots and traces
2. Verify the Tauri IPC mock covers the commands used (`e2e/fixtures/tauri-mock.ts`)
3. Run a single test with `pnpm test:e2e -- --grep "test name"` for isolation
4. Use `--debug` flag to step through: `pnpm test:e2e -- --debug`
5. Check if Vite dev server starts correctly on port 1420

### Coverage Drops
1. Check the HTML report in `coverage/index.html` to find uncovered lines
2. Add tests for uncovered paths before merging
3. Focus on business logic — not boilerplate or generated code

### Rust Test Failures
1. Run `cd src-tauri && cargo test -- --nocapture` for full output
2. Check if Tauri command signatures changed
3. Verify Cargo dependencies are up to date

## CI Pipeline

Tests run automatically via GitHub Actions (`.github/workflows/test.yml`) on push to `main` and on pull requests:

| Job | Runner | Steps |
| --- | --- | --- |
| Frontend Tests & Coverage | `ubuntu-latest` | typecheck, `pnpm test:coverage`, upload coverage artifact |
| Playwright E2E Tests | `ubuntu-latest` | `pnpm test:e2e`, upload report on failure |
| Rust Backend Tests | `macos-latest` | `cargo test` in `src-tauri/` |

All jobs must pass for merge.

## Quality Gates

A release cannot ship unless:

- All TypeScript type checks pass
- All unit tests pass (frontend + Rust)
- **All markdown round-trip tests pass** (critical!)
- All E2E tests pass
- No console errors during tests
- Coverage does not regress on changed files

## Reference

- @docs/product-description.md — Quality gates and feature requirements
- @docs/architecture.md — Testing strategy and patterns
- Use the `markdown-roundtrip` skill for detailed markdown testing guidance
