# Task Breakdown: Codebase Health Improvements

**Status:** 📋 Planned

**Source PRD:** `docs/prds/2026-03-10-codebase-health-improvements.md`**Total:** 18 tasks — 8S, 7M, 3L **No task depends on another** — all are independently shippable.

## Suggested Implementation Order

Grouped by effort-to-impact ratio. Pick any task at any time.

**Quick wins (1-2 tasks per session)**:Tasks 1, 2, 3, 15, 16, 17, 18

**Focused refactors (1 task per session)**:Tasks 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14

---

## Reliability

### #1 — Create reusable `ErrorBoundary` component ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/ErrorBoundary.tsx` (new) |

Create a reusable React Error Boundary using `componentDidCatch` / `getDerivedStateFromError`. Should accept a `name` prop for logging which zone crashed. Fallback UI: centered card with "Something went wrong in \[zone\]" message and a "Reload" button that re-mounts the subtree by toggling a key. Log caught errors to console.

**Acceptance criteria:**

- Class component (Error Boundaries require `getDerivedStateFromError`)
- Accepts `children`, `name` (string), optional `fallback` (ReactNode) props
- "Reload" button resets error state and re-mounts children
- Matches design system (shadcn Button, muted text, centered layout)

---

### #2 — Wrap critical zones in error boundaries

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/App.tsx` (or `Layout.tsx` if Task 5 is done first) |

Wrap three critical zones in `<ErrorBoundary>`: the editor panel, the chat panel, and the sidebar. Each should crash independently without affecting the others.

**Acceptance criteria:**

- Throwing an error in Editor.tsx shows fallback UI, chat and sidebar remain functional
- Throwing an error in ChatPanel shows fallback, editor remains functional
- Throwing an error in Sidebar shows fallback, editor remains functional
- No visual change during normal operation

---

### #3 — Add ACP tool permission unit tests

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/__tests__/permission-store-acp.test.ts` (new) |

Skill script permissions are already tested in `permission-store-skills.test.ts`. This task covers the **ACP tool permission** side which is untested.

**Test cases:**

- `allowSession(toolName)` grants access, `removeSession()` revokes
- `allowAlways(toolName)` persists in `alwaysAllowed` array, `removeAlways()` revokes
- `getToolTier()` returns `'none'` / `'session'` / `'always'` correctly
- `isAutoAllowed()` returns true for both session and always tiers
- Always tier takes precedence over session tier
- ACP permissions are independent from skill script permissions
- Session permissions reset when store state is cleared (non-persisted Set)

**Acceptance criteria:**

- All tests pass via `pnpm test`
- Follow existing test pattern in `permission-store-skills.test.ts`

---

## Rust Backend Refactors

### #4 — Extract shared JSON-RPC types and framing

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/json_rpc.rs` (new), `src-tauri/src/commands/mod.rs` |

Create a new `json_rpc.rs` module with shared types and message framing logic currently duplicated between `copilot_lsp.rs` and `mcp.rs`:

- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification` structs
- `JsonRpcError` struct
- `write_message(stdin, json)` — Content-Length framing write
- `read_message(buf)` — Content-Length framing parse from byte buffer
- `PendingRequests` type alias (HashMap of request ID → oneshot sender)
- `next_request_id()` helper (atomic counter)

Add unit tests for message framing (serialize, parse, round-trip).

**Acceptance criteria:**

- Types and framing functions compile and have tests
- No behavior change yet — consumers refactored in #5 and #6

---

### #5 — Refactor `copilot_lsp.rs` to use shared JSON-RPC

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #4 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` |

Replace the inline JSON-RPC types, Content-Length framing, and pending request map in `copilot_lsp.rs` with imports from `json_rpc.rs`. Keep all LSP-specific logic (document sync, completion requests, auth flow) in place.

**Acceptance criteria:**

- Copilot LSP start/stop/auth/completions work identically
- No duplicated framing or request dispatch logic
- `copilot_lsp.rs` reduced by \~150-200 lines

---

### #6 — Refactor `mcp.rs` to use shared JSON-RPC

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #4 |
| **Files** | `src-tauri/src/commands/mcp.rs` |

Replace the inline JSON-RPC types, Content-Length framing, and pending request map in `mcp.rs` with imports from `json_rpc.rs`. Keep all MCP-specific logic (server lifecycle, tool discovery, config scanning) in place.

**Acceptance criteria:**

- MCP server start/stop/restart/tool-call work identically
- No duplicated framing or request dispatch logic
- `mcp.rs` reduced by \~100-150 lines

---

### #7 — Extract `agents.rs` from `skills.rs`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/agents.rs` (new), `src-tauri/src/commands/skills.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

Move agent-related functions out of `skills.rs` into a new `agents.rs`:

- `discover_agents` command
- `read_agent_content` command
- `extract_bundled_agents` command
- Agent instruction scanning (`discover_agent_instructions`, `read_instruction_file`)
- Agent-related helper functions and types

Update `mod.rs` exports and `lib.rs` `generate_handler![]` if function paths change.

**Acceptance criteria:**

- Agent discovery, bundled agent extraction, instruction scanning all work identically
- All Tauri commands still registered and callable from frontend
- `skills.rs` reduced by \~500-600 lines

---

### #8 — Extract `script_exec.rs` from `skills.rs`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/script_exec.rs` (new), `src-tauri/src/commands/skills.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

Move script execution logic out of `skills.rs` into a new `script_exec.rs`:

- `execute_skill_script` command
- Interpreter resolution (bash, python, node)
- Timeout handling
- Path traversal protection
- Related types and helpers

**Acceptance criteria:**

- Skill script execution works identically
- `skills.rs` is under 600 lines (combined with #7)
- Path traversal protection and timeout handling preserved

---

### #9 — Migrate `serde_yaml` to `serde_yml` ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml`, `src-tauri/src/commands/skills.rs`, `src-tauri/src/index/parser.rs` |

Drop-in replacement. `serde_yaml` is archived; `serde_yml` is the maintained fork with identical API.

- Replace `serde_yaml = "0.9"` with `serde_yml = "0.9"` in `Cargo.toml`
- Find-and-replace `serde_yaml::` with `serde_yml::` in `skills.rs` and `index/parser.rs` (the two consumers)
- Run `cargo build` to verify

**Acceptance criteria:**

- `cargo build` succeeds
- Skill/agent YAML frontmatter parsing works identically
- No references to `serde_yaml` remain in Rust source files

---

## Frontend Decomposition

### #10 — Extract `lib/ai/context.ts` and `lib/ai/errors.ts`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/lib/ai/context.ts` (new), `src/lib/ai/errors.ts` (new), `src/hooks/useAIOperations.ts` |

Extract pure functions from `useAIOperations.ts`:

`context.ts` — system message building, goal injection, file tree context, skill/agent instruction injection. These are pure functions that read from stores but have no side effects or hooks.

`errors.ts` — `friendlyAIError()` and related error formatting/classification.

Update `useAIOperations.ts` to import from these modules.

**Acceptance criteria:**

- All AI chat and inline actions work identically
- Extracted functions are pure (no React hooks, no side effects)
- `useAIOperations.ts` reduced by \~200-300 lines
- Context building functions have at least one unit test each

---

### #11 — Extract `useAcpLifecycle.ts` hook

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #10 (cleaner to do after context/errors extraction) |
| **Files** | `src/hooks/useAcpLifecycle.ts` (new), `src/hooks/useAIOperations.ts` |

Extract ACP-specific logic from `useAIOperations.ts`:

- ACP agent spawning and session management
- `acpSessionByInstance` module-level state (move to a ref or store)
- ACP event listeners (`acp-session-update`)
- Permission request handling

Slim `useAIOperations.ts` to an orchestration layer that delegates to `useAcpLifecycle` for ACP connections.

**Acceptance criteria:**

- ACP chat and agent task interactions work identically
- `useAIOperations.ts` is under 300 lines
- No module-level mutable state remains in `useAIOperations.ts`

---

### #12 — Extract `useScrollPersistence.ts` and `useEditorResize.ts` from `Editor.tsx`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useScrollPersistence.ts` (new), `src/hooks/useEditorResize.ts` (new), `src/components/editor/Editor.tsx` |

`useScrollPersistence.ts` — scroll position save/restore with LRU cache (max 200), double-RAF restore technique, `isResizing` guard to prevent saves during resize.

`useEditorResize.ts` — ResizeObserver setup, content width tracking, scroll suppression during container resize.

These are the most self-contained extractable units from Editor.tsx.

**Acceptance criteria:**

- Scroll position persists across tab switches and app restarts
- Content width adjusts correctly on panel resize
- No scroll-related race conditions
- `Editor.tsx` reduced by \~150-200 lines

---

### #13 — Extract `TranscriptionOverlay.tsx` and `SourceModeEditor.tsx`

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | None (but easier after #12) |
| **Files** | `src/components/editor/TranscriptionOverlay.tsx` (new), `src/components/editor/SourceModeEditor.tsx` (new), `src/components/editor/Editor.tsx` |

`TranscriptionOverlay.tsx` — TranscriptionDialog, recording indicator, related useState/useEffect hooks for transcription and recording UI.

`SourceModeEditor.tsx` — CodeMirror source mode editor with its configuration, keybindings, and sync logic. Already somewhat self-contained in the render logic.

**Acceptance criteria:**

- Source mode toggle works with no visible change
- Transcription/recording UI works identically
- `Editor.tsx` is under 800 lines (combined with #12)

---

### #14 — Decompose `CommentPopover.tsx`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/editor/DelegationPanel.tsx` (new), `src/components/editor/CommentThread.tsx` (new), `src/components/editor/CommentPopover.tsx` |

`DelegationPanel.tsx` — delegation button, cancel, activity log with expandable entries, status indicator.

`CommentThread.tsx` — multi-turn reply thread (user vs agent messages, apply button, relative timestamps, author attribution).

Keep `CommentPopover.tsx` as container with create/edit/delete forms.

**Acceptance criteria:**

- Comment CRUD, delegation, multi-turn threads, apply-to-document all work identically
- `CommentPopover.tsx` is under 300 lines

---

### #15 — Extract `useAppLifecycle.ts` and `Layout.tsx` from `App.tsx`

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useAppLifecycle.ts` (new), `src/components/Layout.tsx` (new), `src/App.tsx` |

`useAppLifecycle.ts` — consolidate startup event listeners: tag badge click handling, ACP cleanup (`beforeunload`), visibility change (wake handler), drag/drop prevention, AI settings migration, debug logging sync. **Critical**: all discovery hooks (`useProjectMetadata`, `useStartWatchers`, `useSkillDiscovery`, `useMcpDiscovery`, `useLocalAI`, `useAutoUpdate`, `useKeyboardShortcuts`, `useActivityNavigation`, `useAgentTaskOperations`) MUST remain mounted — either in `useAppLifecycle` or still directly in `App.tsx`. Per MEMORY.md, missing a hook mount means it never runs.

`Layout.tsx` — the `ResizablePanelGroup` with sidebar, editor, chat panel, activity panel, and all panel size/collapse logic.

**Acceptance criteria:**

- All lifecycle behaviors work identically (startup, wake, cleanup)
- All hooks still mount correctly (manually verify each one)
- Panel resizing and layout work identically
- `App.tsx` is under 200 lines

---

## Dependency Cleanup

### #16 — Remove unused `next-themes` dependency ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `package.json` |

`next-themes` is listed in `package.json` but has **zero imports** in source code. The app already uses a custom `ThemeProvider`. Simply remove it.

- Remove `"next-themes"` from `dependencies` in `package.json`
- Run `pnpm install` to update lockfile
- Verify build succeeds

**Acceptance criteria:**

- `pnpm build` succeeds
- Theme toggle (Cmd+T) still works
- `next-themes` not in `node_modules`

---

### #17 — Audit `hound` crate and slim `tokio` features ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml` |

Two small Cargo.toml cleanups:

1. **Audit** `hound`: Search for `hound::` or `use hound` in all `.rs` files. If unused, remove from `Cargo.toml`. If used, document the code path.

2. **Slim** `tokio` **features**: Replace `features = ["full"]` with only the features used. Audit by searching for `tokio::` usage patterns. Likely needed: `rt-multi-thread`, `macros`, `io-util`, `process`, `sync`, `time`, `net`, `fs`.

**Acceptance criteria:**

- `cargo build` succeeds
- Recording/transcription still work (if `hound` removed)
- All async operations still work (AI streaming, subprocesses, file ops)

---

### #18 — Move `@types/diff-match-patch` to devDependencies ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `package.json` |

Type packages are build-time only. Move `"@types/diff-match-patch": "^1.0.36"` from `dependencies` to `devDependencies`.

**Acceptance criteria:**

- `pnpm build` succeeds
- `pnpm test` succeeds

---

## Summary

| Category | Count | Tasks |
| --- | --- | --- |
| **Reliability** | 3 | #1, #2, #3 |
| **Rust backend** | 6 | #4, #5, #6, #7, #8, #9 |
| **Frontend decomposition** | 6 | #10, #11, #12, #13, #14, #15 |
| **Dependency cleanup** | 3 | #16, #17, #18 |
| **Total** | **18** | 8S, 7M, 3L |

**Dependency graph** (most tasks are independent):

```
#1 → #2          (ErrorBoundary component → wrap zones)
#4 → #5, #6      (shared JSON-RPC → refactor copilot_lsp → refactor mcp)
#10 → #11         (extract context/errors → extract ACP lifecycle)
#12 ... #13       (scroll/resize hooks → transcription/source mode — easier in order but not required)
```

All other tasks (#3, #7, #8, #9, #14, #15, #16, #17, #18) have **zero dependencies** and can be done in any order.

**Risks:**

- **#15 (App.tsx decomposition)**: Highest risk of breaking lifecycle hooks. Must verify every hook still mounts. Test by checking all features at startup (skill discovery, file watching, MCP servers, local AI).
- **#5, #6 (JSON-RPC refactor)**: Must preserve exact protocol behavior. Test Copilot LSP completions and MCP tool calls end-to-end after each.
- **#13 (Editor.tsx transcription/source)**: Editor.tsx has deep prop/state threading. Extracting components requires careful prop interface design.