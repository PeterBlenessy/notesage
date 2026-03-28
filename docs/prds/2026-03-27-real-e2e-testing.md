# PRD: Real E2E Testing with Tauri WebDriver

|  |  |
| --- | --- |
| **Date** | 2026-03-27 |
| **Status** | Complete — all phases implemented |
| **Priority** | Medium |
| **Impact** | Eliminates manual testing of integration issues (latency, editor behavior, IPC round-trips, watcher interactions) |
| **Depends on** | [test-infrastructure](2026-03-26-test-infrastructure.md) (complete), [test-coverage-expansion](2026-03-27-test-coverage-expansion.md) (independent) |

## Problem

Notesage has two layers of automated testing — Vitest unit/component tests and Playwright E2E tests — but both mock the Tauri backend. No automated test exercises the real app: real Rust IPC, real filesystem watcher, real editor with real content, real save/reload cycles.

This means the following classes of bugs are only caught by manual testing:

- **Latency regressions** — typing feels sluggish after a change, tab switching is slow with large documents
- **IPC integration bugs** — save triggers watcher which triggers false reload, external change detection races with auto-save
- **Editor behavior** — content flickers on reload, scroll position lost on tab switch, undo history unexpectedly cleared
- **UX issues** — slash command menu appears in wrong position, find bar doesn't scroll to match, theme transition glitches
- **Startup regressions** — app takes longer to reach interactive state, file tree doesn't populate

Manual testing is time-consuming and unreliable. Issues slip through because not every flow is manually verified before every release.

## Research Summary

### What doesn't work on macOS

- `tauri-driver` **(official)** — does not support macOS. Apple provides no WebDriver for WKWebView. The Tauri team has stated this is unlikely to change ([Issue #7068](https://github.com/tauri-apps/tauri/issues/7068), [Discussion #10928](https://github.com/tauri-apps/tauri/discussions/10928)).
- `safaridriver` — automates Safari only, not embedded WKWebView in desktop apps.

### What does work on macOS

| Option | Approach | Maturity | License |
| --- | --- | --- | --- |
| `tauri-plugin-webdriver` | Embeds HTTP server + JS bridge in app (debug only). Companion CLI (`tauri-wd`) exposes W3C WebDriver. | New (Feb 2026, \~4K downloads) | Open source |
| CrabNebula `@crabnebula/tauri-driver` | Similar plugin + driver approach | More polished | Commercial ecosystem |
| TestDriver.ai | Computer vision on the real app | Mature SaaS | Commercial, non-deterministic |
| Playwright + IPC mocks (current) | Tests frontend in Chromium with mocked backend | Mature, widely used | Not real E2E |

### Chosen approach: `tauri-plugin-webdriver`

- Open source, designed for Tauri v2 + macOS + WKWebView
- Tests the real app — real Rust backend, real IPC, real filesystem
- Speaks standard W3C WebDriver — works with `webdriverio`
- Plugin only loads in debug builds — zero production impact
- New and may have rough edges, but "something working &gt; nothing"

**Key constraint:** The WebDriver plugin must NOT be included in normal dev builds. It must be gated behind a Cargo feature flag so that `pnpm tauri dev` remains unchanged and only a dedicated test build includes the embedded HTTP server.

### Sources

- [Tauri Official WebDriver Docs](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri Official Mocking Docs](https://v2.tauri.app/develop/tests/mocking/)
- [Issue #7068: macOS support for tauri-driver](https://github.com/tauri-apps/tauri/issues/7068)
- [Discussion #10928: E2E on Mac?](https://github.com/tauri-apps/tauri/discussions/10928)
- [Choochmeque/tauri-webdriver](https://github.com/Choochmeque/tauri-webdriver) (plugin author)
- [danielraffel/tauri-webdriver](https://github.com/danielraffel/tauri-webdriver) (alternative implementation)
- [CrabNebula Integration Tests](https://docs.crabnebula.dev/plugins/tauri-e2e-tests/)
- [tauri-plugin-webdriver on crates.io](https://crates.io/crates/tauri-plugin-webdriver)

## Goals

1. **Validate the approach** — spike proves `tauri-plugin-webdriver` works with Notesage on macOS
2. **Separate build profile** — `pnpm tauri:test` starts the app with WebDriver; `pnpm tauri dev` is unaffected
3. **10-15 real E2E tests** — covering the flows that currently require manual testing
4. **Local runner script** — one command starts app + driver + runs tests + reports results
5. **Performance assertions** — tests can assert on timing (e.g., "tab switch completes within 300ms")

## Non-Goals

- CI integration — these tests run locally before releases, not on every PR
- Cross-platform support — macOS only (matching the app's current target)
- Replacing mocked Playwright tests — those stay for fast PR-level validation
- Testing native dialogs — almost none in the app; not worth the complexity
- Visual regression / screenshot comparison — separate initiative

## Technical Approach

### Build Isolation

The WebDriver plugin must be behind a Cargo feature flag so normal development is unaffected.

**Cargo.toml:**

```toml
[features]
default = []
e2e-testing = ["tauri-plugin-webdriver"]

[dependencies]
tauri-plugin-webdriver = { version = "0.2", optional = true }
```

**lib.rs:**

```rust
let mut builder = tauri::Builder::default();

#[cfg(feature = "e2e-testing")]
{
    builder = builder.plugin(tauri_plugin_webdriver::init());
}
```

**package.json scripts:**

```json
{
  "tauri:test": "CARGO_FEATURES=e2e-testing tauri dev",
  "test:e2e-real": "wdio run wdio.conf.ts"
}
```

This ensures:

- `pnpm tauri dev` — normal development, no WebDriver server, no overhead
- `pnpm tauri:test` — starts app with WebDriver plugin active
- `pnpm test:e2e-real` — runs the real E2E test suite against the running app

### Test Runner

Use `webdriverio` as the test framework:

- Speaks W3C WebDriver natively
- Good TypeScript support
- Supports custom commands for common Notesage interactions
- Can measure timing via `browser.execute(() => performance.now())`

**Config:** `wdio.conf.ts` pointing at `localhost:4444` (the `tauri-wd` WebDriver endpoint).

### Runner Script

A single script (`scripts/run-real-e2e.sh`) that:

1. Builds and starts the app with the e2e-testing feature (`pnpm tauri:test`)
2. Waits for the app to be ready (polls the WebDriver health endpoint)
3. Starts `tauri-wd` (the WebDriver CLI)
4. Runs `pnpm test:e2e-real`
5. Kills app + driver on completion or Ctrl+C
6. Reports results

### Target Test Flows

Tests focus on the integration issues that manual testing currently catches:

| Test | What it validates | Timing assertion |
| --- | --- | --- |
| App startup | App reaches interactive state with file tree | &lt; 3s |
| Open project folder | File tree populates after selecting folder | &lt; 1s |
| Open markdown file | Content renders in editor after sidebar click | &lt; 500ms |
| Type in editor | 100 characters typed without lag | &lt; 2s total |
| Save file (Cmd+S) | File saved, no false watcher reload | No reload event |
| Tab switching | Switch between 5 open tabs, content correct | &lt; 300ms per switch |
| External file change | Modify file on disk, editor updates | &lt; 2s |
| Find in document | Cmd+F, type query, matches highlighted | &lt; 200ms |
| Slash command | Type `/`, menu appears, select heading | Menu visible &lt; 150ms |
| Theme toggle | Cmd+T, colors transition smoothly | &lt; 300ms |
| Chat panel | Open chat, type message, send | Panel visible &lt; 200ms |
| Large document | Open 1000+ line file, scroll, type | No perceptible lag |
| Multiple projects | Open 3 projects, switch between them | Tree updates &lt; 500ms |
| Editor resize | Resize window, editor content reflows | No content jump |
| Undo/redo across tabs | Edit tab A, switch to B, back to A, undo | Correct undo state |

**File location:** `e2e-real/tests/*.test.ts`

## Phased Rollout

### Phase 1: Spike (1 task)

Validate the approach works at all:

1. Add `tauri-plugin-webdriver` as optional dependency behind feature flag
2. Create the `tauri:test` script
3. Install `webdriverio` and `tauri-wd`
4. Write ONE test: start app → verify the sidebar renders → assert timing
5. Document what works, what doesn't, and any workarounds needed

**Exit criteria:** One passing test that interacts with the real app via WebDriver. If this fails (plugin doesn't work, driver crashes, WKWebView interaction unreliable), stop and document findings.

### Phase 2: Core test suite (if spike succeeds)

Write the 15 target test flows listed above. Create shared helpers:

- `openProject(path)` — open a folder and wait for file tree
- `openFile(name)` — click file in sidebar and wait for editor content
- `typeInEditor(text)` — type text and return timing
- `measureAction(fn)` — execute action and return duration in ms

### Phase 3: Runner script and polish

Create `scripts/run-real-e2e.sh`, add to `/test` skill documentation, document the workflow for running before releases.

## Quality Gates

### Spike (Phase 1)

- [x] `tauri-plugin-webdriver` compiles behind feature flag

- [x] `pnpm tauri dev` still works normally (no WebDriver overhead)

- [x] `pnpm tauri:test` starts app with WebDriver active

- [x] `tauri-wd` connects to the app

- [x] One webdriverio test passes: finds an element in the real app

- [x] Spike findings documented (what works, what doesn't)

### Core suite (Phase 2)

- [x] 15 test flows implemented and passing

- [x] Timing assertions calibrated (not flaky on dev hardware)

- [x] Tests complete in &lt; 3 minutes total

- [x] Tests are independent (no ordering dependency)

### Runner (Phase 3)

- [x] `scripts/run-real-e2e.sh` handles full lifecycle (start, run, cleanup)

- [x] Clean exit on Ctrl+C (no orphan processes)

- [x] Results printed with pass/fail summary and timing

## Spike Findings (2026-03-27)

**Result: SUCCESS** — all 5 spike tests pass, proceed to Phase 2.

### What works

- `tauri-plugin-webdriver` v0.2.1 compiles and runs behind `e2e-testing` Cargo feature flag
- `tauri-webdriver` v0.1.1 CLI connects to the plugin (port 4445) and exposes W3C WebDriver on port 4444
- WebDriverIO v9.27.0 connects and runs mocha tests against the real Notesage app
- DOM queries work: `$('selector')`, `waitForExist()`, `isExisting()` all function correctly
- `browser.execute()` runs JavaScript in the app's WKWebView context — `performance.now()`, computed styles, DOM access all work
- Sidebar found in 10ms, full test suite completes in 30ms — very fast
- `tauri dev --features e2e-testing` is the correct syntax for feature-flagged builds

### What required adjustment

- WKWebView reports `browserName: "webview"` in capabilities — the wdio config uses `browserName: 'webview'`
- No semantic IDs or `data-testid` attributes on sidebar — used `button[title*="Settings"]` as selector. Consider adding `data-testid` attributes for key landmarks in Phase 2.
- `document.documentElement.backgroundColor` returns `rgba(0, 0, 0, 0)` (transparent) — the themed background is on a nested element. Style assertions should target specific elements, not `:root`.

### Setup requirements

- `cargo install tauri-webdriver --locked` (one-time CLI install)
- Three-terminal setup: (1) `pnpm tauri:test`, (2) `tauri-webdriver`, (3) `pnpm test:e2e-real`
- First build with `e2e-testing` feature takes \~36s (subsequent builds are incremental)

### WKWebView quirks observed

- User agent string: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15` (no version-specific info)
- Window title: `"Tauri + React + Typescript"` (the default Tauri title)
- No shadow DOM issues — standard DOM queries work as expected

## Out of Scope

- CI integration — local-only for now
- Windows/Linux support — macOS only
- Native dialog testing — negligible usage in the app
- Screenshot comparison — separate initiative
- Replacing mocked Playwright tests — complementary, not replacement
- Load/stress testing — not a current need