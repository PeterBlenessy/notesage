# E2E & Integration Testing Options for Tauri v2 on macOS

**Date:** 2026-03-26 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [test-infrastructure](../prds/2026-03-26-test-infrastructure.md) | Draft |
| Tasks | [test-infrastructure-tasks](../tasks/2026-03-26-test-infrastructure-tasks.md) | Not started |

**Context:** Notesage is a Tauri v2 desktop app (React + Rust) targeting macOS. The official `tauri-driver` does NOT support macOS (Apple's `safaridriver` cannot automate embedded WKWebView). This research evaluates all viable alternatives for automated testing.

## Executive Summary

No mature true E2E solution exists for Tauri v2 on macOS. The recommended strategy is a layered approach: expand unit tests (vitest + jsdom), add Playwright pointed at the Vite dev server with Tauri IPC mocks for frontend E2E, and selectively use Vitest Browser Mode for components that need real browser rendering.

## Current Test Infrastructure (as of 2026-03-26)

- **Vitest 4.0.18** with jsdom environment, 240 frontend tests across 12 test files
- **Cargo test** with 186 Rust tests (index, export, skills, agents, JSON-RPC, network proxy)
- **No E2E framework**, no Playwright, no Cypress, no component rendering tests
- **No coverage tooling** — both `@vitest/coverage-v8` and `@vitest/coverage-istanbul` silently produce zero output on Node 25.2.1 + vitest 4.0.18 (likely a compatibility bug)
- **Tauri IPC mocking** via custom `src/test/tauri-mock.ts` (mocks `@tauri-apps/api/core` invoke and `@tauri-apps/api/event` listen/emit)
- **@testing-library/react** installed for hook testing via `renderHook`
- **Vite dev server** runs at `http://localhost:1420` (accessible in any browser, but `invoke()` calls fail without Tauri runtime)

### Codebase size

| Layer | Files | Tested files | Estimated coverage |
| --- | --- | --- | --- |
| Components (`.tsx`, excl. shadcn/ui) | 125 | 0 | 0% |
| Hooks | 45 | 2 | \~5% |
| Stores | 27 | 5 | \~20% |
| Lib utilities | 42 | 7 | \~15% |
| Editor extensions | 18 | 0 | 0% |
| Rust source files | 50 | 13 (have `#[cfg(test)]`) | \~30-40% |

## Options Evaluated

### 1. Playwright via Dev Server

**How it works:** Playwright opens a real Chromium/Firefox/WebKit browser pointed at `http://localhost:1420`. Tests interact with the React frontend as a regular web app. Tauri IPC is mocked via `@tauri-apps/api/mocks` or a custom `window.__TAURI_INTERNALS__` shim injected in test setup.

- **macOS support:** Full
- **What it tests:** Web layer (React components, routing, editor, chat, settings). Does NOT test Rust backend or native features (dialogs, filesystem) without mocking.
- **Setup complexity:** Low. Standard `playwright.config.ts` with `webServer` block pointing to `pnpm dev`.
- **Maturity:** Very high. Dominant E2E framework.
- **Real-world usage:** KittyCAD/modeling-app (a production Tauri v2 app) uses this exact approach — Playwright for web-layer E2E, tauri-driver on Linux only for desktop-specific tests.
- **Limitations:** Tests run in Chromium, not WKWebView — rendering differences possible but rare for React apps. Cannot test native dialogs, menubar, or window management.
- **Verdict:** Best option for frontend E2E. Covers \~85% of user-visible behavior.

### 2. Vitest Browser Mode

**How it works:** Vitest 4+ can run test files inside a real browser (Chromium via Playwright provider). Uses `vitest-browser-react` for component rendering. Tests have access to real DOM, CSS, and layout — unlike jsdom which simulates these.

- **macOS support:** Full
- **What it tests:** Individual React components in a real browser. Not full E2E (no page navigation), but catches rendering bugs, CSS issues, and event handling that jsdom misses.
- **Setup complexity:** Low — already have Vitest 4. Add `@vitest/browser` and `vitest-browser-react`, configure a browser workspace. Coexists with existing jsdom tests.
- **Maturity:** Stable since Vitest 4.
- **Limitations:** \~2-3x slower than jsdom. Best for components with DOM-dependent behavior (ProseMirror editor, CSS-dependent animations). Pure logic tests should stay on jsdom.
- **Verdict:** Good supplement for editor rendering and CSS-dependent components.

### 3. Tauri Official IPC Mocks (`@tauri-apps/api/mocks`)

**How it works:** `mockIPC()` intercepts all `invoke()` calls and routes them to a JavaScript handler. Official Tauri package.

```typescript
import { mockIPC } from '@tauri-apps/api/mocks';

mockIPC((cmd, args) => {
  if (cmd === 'read_file') return '# Hello';
  if (cmd === 'list_directory') return [{ name: 'test.md', path: '/test.md', is_directory: false }];
});
```

- **macOS support:** Full (runs in jsdom/browser)
- **Setup complexity:** Low. Already in `@tauri-apps/api` (project dependency).
- **Maturity:** Official, maintained by Tauri team.
- **Limitations:** Tests mocks, not the real backend. IPC contract changes are not caught.
- **Verdict:** Should replace or supplement our custom `tauri-mock.ts`. Lower maintenance, better Tauri compatibility.

### 4. tauri-driver (Official)

**macOS support:** NOT supported. Apple does not provide WebDriver for embedded WKWebView.

- Works on Linux (`WebKitWebDriver`) and Windows (`msedgedriver`).
- This is the confirmed gap that drove all community alternatives.
- **Verdict:** Not viable for macOS development.

### 5. tauri-plugin-webdriver (Community)

**How it works:** Two components: (1) a Tauri plugin that embeds an HTTP server in debug builds and injects a JS bridge into WKWebView, and (2) a CLI that implements W3C WebDriver on port 4444. Test frameworks (WebDriverIO, Selenium) connect to the CLI.

- **macOS support:** Yes — specifically designed to solve the macOS gap.
- **What it tests:** Real app with real Tauri IPC and real WKWebView rendering. True E2E.
- **Repos:** [Choochmeque/tauri-webdriver](https://github.com/Choochmeque/tauri-webdriver) (\~2 stars, 48 commits), [danielraffel/tauri-webdriver](https://github.com/danielraffel/tauri-webdriver) (newer, blog post: [I Built a WebDriver for WKWebView Tauri Apps on macOS](https://danielraffel.me/2026/02/14/i-built-a-webdriver-for-wkwebview-tauri-apps-on-macos/))
- **Maturity:** Early stage. Not 100% W3C WebDriver coverage. Individual developers, not Tauri team.
- **Limitations:** Adds Rust dependency. Debug-only builds. Small user base. Edge cases may not be handled.
- **Verdict:** Monitor for maturity. Not recommended for production use yet.

### 6. tauri-remote-ui

**How it works:** Tauri plugin that exposes the app's UI to a web browser via WebSocket proxy. Browser session can interact with the Tauri app as if it were the WKWebView.

- **macOS support:** Yes
- **Maturity:** Alpha stage (repo branch literally named "alpha").
- **Repo:** [DraviaVemal/tauri-remote-ui](https://github.com/DraviaVemal/tauri-remote-ui)
- **Verdict:** Not ready. Monitor.

### 7. Appium mac2-driver

**How it works:** Uses Apple's XCTest framework and macOS Accessibility API to automate native apps. Finds elements by accessibility identifiers, clicks buttons, types text.

- **macOS support:** Full (macOS 10.15+, Xcode 12+)
- **What it tests:** Native application as a whole — window management, native menus, actual rendered UI. Interacts through the accessibility tree, NOT the DOM.
- **Setup complexity:** High. Requires Xcode, Accessibility permissions, Appium server.
- **Maturity:** Mature (Appium ecosystem).
- **Limitations:** Cannot inspect web content internals (DOM, React state, ProseMirror). Slow. Overkill for a web-centric Tauri app.
- **Verdict:** Only useful for smoke-testing native behavior (window opens, menu works). Not recommended as primary test approach.

### 8. Cypress

- **macOS support:** Full (browser-based)
- **What it tests:** Same as Playwright — web layer only.
- **Verdict:** Declining relative to Playwright. No advantage for this use case. Architectural limitations (single-tab, same-origin). Cypress team has stated testing Tauri apps is "likely not possible" for full E2E without major modifications.

### 9. Visual Regression (Playwright Screenshots)

**How it works:** Playwright's `toHaveScreenshot()` captures and compares screenshots pixel-by-pixel against baselines.

- **macOS support:** Full
- **Setup complexity:** Low-Medium. Needs consistent rendering environment for CI.
- **Limitations:** Brittle across environments. Tests appearance only, not behavior. Baseline management overhead.
- **Verdict:** Good supplement once Playwright E2E is established. Useful for catching CSS regressions across light/dark/soft themes.

## Comparison Table

| Approach | Tests Real App? | macOS | Setup | Maturity | Recommended? |
| --- | --- | --- | --- | --- | --- |
| **Playwright via dev server** | Web layer (mock IPC) | Full | Low | Very High | Yes — primary E2E |
| **Vitest Browser Mode** | Components in real browser | Full | Low | Stable | Yes — selective |
| **Tauri IPC mocks** | Frontend + mocked backend | Full | Low | Official | Yes — replace custom mock |
| **Visual regression** | Screenshots only | Full | Low-Med | Mature | Yes — after Playwright |
| **Vitest + jsdom (current)** | Simulated DOM | Full | Done | Very High | Yes — expand |
| tauri-plugin-webdriver | Full app | Yes | Med-High | Early (2 stars) | Monitor |
| tauri-remote-ui | Full app via proxy | Yes | Medium | Alpha | Monitor |
| Appium mac2 | Native via A11y API | Yes | High | Mature | No — overkill |
| Cypress | Web layer only | Full | Medium | Declining | No — use Playwright |
| tauri-driver (official) | Full app | **NO** | N/A | Official | No — no macOS |

## Recommended Strategy

### Layer 1: Fix coverage tooling (unblock visibility)

Coverage is broken on Node 25 + vitest 4.0. Options:

- Pin Node 22 LTS for test runs (`.nvmrc` or `volta pin`)
- Wait for vitest 4.1+ fix
- Use a coverage script that spawns Node 22 via nvm

### Layer 2: Expand vitest + jsdom (highest ROI)

- More hook tests (25+ hooks untested)
- More store tests (15+ stores untested)
- Editor extension unit tests
- Switch to `@tauri-apps/api/mocks` for official IPC mocking

### Layer 3: Playwright via dev server (frontend E2E)

- Point at `http://localhost:1420` with `webServer` config
- Mock Tauri IPC via page-level script injection
- Test critical flows: open project, edit file, save, switch tabs, slash commands, chat, find/replace, settings
- 10-15 core E2E tests covering the most important user journeys

### Layer 4: Vitest Browser Mode (selective)

- ProseMirror editor rendering tests
- CSS-dependent component tests (theme switching, animations)
- Separate vitest workspace for browser tests

### Layer 5: Visual regression (optional)

- Playwright screenshots for key views in light/dark/soft-contrast
- Only after Layer 3 is stable

## Sources

- [Tauri v2 Tests Overview](https://v2.tauri.app/develop/tests/)
- [Tauri v2 WebDriver — no macOS support](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri v2 Mock APIs](https://v2.tauri.app/develop/tests/mocking/)
- [Tauri v2 Mock API Reference](https://v2.tauri.app/reference/javascript/api/namespacemocks/)
- [tauri-plugin-webdriver (Choochmeque)](https://github.com/Choochmeque/tauri-webdriver)
- [tauri-webdriver for macOS (danielraffel)](https://github.com/danielraffel/tauri-webdriver)
- [Blog: WebDriver for WKWebView Tauri Apps on macOS](https://danielraffel.me/2026/02/14/i-built-a-webdriver-for-wkwebview-tauri-apps-on-macos/)
- [tauri-remote-ui](https://github.com/DraviaVemal/tauri-remote-ui)
- [KittyCAD/modeling-app Playwright approach](https://github.com/KittyCAD/modeling-app/issues/983)
- [Tauri E2E Discussion #3768](https://github.com/tauri-apps/tauri/discussions/3768)
- [Tauri E2E Discussion #10123](https://github.com/tauri-apps/tauri/discussions/10123)
- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [vitest-browser-react](https://vitest.dev/api/browser/react)
- [Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)
- [Playwright Web Server Config](https://playwright.dev/docs/test-webserver)
- [Appium mac2-driver](https://github.com/appium/appium-mac2-driver)
- [Cypress + Tauri Discussion](https://github.com/cypress-io/cypress/discussions/24838)
- [Tauri macOS WebDriver Feature Request #7068](https://github.com/tauri-apps/tauri/issues/7068)