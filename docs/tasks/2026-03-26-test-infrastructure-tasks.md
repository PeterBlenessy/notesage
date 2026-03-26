# Test Infrastructure Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-26 |
| **Status** | Not started |
| **PRD** | [test-infrastructure](../prds/2026-03-26-test-infrastructure.md) |
| **Total** | 18 tasks: 5S, 8M, 5L |
| **Suggested order** | Coverage tooling (#1-#3) → Component test infra (#4-#5) → Component tests (#6-#11) → Playwright infra (#12-#13) → E2E tests (#14-#17) → CI (#18) |

**Risks:**

- Node 22 pinning may conflict with other dev tooling that expects Node 25 — test `pnpm tauri dev` still works under `.nvmrc`
- Component tests for ChatPanel and SettingsDialog require extensive mocking (17+ and 21+ imports respectively) — may need simplified wrappers
- Playwright E2E with Tauri IPC mocking is uncharted territory for this project — the `window.__TAURI_INTERNALS__` shim may need iterating
- Vite dev server must be running for E2E tests — CI needs to handle startup/shutdown

---

## Phase A: Coverage Tooling

### #1 — Pin Node 22 LTS and verify coverage works

**Description:** Add `.nvmrc` with `22` to the project root. Install `@vitest/coverage-istanbul@4.0.18`. Uncomment and configure the coverage block in `vitest.config.ts` with `provider: 'istanbul'`, reporters `['text', 'json-summary', 'html']`, and `reportsDirectory: './coverage'`. Verify `pnpm test:coverage` (under Node 22) prints a coverage table. Add `coverage/` to `.gitignore`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `.nvmrc`, `vitest.config.ts`, `package.json`, `.gitignore`

---

### #2 — Add test scripts to package.json

**Description:** Add scripts: `"test:coverage": "vitest run --coverage"`, `"test:e2e": "playwright test"`, `"test:all": "vitest run && playwright test"`. Verify `pnpm test` (existing) and `pnpm test:coverage` both work. Leave `test:e2e` as a no-op until Playwright is installed in task #12.

**Complexity:** S | **Category:** frontend | **Dependencies:** #1

**Files:** `package.json`

---

### #3 — Document Rust coverage approach

**Description:** Add a section to `docs/architecture.md` under a "Testing" heading documenting: (a) how to run frontend coverage (`pnpm test:coverage`), (b) that Rust coverage uses `cargo-tarpaulin` or `cargo-llvm-cov` in CI, (c) Node 22 requirement for coverage via `.nvmrc`. This is documentation only — no Rust tooling installation.

**Complexity:** S | **Category:** frontend | **Dependencies:** #1

**Files:** `docs/architecture.md`

---

## Phase B: Component Rendering Tests

### #4 — Create component test harness and shared mocks

**Description:** Create `src/test/component-harness.tsx` with a `renderWithProviders()` helper that wraps components in required providers (TooltipProvider, etc.), sets up the Tauri IPC mock, and initializes Zustand stores with sensible defaults. Create `src/test/mock-data.ts` with factory functions for common test data: `createMockTab()`, `createMockFileEntry()`, `createMockProject()`, `createMockConnection()`. Extend `tauri-mock.ts` with default handlers for the most common commands (`list_directory`, `read_file`, `path_exists`, `watch_directory`).

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/test/component-harness.tsx`, `src/test/mock-data.ts`; modified: `src/test/tauri-mock.ts`

---

### #5 — Create editor mock for toolbar/findbar/statusbar tests

**Description:** Create `src/test/mock-editor.ts` that exports a `createMockEditor()` function returning a minimal Tiptap `Editor`-like object with stubbed `commands`, `state`, `isActive()`, `can()`, and `chain()`. This allows testing Toolbar, FindBar, and StatusBar without a real ProseMirror instance. Mock the `useEditor` hook to return this object.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/test/mock-editor.ts`

---

### #6 — Component test: StatusBar and FindBar

**Description:** Write tests for the two simplest editor-dependent components. StatusBar: mounts, shows word count and line info from mocked editor. FindBar: mounts, accepts search input, shows match count, responds to Enter/Escape. Both should test light and dark theme by toggling `settings-store.theme`.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4, #5

**Files:** new: `src/components/__tests__/StatusBar.test.tsx`, `src/components/__tests__/FindBar.test.tsx`

---

### #7 — Component test: TabBar

**Description:** Write tests for TabBar. Renders tabs from editor-store, active tab has correct styling, close button appears on hover (or is keyboard accessible), dirty indicator shows for unsaved tabs, clicking a tab calls `setActiveTab`. Use `createMockTab()` factory from #4.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Files:** new: `src/components/__tests__/TabBar.test.tsx`

---

### #8 — Component test: FileTreeItem

**Description:** Write tests for FileTreeItem. Renders file name and folder icon, click on directory triggers expand, click on file calls `onFileClick`, keyboard ArrowRight/ArrowLeft expand/collapse directories, context menu renders on right-click. Set up workspace-store with expand state via `store.setState()`.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Files:** new: `src/components/__tests__/FileTreeItem.test.tsx`

---

### #9 — Component test: Sidebar

**Description:** Write tests for Sidebar and its section components. Renders QuickNotesSection, ProjectsSection, FoldersSection. Each section responds to its workspace-store slice. Collapse/expand sections works. Empty state renders correctly when no projects or folders are open.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4, #8

**Files:** new: `src/components/__tests__/Sidebar.test.tsx`

---

### #10 — Component test: CommandPalette and Toolbar

**Description:** CommandPalette: opens, renders file list, filters on input, prefix modes (`#`, `@`, `>`, `?`) switch mode, keyboard navigation (ArrowDown/Up/Enter) works, Escape closes. Toolbar: renders all formatting buttons, heading picker opens dropdown, buttons reflect editor active state.

**Complexity:** L | **Category:** frontend | **Dependencies:** #4, #5

**Files:** new: `src/components/__tests__/CommandPalette.test.tsx`, `src/components/__tests__/Toolbar.test.tsx`

---

### #11 — Component test: Layout, ChatPanel, SettingsDialog

**Description:** Layout: mounts without crash, renders sidebar and editor panels, resizable panels functional. ChatPanel: renders message list and input, send button present, history tab switches. SettingsDialog: opens, renders all setting tabs (General, Connections, etc.), closes on Escape. These components have many dependencies — focus on smoke tests (mounts, no crash, key elements present).

**Complexity:** L | **Category:** frontend | **Dependencies:** #4, #5

**Files:** new: `src/components/__tests__/Layout.test.tsx`, `src/components/__tests__/ChatPanel.test.tsx`, `src/components/__tests__/SettingsDialog.test.tsx`

---

## Phase C: Playwright E2E Foundation

### #12 — Install Playwright and configure for Vite dev server

**Description:** Install `@playwright/test`. Run `npx playwright install chromium`. Create `playwright.config.ts` with `webServer` pointing to `pnpm dev` on `http://localhost:1420`, `testDir: './e2e'`, Chromium only, HTML reporter on failure. Add `e2e/` directory structure: `e2e/fixtures/`, `e2e/tests/`. Add `test-results/` and `playwright-report/` to `.gitignore`. Verify `pnpm test:e2e` starts dev server and runs an empty test suite.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2

**Files:** new: `playwright.config.ts`, `e2e/fixtures/.gitkeep`, `e2e/tests/.gitkeep`; modified: `package.json`, `.gitignore`

---

### #13 — Create Tauri IPC mock for Playwright

**Description:** Create `e2e/fixtures/tauri-mock.ts` that exports a `setupTauriMock(page)` function. This function calls `page.addInitScript()` to define `window.__TAURI_INTERNALS__` with a mock `invoke` handler. Provide default responses for: `list_directory` (returns sample file tree), `read_file` (returns sample markdown), `write_file` (no-op success), `path_exists` (true), `watch_directory` (no-op), `mark_self_write` (no-op), `open_folder_dialog` (returns test path). Create a helper to add custom command overrides per test. Write a smoke test `e2e/tests/app-loads.spec.ts` that verifies the app renders without errors.

**Complexity:** L | **Category:** frontend | **Dependencies:** #12

**Files:** new: `e2e/fixtures/tauri-mock.ts`, `e2e/fixtures/sample-data.ts`, `e2e/tests/app-loads.spec.ts`

---

### #14 — E2E tests: file operations

**Description:** Write `e2e/tests/file-operations.spec.ts` covering: click file in sidebar → content appears in editor, open second file → new tab opens, switch tabs → content changes, Cmd+S triggers save (verify `write_file` mock called). Use `setupTauriMock` with file tree containing 3-5 sample markdown files.

**Complexity:** M | **Category:** frontend | **Dependencies:** #13

**Files:** new: `e2e/tests/file-operations.spec.ts`

---

### #15 — E2E tests: editor interactions

**Description:** Write `e2e/tests/editor.spec.ts` covering: type text in editor → content updates, type `/` → slash command menu appears, select heading from menu → heading inserted, Cmd+F → find bar opens, type search query → matches highlighted, Escape → find bar closes.

**Complexity:** L | **Category:** frontend | **Dependencies:** #13

**Files:** new: `e2e/tests/editor.spec.ts`

---

### #16 — E2E tests: navigation and UI

**Description:** Write `e2e/tests/navigation.spec.ts` covering: Cmd+K → command palette opens, type filename → filtered results, select result → file opens, Escape → palette closes, Cmd+T → theme toggles (verify class change on `<html>`), Cmd+Shift+C → chat panel opens, Cmd+Shift+L → sidebar toggles.

**Complexity:** M | **Category:** frontend | **Dependencies:** #13

**Files:** new: `e2e/tests/navigation.spec.ts`

---

### #17 — E2E tests: chat panel

**Description:** Write `e2e/tests/chat.spec.ts` covering: open chat panel, type message in input, click send → message appears in list, mock streaming response via `ai-stream-chunk` events → assistant message renders. This requires the Tauri mock to support event emission (mock `listen` to capture handlers, then trigger them from the test).

**Complexity:** L | **Category:** frontend | **Dependencies:** #13

**Files:** new: `e2e/tests/chat.spec.ts`

---

## Phase D: CI Integration

### #18 — GitHub Actions workflow for tests and coverage

**Description:** Create `.github/workflows/test.yml` that runs on push and PR. Steps: (1) checkout, (2) setup Node 22 via `.nvmrc`, (3) `pnpm install`, (4) `pnpm test:coverage` — upload `coverage/` as artifact, (5) `pnpm test:e2e` — upload `playwright-report/` as artifact on failure, (6) `cargo test` in `src-tauri/`. Gate merge on all steps passing. Optionally post coverage summary as PR comment using a GitHub Action (e.g., `davelosert/vitest-coverage-report-action`).

**Complexity:** L | **Category:** both | **Dependencies:** #1, #12

**Files:** new: `.github/workflows/test.yml`