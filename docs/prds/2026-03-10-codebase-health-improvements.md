# PRD: Codebase Health Improvements

**Date:** 2026-03-10 (updated 2026-03-15) **Status:** 📋 Planned **Source:** `docs/research/codebase-analysis.md` (2026-03-09) **Structure:** 12 independent, incremental tasks — each can ship in any release, in any order.

---

## Problem

Notesage has grown from a simple markdown editor to a 29K-line codebase (16K frontend, 13K Rust) with 85+ Tauri commands, 13+ Zustand stores, and 6 concurrent ProseMirror decoration layers. The dependency choices and core architecture are sound, but organic growth has created:

1. **Reliability gaps** — no React error boundaries means a single hook crash blanks the entire app; duplicated JSON-RPC transport code means protocol bugs must be fixed in two places.
2. **Maintainability pressure** — 7 files exceed 700 lines (largest: Editor.tsx at 1,649), making changes risky and code review slow.
3. **Dependency hygiene debt** — an archived Rust crate, a Next.js-specific theme library in a Tauri app, and over-broad feature flags increasing compile time.

None of these are blocking users today, but each increases the cost and risk of future feature work.

## Goals

- Eliminate white-screen crash risk by containing component failures
- Reduce code duplication in the Rust backend (JSON-RPC transport)
- Bring the largest files under 500 lines each through focused decomposition
- Remove or replace dependencies that are unmaintained, mismatched, or unused
- Each task is independently shippable — no task depends on another

## Non-Goals

- Rewriting core architecture (Tiptap, Zustand, Tauri command pattern)
- Adding new features or changing user-facing behavior
- Migrating to a monorepo or package restructure
- Changing the `Result<T, String>` error pattern (deferred unless error messages become a user pain point)
- Replacing git CLI with libgit2 (working fine, not on hot path)

---

## Tasks

### Task 1: React Error Boundaries ✅

**Priority:** High — reliability **Effort:** Small (\~50 lines of code)

**Problem:** A runtime error in any component (especially the editor with 13 co-mounted hooks) renders the entire app as a white screen. No recovery path exists.

**Approach:**

- Create a reusable `ErrorBoundary` component using React's `componentDidCatch` / `getDerivedStateFromError`
- Wrap three critical zones: Editor area, ChatPanel, Sidebar
- Display a "Something went wrong" fallback with a "Reload" button that re-mounts the subtree
- Log caught errors to console and optionally to `tauri-plugin-log`

**Files to create/modify:**

- `src/components/ErrorBoundary.tsx` — new, reusable error boundary component
- `src/App.tsx` — wrap Editor, ChatPanel, Sidebar panels in `<ErrorBoundary>`

**Quality gate:**

- [x] Throwing an error in a hook within Editor.tsx shows the fallback UI, not a white screen

- [x] Chat panel and sidebar can crash independently without affecting the editor

- [x] "Reload" button recovers the crashed zone without a full page reload

- [x] No visual change during normal operation

---

### Task 2: Shared JSON-RPC Transport (Rust)

**Priority:** High — reliability, deduplication **Effort:** Medium (\~300 lines moved, \~100 new)

**Problem:** `copilot_lsp.rs` (1,537 lines) and `mcp.rs` (988 lines) each implement their own JSON-RPC 2.0 transport with Content-Length framing, async reader tasks, and pending request maps. Bugs fixed in one are not fixed in the other.

**Approach:**

- Create `src-tauri/src/commands/json_rpc.rs` with shared types and transport:
  - `JsonRpcTransport` struct: wraps `ChildStdin`/`ChildStdout`, handles Content-Length framing
  - `send_request()`, `send_notification()` methods
  - Async reader task that dispatches responses to pending request channels and notifications to a callback
  - `PendingRequests` map (request ID → oneshot sender)
- Refactor `copilot_lsp.rs` and `mcp.rs` to use the shared transport
- Keep protocol-specific logic (LSP document sync, MCP tool discovery) in their respective modules

**Files to create/modify:**

- `src-tauri/src/commands/json_rpc.rs` — new shared module
- `src-tauri/src/commands/copilot_lsp.rs` — refactor to use shared transport
- `src-tauri/src/commands/mcp.rs` — refactor to use shared transport
- `src-tauri/src/commands/mod.rs` — add `json_rpc` module

**Quality gate:**

- [ ] Copilot LSP inline completions work identically to before

- [ ] MCP server start/stop/tool-call work identically to before

- [ ] No duplicated Content-Length framing or request dispatch logic remains

- [x] `json_rpc.rs` has unit tests for message framing and request/response matching

---

### Task 3: Decompose `useAIOperations.ts`

**Priority:** High — maintainability **Effort:** Medium (refactor, no behavior change)

**Problem:** `useAIOperations.ts` is 1,022 lines mixing ACP lifecycle management, prompt/context building, error formatting, and chat streaming orchestration. Changes are risky because everything is intertwined.

**Approach:**

- Extract `src/lib/ai/context.ts` — pure functions for building system messages, injecting goals, file trees, skills, and agent instructions into prompts. No React hooks, no side effects.
- Extract `src/lib/ai/errors.ts` — `friendlyAIError()` and related error formatting. No React hooks.
- Extract `src/hooks/useAcpLifecycle.ts` — ACP agent spawning, session management, event listeners, permission handling. Contains the module-level `acpSessionByInstance` state (or move it to a store).
- Slim `useAIOperations.ts` to a thin orchestration layer that composes the above.

**Files to create/modify:**

- `src/lib/ai/context.ts` — new
- `src/lib/ai/errors.ts` — new
- `src/hooks/useAcpLifecycle.ts` — new
- `src/hooks/useAIOperations.ts` — refactor (target: &lt;300 lines)

**Quality gate:**

- [ ] All AI chat, inline actions, and ACP interactions work identically

- [ ] `useAIOperations.ts` is under 300 lines

- [ ] No module-level mutable state remains in `useAIOperations.ts` (moved to store or `useAcpLifecycle`)

- [ ] Context building functions have unit tests

---

### Task 4: Decompose `Editor.tsx`

**Priority:** Medium — maintainability **Effort:** Medium-Large (largest file, many dependencies)

**Problem:** `Editor.tsx` is 1,649 lines with 100+ useState calls, 20+ useEffect hooks, and 13 co-mounted custom hooks. It mixes rendering, scroll persistence, resize handling, transcription UI, and source mode editing.

**Approach:**

- Extract `src/hooks/useScrollPersistence.ts` — scroll position save/restore with LRU cache, double-RAF restore technique, `isResizing` guard
- Extract `src/hooks/useEditorResize.ts` — ResizeObserver setup, content width management, scroll suppression during resize
- Extract `src/components/editor/TranscriptionOverlay.tsx` — transcription dialog, recording indicator, related state
- Extract `src/components/editor/SourceModeEditor.tsx` — CodeMirror source mode (already somewhat self-contained in the render logic)

**Files to create/modify:**

- `src/hooks/useScrollPersistence.ts` — new
- `src/hooks/useEditorResize.ts` — new
- `src/components/editor/TranscriptionOverlay.tsx` — new
- `src/components/editor/SourceModeEditor.tsx` — new
- `src/components/editor/Editor.tsx` — refactor (target: &lt;800 lines)

**Quality gate:**

- [ ] Rich text editing, save, tab switching all work identically

- [ ] Scroll position persists across tab switches and app restarts

- [ ] Source mode toggle works with no visible change

- [ ] Transcription/recording UI works identically

- [ ] `Editor.tsx` is under 800 lines

---

### Task 5: Decompose `App.tsx`

**Priority:** Medium — maintainability **Effort:** Small-Medium

**Problem:** `App.tsx` is 966 lines mixing lifecycle orchestration (6+ hooks, event listeners, startup validation) with layout rendering.

**Approach:**

- Extract `src/hooks/useAppLifecycle.ts` — consolidate startup hooks, event listeners (tag badge clicks, ACP cleanup, visibility change, drag/drop prevention, startup tree reload)
- Extract `src/components/Layout.tsx` — the `ResizablePanelGroup` layout with sidebar, editor, chat panel, activity panel
- Slim `App.tsx` to mount `useAppLifecycle()` and render `<Layout />`

**Files to create/modify:**

- `src/hooks/useAppLifecycle.ts` — new
- `src/components/Layout.tsx` — new
- `src/App.tsx` — refactor (target: &lt;200 lines)

**Quality gate:**

- [ ] App startup, panel resizing, and all lifecycle behaviors work identically

- [ ] All hooks still mount correctly (critical — see MEMORY.md startup hooks pattern)

- [ ] `App.tsx` is under 200 lines

---

### Task 6: Decompose `skills.rs` (Rust) ✅

**Priority:** Medium — maintainability **Effort:** Medium

**Problem:** `skills.rs` is 1,643 lines mixing skill discovery, agent discovery, agent instruction scanning, script execution, and YAML frontmatter parsing.

**Approach:**

- Extract `src-tauri/src/commands/agents.rs` — agent file discovery, bundled agent extraction, agent instruction scanning
- Extract `src-tauri/src/commands/script_exec.rs` — skill script execution, timeout handling, interpreter resolution, path traversal protection
- Keep `skills.rs` focused on skill discovery, YAML parsing, and bundled skill extraction

**Files to create/modify:**

- `src-tauri/src/commands/agents.rs` — new
- `src-tauri/src/commands/script_exec.rs` — new
- `src-tauri/src/commands/skills.rs` — refactor (target: &lt;600 lines)
- `src-tauri/src/commands/mod.rs` — add new modules
- `src-tauri/src/lib.rs` — update command registration if function names change

**Quality gate:**

- [x] Skill discovery, agent discovery, and script execution all work identically

- [x] `skills.rs` is under 600 lines

- [x] All Tauri commands still registered and callable from frontend

---

### Task 7: Decompose `CommentPopover.tsx`

**Priority:** Medium — maintainability **Effort:** Small

**Problem:** `CommentPopover.tsx` is 706 lines handling comment CRUD, delegation UI, activity log display, and multi-turn thread rendering.

**Approach:**

- Extract `src/components/editor/DelegationPanel.tsx` — delegation UI (delegate button, cancel, activity log, status)
- Extract `src/components/editor/CommentThread.tsx` — multi-turn reply thread rendering (user vs agent messages, apply button, timestamps)
- Keep `CommentPopover.tsx` as the container with create/edit/delete forms

**Files to create/modify:**

- `src/components/editor/DelegationPanel.tsx` — new
- `src/components/editor/CommentThread.tsx` — new
- `src/components/editor/CommentPopover.tsx` — refactor (target: &lt;300 lines)

**Quality gate:**

- [ ] Comment create, edit, delete, delegate all work identically

- [ ] Multi-turn threads render correctly with apply-to-document

- [ ] Activity log displays and updates during active delegation

- [ ] `CommentPopover.tsx` is under 300 lines

---

### Task 8: Migrate `serde_yaml` to `serde_yml` ✅

**Priority:** Medium — dependency health **Effort:** Tiny (drop-in replacement)

**Problem:** The `serde_yaml` crate (v0.9) is archived and unmaintained. `serde_yml` is the actively maintained fork with an identical API.

**Approach:**

- Replace `serde_yaml = "0.9"` with `serde_yml = "0.9"` in `Cargo.toml`
- Find-and-replace `serde_yaml::` with `serde_yml::` across all Rust files
- Verify compilation and run existing tests

**Files to modify:**

- `src-tauri/Cargo.toml`
- `src-tauri/src/commands/skills.rs` (imports `serde_yaml`)
- `src-tauri/src/index/parser.rs` (imports `serde_yaml`)

**Quality gate:**

- [x] `cargo build` succeeds with no warnings from the YAML crate

- [x] Skill/agent YAML frontmatter parsing works identically

- [x] No references to `serde_yaml` remain in the codebase

---

### Task 9: Replace `next-themes` with Custom Hook ✅

**Priority:** Medium — dependency hygiene **Effort:** Small (\~30 lines)

**Problem:** `next-themes` is designed for Next.js SSR (script injection, attribute-based theming, hydration mismatch prevention). None of this applies in a Tauri app. It's a mismatched dependency.

**Approach:**

- Create `src/hooks/useTheme.ts` with:
  - Read initial theme from `localStorage` or `prefers-color-scheme` media query
  - Toggle function that updates `document.documentElement.classList` and `localStorage`
  - Media query listener for system preference changes
- Remove `next-themes` from `package.json`
- Update all `useTheme()` import sites

**Files to create/modify:**

- `src/hooks/useTheme.ts` — new
- `src/App.tsx` or wherever `ThemeProvider` is currently mounted — remove provider
- All files importing from `next-themes` — update imports
- `package.json` — remove `next-themes`

**Quality gate:**

- [x] Light/dark toggle (Cmd+T) works identically

- [x] System preference following works

- [x] Theme persists across app restarts

- [x] `next-themes` no longer in `node_modules` after `pnpm install`

---

### Task 10: Add Permission Store Unit Tests ✅

**Priority:** Medium — reliability **Effort:** Small

**Problem:** `permission-store` implements a complex state machine (session vs always tiers, skill scripts vs ACP tools, auto-allow checks) that is security-critical and entirely untested.

**Approach:**

- Create `src/stores/__tests__/permission-store.test.ts`
- Test cases:
  - `allowSession()` grants access, `removeSession()` revokes it
  - `allowAlways()` persists, `removeAlways()` revokes
  - `getToolTier()` returns correct tier (`none`, `session`, `always`)
  - `isAutoAllowed()` checks both tiers correctly
  - Skill script permissions are independent from ACP tool permissions
  - Session permissions don't survive store rehydration (non-persisted)
  - Always permissions do survive rehydration

**Files to create:**

- `src/stores/__tests__/permission-store.test.ts`

**Quality gate:**

- [x] All test cases pass via `pnpm test`

- [x] Coverage of all public methods on the permission store

- [x] Tests verify persistence behavior (session = volatile, always = persisted)

---

### Task 11: Audit and Remove `hound` Crate ✅

**Priority:** Low — compile time **Effort:** Tiny

**Problem:** The `hound` crate (WAV I/O) may be unused since audio stays in f32 memory buffers and resampling is done via manual linear interpolation in `transcription.rs`.

**Approach:**

- Search for `hound::` and `use hound` in all Rust files
- If no references found, remove from `Cargo.toml`
- If references exist, document why it's needed

**Files to modify:**

- `src-tauri/Cargo.toml` (if removing)

**Quality gate:**

- [x] `cargo build` succeeds

- [x] Recording and transcription still work if `hound` was removed

- [ ] ~~Or: document the specific code path that requires `hound`~~ (N/A — removed, zero imports)

---

### Task 12: Slim `tokio` Features and Move `@types` to devDependencies ✅

**Priority:** Low — build hygiene **Effort:** Tiny

**Problem:**

- `tokio` uses `features = ["full"]` pulling in every feature. Only a subset is needed, and specifying them reduces compile time.
- `@types/diff-match-patch` is in `dependencies` instead of `devDependencies`.

**Approach:**

- Audit which tokio features are actually used (likely: `rt-multi-thread`, `macros`, `io-util`, `process`, `sync`, `time`, `net`, `fs`)
- Replace `features = ["full"]` with the specific list
- Move `@types/diff-match-patch` to `devDependencies` in `package.json`

**Files to modify:**

- `src-tauri/Cargo.toml`
- `package.json`

**Quality gate:**

- [x] `cargo build` succeeds with slimmed features

- [x] `pnpm build` succeeds

- [x] All async operations (AI streaming, subprocess management, file ops) still work

---

## Implementation Order (Suggested)

No task depends on another. Suggested order by impact-to-effort ratio:

 1. **Task 1** — Error boundaries (tiny effort, prevents white-screen crashes)
 2. **Task 8** — `serde_yaml` → `serde_yml` (drop-in, removes archived dependency)
 3. **Task 12** — `@types` move + tokio slim (trivial, improves build hygiene)
 4. **Task 11** — Audit `hound` (trivial investigation)
 5. **Task 9** — Replace `next-themes` (small, removes mismatched dependency)
 6. **Task 10** — Permission store tests (small, improves confidence in security-critical code)
 7. **Task 2** — Shared JSON-RPC transport (medium, eliminates protocol duplication)
 8. **Task 3** — Decompose `useAIOperations` (medium, biggest maintainability win)
 9. **Task 7** — Decompose `CommentPopover` (small, self-contained)
10. **Task 5** — Decompose `App.tsx` (small-medium, improves clarity)
11. **Task 6** — Decompose `skills.rs` (medium, Rust refactor)
12. **Task 4** — Decompose `Editor.tsx` (largest effort, highest risk, do last)

## Out of Scope

- Custom `AppError` enum for Tauri commands (deferred unless error messages become a user pain point)
- Replacing git CLI with `git2` crate (working fine, not on hot path)
- Switching `yaml` → `gray-matter` on frontend (low value, current approach works)
- Settings store restructuring (defer to next major settings feature)
- CRDT / real-time collaboration (separate initiative)
- Monorepo restructure (premature at current codebase size)
- New features of any kind — this is strictly internal health