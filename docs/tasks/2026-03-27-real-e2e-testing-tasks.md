# Real E2E Testing Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-27 |
| **Status** | Complete (13/13 tasks) |
| **PRD** | [real-e2e-testing](../prds/2026-03-27-real-e2e-testing.md) |
| **Total** | 13 tasks: 4S, 5M, 4L |
| **Suggested order** | Spike (#1-#4) → decision gate → Helpers (#5) → Core tests (#6-#11) → Runner script (#12) → Docs (#13) |

**Risks:**

- `tauri-plugin-webdriver` is very new (Feb 2026, ~4K downloads). The spike (#1-#4) exists specifically to validate it works before investing further. If the spike fails, stop and document findings.
- The `CARGO_FEATURES` env var approach for `tauri dev` may not work — Tauri CLI may need `--features` passed differently. Research during #2.
- `tauri-wd` (the WebDriver CLI companion) may have its own install requirements or version compatibility issues. Validate in #3.
- WebDriver interaction with WKWebView may have quirks (shadow DOM, event handling, element finding) that don't exist in standard browsers. The spike will surface these.
- Timing assertions are hardware-dependent. Tests must use generous thresholds that pass on a busy dev laptop, not just an idle machine. Calibrate in #6.

**Decision gate after Phase 1:** If tasks #1-#4 all pass, proceed to Phase 2. If the plugin doesn't work, the driver is unreliable, or WKWebView interaction is too flaky, stop and document findings in the PRD. Do not proceed to Phase 2 on faith.

---

## Phase 1: Spike

### #1 — Add tauri-plugin-webdriver behind Cargo feature flag ✅

**Description:** Add `tauri-plugin-webdriver` as an optional dependency in `src-tauri/Cargo.toml` behind an `e2e-testing` feature flag. Add the plugin initialization to `src-tauri/src/lib.rs` gated by `#[cfg(feature = "e2e-testing")]`. Verify `cargo build` (without the feature) still compiles normally — no new dependencies pulled in. Verify `cargo build --features e2e-testing` compiles with the plugin.

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Files:** modified: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

---

### #2 — Create tauri:test script for feature-flagged dev build ✅

**Description:** Add a `tauri:test` script to `package.json` that starts `tauri dev` with the `e2e-testing` Cargo feature enabled. Research how Tauri CLI accepts feature flags — likely `tauri dev --features e2e-testing` or via `TAURI_DEV_ARGS` env var. Verify: `pnpm tauri dev` starts normally (no WebDriver), `pnpm tauri:test` starts with the WebDriver plugin active (look for the plugin's HTTP server port in stdout/logs). Verify `pnpm tauri dev` build time is unaffected by the optional dependency.

**Complexity:** S | **Category:** both | **Dependencies:** #1

**Files:** modified: `package.json`

---

### #3 — Install webdriverio and tauri-wd, create config ✅

**Description:** Install `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, and `webdriverio` as dev dependencies. Install `tauri-wd` CLI (check if it's an npm package or cargo install). Create `wdio.conf.ts` configured for: W3C WebDriver protocol, `localhost:4444` (the `tauri-wd` endpoint), mocha framework, spec reporter, TypeScript support. Create directory structure: `e2e-real/tests/`, `e2e-real/helpers/`. Add `e2e-real/tsconfig.json` if needed. Add a `test:e2e-real` script to `package.json`.

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Files:** new: `wdio.conf.ts`, `e2e-real/tests/.gitkeep`, `e2e-real/helpers/.gitkeep`; modified: `package.json`

---

### #4 — Write spike test: app loads and sidebar renders ✅

**Description:** Write `e2e-real/tests/spike.test.ts` — the single validation test. Steps: (1) connect to the running app via WebDriver, (2) wait for the app to be interactive (sidebar element visible), (3) assert the sidebar rendered within 3 seconds, (4) find at least one element inside the editor area, (5) log timing measurements. Run manually: start `pnpm tauri:test` in one terminal, `tauri-wd` in another, `pnpm test:e2e-real` in a third. Document: what worked, what didn't, any workarounds needed, WKWebView quirks encountered. Update the PRD spike quality gates with results.

**Exit criteria:** The test passes and interacts with a real element in the running Notesage app. If this fails, document why and stop.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2, #3

**Files:** new: `e2e-real/tests/spike.test.ts`; modified: `docs/prds/2026-03-27-real-e2e-testing.md` (spike findings)

---

## Phase 2: Core Test Suite

### #5 — Create shared test helpers and timing utility ✅

**Description:** Create `e2e-real/helpers/actions.ts` with reusable helpers: `openProject(path)` — triggers folder open and waits for file tree to populate, `openFile(name)` — clicks file in sidebar and waits for editor content, `typeInEditor(text)` — focuses editor, types text, returns duration, `pressShortcut(keys)` — sends keyboard shortcut (e.g., `Meta+s`), `waitForElement(selector, timeout)` — waits for element with configurable timeout. Create `e2e-real/helpers/timing.ts` with `measureAction(fn)` — executes an action and returns wall-clock duration in ms using `browser.execute(() => performance.now())` before and after. Create `e2e-real/helpers/setup.ts` with `ensureCleanState()` — closes all tabs, resets to known state before each test.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Files:** new: `e2e-real/helpers/actions.ts`, `e2e-real/helpers/timing.ts`, `e2e-real/helpers/setup.ts`

---

### #6 — Real E2E tests: app startup and project open ✅

**Description:** Write `e2e-real/tests/startup.test.ts`. Tests: (1) App startup — app reaches interactive state with sidebar visible within 3s, editor area rendered. (2) Open project folder — trigger folder open (may need to pre-configure a test project path since native dialogs can't be automated), verify file tree populates within 1s, correct file count rendered. (3) Open markdown file — click a file in the sidebar, editor content appears within 500ms, content matches file on disk. Use `measureAction()` for all timing assertions. Create a `e2e-real/fixtures/` directory with a small test project (3-5 .md files) that tests operate against.

**Complexity:** L | **Category:** frontend | **Dependencies:** #5

**Files:** new: `e2e-real/tests/startup.test.ts`, `e2e-real/fixtures/test-project/` (3-5 .md files)

---

### #7 — Real E2E tests: editor typing and save ✅

**Description:** Write `e2e-real/tests/editor.test.ts`. Tests: (1) Type in editor — type 100 characters, total time < 2s, no dropped characters. (2) Save file (Cmd+S) — save and verify file on disk matches editor content (read file via `browser.execute` or WebDriver file access). (3) Save doesn't trigger false watcher reload — after save, verify no external change toast/banner appears. (4) Slash command — type `/`, verify menu appears within 150ms, select heading, verify heading inserted. (5) Find in document — Cmd+F, type query, verify matches highlighted within 200ms, Escape closes find bar.

**Complexity:** L | **Category:** frontend | **Dependencies:** #5, #6

**Files:** new: `e2e-real/tests/editor.test.ts`

---

### #8 — Real E2E tests: tab switching and undo/redo ✅

**Description:** Write `e2e-real/tests/tabs.test.ts`. Tests: (1) Open 5 files, verify 5 tabs rendered. (2) Switch between tabs — click each tab, verify content changes within 300ms, correct content displayed. (3) Dirty indicator — edit a tab, verify dirty dot appears, save, verify dot disappears. (4) Close tab — close middle tab, verify remaining tabs correct. (5) Undo/redo across tabs — edit tab A, switch to tab B, switch back to A, undo — verify original content restored.

**Complexity:** M | **Category:** frontend | **Dependencies:** #5, #6

**Files:** new: `e2e-real/tests/tabs.test.ts`

---

### #9 — Real E2E tests: external file changes ✅

**Description:** Write `e2e-real/tests/external-changes.test.ts`. Tests: (1) Modify file on disk while it's open in a clean tab — write new content to the test fixture file using Node.js `fs` (via WebDriver `execute` or a helper script), verify editor updates within 2s. (2) Modify file on disk while tab is dirty — verify reload prompt appears (not auto-reload). (3) Create new file on disk — verify file tree updates. (4) Delete file on disk — verify file tree updates, tab shows deleted state. This test exercises the real filesystem watcher round-trip.

**Complexity:** L | **Category:** frontend | **Dependencies:** #5, #6

**Files:** new: `e2e-real/tests/external-changes.test.ts`

---

### #10 — Real E2E tests: navigation and UI ✅

**Description:** Write `e2e-real/tests/navigation.test.ts`. Tests: (1) Theme toggle — Cmd+T, verify CSS class change on `<html>` within 300ms, colors transition (check a computed style). (2) Chat panel — Cmd+Shift+C, verify panel visible within 200ms, type message in input, send button present. (3) Sidebar toggle — Cmd+Shift+L, verify sidebar hidden/shown. (4) Focus mode — Cmd+., verify sidebar and tabs hidden, Escape exits.

**Complexity:** M | **Category:** frontend | **Dependencies:** #5

**Files:** new: `e2e-real/tests/navigation.test.ts`

---

### #11 — Real E2E tests: large document and resize ✅

**Description:** Write `e2e-real/tests/performance.test.ts`. Tests: (1) Large document — open a 1000+ line markdown file (create `e2e-real/fixtures/test-project/large-doc.md`), verify it loads within 2s, scroll to bottom, type at end — no perceptible lag (< 100ms per keystroke measured via `performance.now()`). (2) Editor resize — resize the browser window, verify editor content reflows without content jumps (check scroll position stability). (3) Multiple projects — open 3 projects, switch between them, verify tree updates within 500ms each.

**Complexity:** L | **Category:** frontend | **Dependencies:** #5, #6

**Files:** new: `e2e-real/tests/performance.test.ts`, `e2e-real/fixtures/test-project/large-doc.md`

---

## Phase 3: Runner Script and Docs

### #12 — Create runner script for one-command execution ✅

**Description:** Create `scripts/run-real-e2e.sh` that handles the full lifecycle: (1) starts `pnpm tauri:test` in the background, (2) waits for the app to be ready (poll WebDriver health endpoint or check for plugin port in stdout), (3) starts `tauri-wd` in the background, (4) runs `pnpm test:e2e-real`, (5) captures exit code, (6) kills app + driver processes on completion, (7) traps SIGINT/SIGTERM for clean Ctrl+C exit (no orphan processes), (8) prints pass/fail summary with total timing. Add `"test:e2e-real-full": "./scripts/run-real-e2e.sh"` to `package.json`.

**Complexity:** M | **Category:** both | **Dependencies:** #4

**Files:** new: `scripts/run-real-e2e.sh`; modified: `package.json`

---

### #13 — Update /test skill and documentation ✅

**Description:** Update `.claude/skills/test/SKILL.md` to include the real E2E test section: commands (`pnpm test:e2e-real-full` for full lifecycle, or manual 3-terminal setup), when to run (before releases, after major changes), what it tests vs what mocked Playwright tests test, troubleshooting (app won't start, driver connection refused, timing flakes). Update `docs/architecture.md` testing table with the new `test:e2e-real` command. Mark PRD quality gates as complete.

**Complexity:** S | **Category:** frontend | **Dependencies:** #6-#12

**Files:** modified: `.claude/skills/test/SKILL.md`, `docs/architecture.md`, `docs/prds/2026-03-27-real-e2e-testing.md`
