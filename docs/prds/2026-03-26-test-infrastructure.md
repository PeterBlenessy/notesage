# PRD: Test Infrastructure — Coverage, Component Tests, and E2E Foundation

|  |  |
| --- | --- |
| **Date** | 2026-03-26 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Enables data-driven quality decisions, catches regressions before release, unblocks confident refactoring |
| **Research** | [e2e-testing-tauri-macos](../research/e2e-testing-tauri-macos.md) |

## Problem

Notesage has 240 frontend tests and 186 Rust tests, but no way to measure what percentage of the codebase they cover. Coverage tooling is broken on Node 25. Zero components have rendering tests — all 125 `.tsx` files are untested. There is no E2E framework to validate real user flows (open project, edit file, save, switch tabs). The result: regressions are caught manually or not at all, and there is no data to guide where to invest testing effort.

### Current state (2026-03-26)

| Layer | Source files | Files with tests | Estimated coverage |
| --- | --- | --- | --- |
| Components | 125 | 0 | 0% |
| Hooks | 45 | 2 | \~5% |
| Stores | 27 | 5 | \~20% |
| Lib utilities | 42 | 7 | \~15% |
| Editor extensions | 18 | 0 | 0% |
| Rust backend | 50 | 13 | \~30-40% |

## Goals

1. **Coverage numbers visible** — `pnpm test:coverage` prints a line/branch/function coverage table for the frontend; `cargo tarpaulin` or equivalent for Rust
2. **Component rendering tests** for the 10 most critical components — catches mount crashes, missing props, broken interactions
3. **Playwright E2E foundation** — 10+ tests covering core user journeys against the Vite dev server
4. **CI-ready** — all test commands exit 0/1 and produce machine-readable reports (JSON, JUnit)
5. `pnpm test` **remains fast** — unit tests complete in &lt;5s; E2E tests in a separate script

## Non-Goals

- Full E2E testing of Tauri-native features (native dialogs, menubar, window management) — no mature macOS solution exists (see research)
- 80%+ code coverage — the goal is visibility and critical-path coverage, not a vanity number
- Visual regression / screenshot testing — deferred until Playwright E2E is stable
- Vitest Browser Mode — deferred until specific components are identified that need real-browser rendering
- Replacing custom `tauri-mock.ts` with `@tauri-apps/api/mocks` — evaluate during implementation but not required

## User Stories

- As a **developer**, I want to run `pnpm test:coverage` and see which files/functions are untested, so I know where to add tests
- As a **developer**, I want component tests that catch rendering crashes when I refactor props or store shapes
- As a **developer**, I want E2E tests that verify core user flows still work after changes to the editor, sidebar, or chat
- As a **reviewer**, I want CI to report test results and coverage delta on PRs so I can assess regression risk

## Technical Approach

### Phase A: Coverage Tooling

**Problem:** `@vitest/coverage-v8` and `@vitest/coverage-istanbul` both produce zero output on Node 25.2.1 + vitest 4.0.18.

**Solution:** Pin Node version for test runs. Two options (implement whichever works first):

1. `.nvmrc` **with Node 22 LTS** — Add `.nvmrc` file with `22`. Test scripts use `nvm exec` or developer switches manually. CI uses the pinned version.
2. `volta pin` — If volta is available, pin Node 22 in `package.json`. Transparent to all tooling.

**Coverage config** in `vitest.config.ts`:

```typescript
coverage: {
  provider: 'istanbul',
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: './coverage',
  thresholds: {
    // Start with no enforcement — just visibility
    // Increase thresholds as coverage grows
  },
}
```

**Scripts** in `package.json`:

```json
{
  "test": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "test:all": "vitest run && playwright test"
}
```

**Rust coverage:** Add `cargo-tarpaulin` or `cargo-llvm-cov` to the CI pipeline. Not required locally but should be documented.

### Phase B: Component Rendering Tests

Use `@testing-library/react` (already installed) with vitest + jsdom to render components and assert on output.

**Target components** (10 most critical, ordered by risk):

| Component | Why critical | Key assertions |
| --- | --- | --- |
| `Layout.tsx` | Root layout — if this breaks, nothing renders | Mounts without crash, renders sidebar + editor areas |
| `Sidebar.tsx` | Always visible, complex state | Renders project list, file tree sections |
| `FileTreeItem.tsx` | Recursive, keyboard nav, context menu | Renders file/folder, responds to click, keyboard expand/collapse |
| `TabBar.tsx` | Tab management, dirty indicators | Renders tabs, active tab highlighted, close button works |
| `Toolbar.tsx` | Editor formatting, many sub-components | Renders all buttons, heading picker opens |
| `FindBar.tsx` | Find/replace, keyboard shortcuts | Opens, accepts input, shows match count |
| `CommandPalette.tsx` | Global navigation, prefix modes | Opens, filters items, keyboard navigation |
| `ChatPanel.tsx` | AI chat, streaming, tool calls | Renders message list, input area, send button |
| `StatusBar.tsx` | Always visible footer | Renders word count, line info |
| `SettingsDialog.tsx` | Complex form, many tabs | Opens, renders tab navigation, closes |

**Mocking strategy:**

- Tauri IPC: use existing `src/test/tauri-mock.ts` with `setMockInvokeHandler` for each command the component needs
- Zustand stores: test against real stores with initial state set via `store.setState()`
- Tiptap editor: mock `useEditor` return value for components that depend on editor instance (Toolbar, FindBar, StatusBar)

**Test file location:** `src/components/__tests__/<ComponentName>.test.tsx`

### Phase C: Playwright E2E Foundation

**Architecture:** Playwright opens Chromium pointed at `http://localhost:1420` (Vite dev server). Tauri IPC is intercepted via a page-level setup script that mocks `window.__TAURI_INTERNALS__`.

**Config** (`playwright.config.ts`):

```typescript
export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:1420',
  },
});
```

**IPC mock setup** (`e2e/fixtures/tauri-mock.ts`):

Before each test, inject a script that defines `window.__TAURI_INTERNALS__` with mock responses for common commands (`list_directory`, `read_file`, `write_file`, `path_exists`, etc.). This allows the React app to initialize and render without a real Tauri backend.

**Target E2E tests** (10 core user journeys):

| Test | What it validates |
| --- | --- |
| App loads | Page renders without errors, sidebar and editor visible |
| Open project | Sidebar shows file tree after folder selection |
| Open file | Clicking a file loads content in editor |
| Edit and save | Type text, Cmd+S triggers save |
| Tab management | Open multiple files, switch tabs, close tab |
| Slash commands | Type `/`, menu appears, select heading |
| Find in document | Cmd+F opens find bar, search highlights matches |
| Command palette | Cmd+K opens palette, type to filter, select item |
| Theme toggle | Cmd+T switches light/dark, colors change |
| Chat panel | Cmd+Shift+C opens chat, type message, send |

**File structure:**

```
e2e/
  fixtures/
    tauri-mock.ts      # IPC mock setup injected into page
  tests/
    app-loads.spec.ts
    file-operations.spec.ts
    editor.spec.ts
    navigation.spec.ts
    chat.spec.ts
playwright.config.ts
```

### Phase D: CI Integration

- **GitHub Actions workflow** (or equivalent): run `pnpm test:coverage` and `pnpm test:e2e` on push/PR
- Coverage report uploaded as artifact or posted as PR comment
- Playwright report (HTML) uploaded as artifact on failure
- Rust tests: `cargo test` in the existing CI step

## Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| `@vitest/coverage-istanbul` | Coverage instrumentation | Was installed, removed due to Node 25 issue |
| `@testing-library/react` | Component rendering + assertions | Already installed (v16.3.2) |
| `@playwright/test` | E2E browser testing | New — `pnpm add -D @playwright/test` |
| Node 22 LTS | Coverage tooling compatibility | Pin via `.nvmrc` or volta |
| `jsdom` | DOM environment for vitest | Already installed (v29.0.1) |

## Quality Gates

### Coverage tooling (Phase A)

- [ ] `pnpm test:coverage` prints a text table with Stmts/Branch/Func/Lines percentages

- [ ] `coverage/` directory contains JSON summary and HTML report

- [ ] Coverage report works in CI (GitHub Actions or equivalent)

- [ ] `.nvmrc` or volta pin ensures correct Node version

### Component tests (Phase B)

- [ ] 10 component test files exist in `src/components/__tests__/`

- [ ] Each component mounts without crash in both light and dark theme

- [ ] Key interactions tested (click, keyboard, open/close)

- [ ] Total component test count: 30+ assertions across 10 files

- [ ] All tests pass in `pnpm test`

### Playwright E2E (Phase C)

- [ ] `pnpm test:e2e` runs 10+ E2E tests against dev server

- [ ] Tauri IPC mock allows app to load and function without Rust backend

- [ ] Tests cover: app load, file open, edit, save, tabs, slash commands, find, palette, theme, chat

- [ ] Tests complete in &lt;60s total

- [ ] Playwright HTML report generated on failure

### CI integration (Phase D)

- [ ] CI runs `pnpm test:coverage` and `pnpm test:e2e` on every PR

- [ ] Failed tests block merge

- [ ] Coverage report accessible as artifact or PR comment

## Out of Scope

- True E2E with real Tauri runtime (no mature macOS solution — see [research](../research/e2e-testing-tauri-macos.md))
- Visual regression / screenshot comparison (defer until Playwright E2E is stable)
- Vitest Browser Mode (defer until specific DOM-dependent components are identified)
- Replacing `tauri-mock.ts` with `@tauri-apps/api/mocks` (evaluate but not required)
- Enforcing minimum coverage thresholds (start with visibility, add thresholds later)
- Rust coverage tooling (`cargo-tarpaulin`) — document but defer local setup
- Testing Tauri-native features: native dialogs, menubar, window management, filesystem sandboxing