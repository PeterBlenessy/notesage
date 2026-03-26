# Audit v2 Fix Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-26 |
| **Status** | Not started |
| **Audit** | [full-v2](../audit/2026-03-25-full-v2.md) |
| **Total** | 38 tasks: 13S, 15M, 10L |
| **Suggested order** | Quick wins (#1-#13) → Targeted fixes (#14-#22) → Render perf (#23-#25) → Error UX (#26-#29) → Type safety (#30-#31) → Decomposition (#32-#34) → Tests (#35-#38) |

**Risks:**

- Zustand selector refactoring (#23-#25) touches always-visible components — high regression risk, test manually in both themes
- Rust provider enum (#30) changes the IPC contract — frontend and backend must be updated atomically
- Round-trip test fixtures (#35) may reveal existing serialization bugs that need fixing

---

## Tier 1: Quick Wins (batch in one session)

### #1 — Remove unused npm dependencies ✅

**Description:** Remove `date-fns` and `linkifyjs` from `package.json`. Run `pnpm install` to update lockfile. Verify no import errors with `pnpm tauri dev`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `package.json`, `pnpm-lock.yaml`

---

### #2 — Remove unused Cargo dependencies ✅

**Description:** Remove `hyper`, `hyper-util`, and `http-body-util` from `src-tauri/Cargo.toml`. Run `cargo check` to verify no compile errors.

**Complexity:** S | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/Cargo.toml`

---

### #3 — Add aria-labels to FindBar inputs ✅

**Description:** Add `aria-label="Find in document"` to the search input and `aria-label="Replace"` to the replace input. Also add `aria-expanded` to the replace toggle chevron button.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/FindBar.tsx`

---

### #4 — Make TabBar close button keyboard accessible ✅

**Description:** Add `tabIndex={0}` and `onKeyDown` handler (Enter/Space) to the tab close `<span role="button">`. Follow the pattern in FileTreeItem for keyboard event handling.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/tabs/TabBar.tsx`

---

### #5 — Add mounted guard to useMcpDiscovery listener ✅

**Description:** Add `if (!mounted) return;` at the top of the `mcp-server-status` listener callback to skip store updates after unmount.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useMcpOperations.ts`

---

### #6 — Fix dark mode muted text contrast

**Description:** Increase `--color-muted-foreground` in dark mode from `oklch(70% 0 0)` to `oklch(75% 0 0)` (or higher) to meet WCAG AA contrast ratio (4.5:1 for normal text). Test in both dark and dark+soft modes.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/styles/globals.css`

---

### #7 — Fix tauri-storage generic type

**Description:** Change `createJSONStorage<any>()` to `createJSONStorage<T>()` with a generic parameter.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/tauri-storage.ts`

---

### #8 — Update architecture.md: add missing stores

**Description:** Add 6 missing Zustand stores to the state management table: `action-store`, `diff-review-store`, `editor-styles-store`, `git-store`, `pdf-store`, `sync-store`. Include purpose and persistence level for each.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `docs/architecture.md`

---

### #9 — Update editor-architecture.md: add missing extensions

**Description:** Add 9 missing extensions to the Custom Extensions Inventory table: `ai-suggestion`, `date-highlight`, `date-suggestion`, `local-image`, `mention-highlight`, `mention-suggestion`, `page-breaks`, `table-markdown`, `themed-highlight`. Include type and purpose for each.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `docs/features/editor-architecture.md`

---

### #10 — Update architecture.md: add missing command modules

**Description:** Add 5 missing command modules to the project structure: `acp_binary.rs`, `acp_client.rs`, `agent_manager.rs`, `model_management.rs`, `thinking_tags.rs`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `docs/architecture.md`

---

### #11 — Add aria-labels to TitleBar and activity rail

**Description:** Add `aria-label` to icon-only buttons in TitleBar (chat toggle, activity toggle). Add `role="status"` and `aria-live="polite"` to StatusBar. Add semantic button role to ActivityStrip rail icons.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/TitleBar.tsx`, `src/components/editor/StatusBar.tsx`, `src/components/activity/ActivityStrip.tsx`

---

### #12 — Add aria-current to active file in tree

**Description:** Add `aria-current="page"` to the active file's FileTreeItem div. Add `disabled:opacity-50` (was `opacity-30`) to FindBar disabled buttons.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`, `src/components/editor/FindBar.tsx`

---

### #13 — Add DOMPurify defense-in-depth for markdown HTML

**Description:** Add `DOMPurify.sanitize()` before `wrapper.innerHTML = html` in `ai-suggestion.ts` and `external-diff.ts`. DOMPurify is already a dependency (used in DocxViewer). This is a preventive measure — current code is safe but this guards against future parser changes.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/extensions/ai-suggestion.ts`, `src/lib/external-diff.ts`

---

## Tier 2: Targeted Fixes

### #14 — Fix useSpeechRecognition listener race conditions

**Description:** Two fixes in one: (a) Await the recursive `startWhisperDictation()` call in the Web Speech API error handler and add a mounted guard after the await. (b) In `startWhisperDictation`, await the `listen()` promise and check `mountedRef.current` before storing the new unlisten to prevent rapid-toggle overwrites.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useSpeechRecognition.ts`

---

### #15 — Fix useDirectApiChat sequential listener race

**Description:** Replace the four sequential `await listen()` calls with a single `Promise.all()` so all listeners are set up atomically. If any fails, the others are still cleaned up.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useDirectApiChat.ts`

---

### #16 — Fix ACP agent singleton race condition

**Description:** Replace the global `acpAgent` null-check pattern with a `Map<connectionId, Promise<AgentHandle>>` that deduplicates concurrent spawn attempts per connection. If a spawn is already in flight for the same connection, await the existing promise instead of spawning a second agent.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/ai/acp-agent-state.ts`

---

### #17 — Fix Task agent singleton race condition

**Description:** Same fix as #16 but for `taskAgent` in `useAgentTaskOperations`. Use a per-connection map to prevent concurrent spawn races.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useAgentTaskOperations.ts`

---

### #18 — Fix useModelMetadata fetchedRef reset

**Description:** Add a separate `useEffect` that resets `fetchedRef.current = false` when the `models` dependency changes, so the fetch re-runs with new models.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useModelMetadata.ts`

---

### #19 — Fix useLocalAI Promise.all → Promise.allSettled

**Description:** Replace `Promise.all([getSystemMemory(), listLocalModels(), ...])` with `Promise.allSettled()`. Handle each result individually so one failure doesn't lose the others.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useLocalAI.ts`

---

### #20 — Add error boundary to useSkillDiscovery

**Description:** Add `.catch()` to the async IIFE in useSkillDiscovery that shows a `toast.error()` so users know skills/agents failed to load. Log the full error to console for debugging.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useSkillOperations.ts`

---

### #21 — Fix useLocalCompletion editor stale reference

**Description:** Capture the editor instance at request time. After the async completion request resolves, validate the captured instance matches the current editor before inserting ghost text. Return early if editor has changed (tab switch during await).

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useLocalCompletion.ts`

---

### #22 — Add keyboard navigation to FileTreeItem

**Description:** Add ArrowRight (expand directory) and ArrowLeft (collapse directory) keyboard handlers to the FileTreeItem's `onKeyDown`. Follow WAI-ARIA tree view pattern. Only apply to directories.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`

---

## Tier 3: Render Performance

### #23 — Refactor ChatPanel Zustand subscriptions

**Description:** Replace the 18 unselectored store reads with individual `useChatStore(s => s.field)` selectors. Split ChatPanel into memoized sub-components: `ChatMessageList`, `ChatFooter`, `ChatHistoryView`. Wrap each in `React.memo()`.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/chat/ChatPanel.tsx`, new: `ChatMessageList.tsx`, `ChatFooter.tsx`, `ChatHistoryView.tsx`

---

### #24 — Refactor Sidebar Zustand subscriptions

**Description:** Replace 11 unselectored workspace store reads with individual selectors. Extract `QuickNotesSection`, `ProjectsSection`, `FoldersSection` as `React.memo()` sub-components. Each section subscribes only to the fields it needs.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/Sidebar.tsx`, new: `QuickNotesSection.tsx`, `ProjectsSection.tsx`, `FoldersSection.tsx`

---

### #25 — Optimize FileTreeItem with React.memo

**Description:** Wrap FileTreeItem in `React.memo()` with a custom comparator that checks `entry.path`, `entry.name`, `entry.is_directory`, `level`, and `isActive`. Extract expensive store computations (git status, external changes) into a single `useFileTreeItemState(path)` hook that returns a stable object via `useMemo`.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`, new: `src/hooks/useFileTreeItemState.ts`

---

## Tier 4: Error UX

### #26 — Add error feedback for index build failures

**Description:** In `useProjectMetadata`, catch `buildDocumentIndex()` errors and show a non-blocking toast: "Tag index for \[project\] failed — search may be incomplete." Log the full error. In `useFileOperations`, replace `.catch(() => {})` on `indexFile()` with a `console.warn` + debounced toast for repeated failures.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useProjectMetadata.ts`, `src/hooks/useFileOperations.ts`

---

### #27 — Improve AI chat error messages

**Description:** Create an `mapAIError(error: string, provider: string)` utility that maps common error patterns to user-friendly messages: connection refused → "Could not reach \[provider\]", 401 → "Invalid API key", 429 → "Rate limited", timeout → "Request timed out". Include a "Open Settings" link in the error message for configuration issues.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/ai/errors.ts`, `src/hooks/useDirectApiChat.ts`

---

### #28 — Fix comment file loading error handling

**Description:** In `comment-store.ts`, wrap `JSON.parse()` of comment files in try/catch. On parse error, show toast: "Failed to load comments — file may be corrupted." Log the file path and error. Don't silently show empty comments.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/stores/comment-store.ts`

---

### #29 — Add error feedback for common silent failures

**Description:** Batch fix for remaining MEDIUM/LOW error UX findings: (a) Git status refresh: show warning badge on git indicator when operations fail. (b) Markdown links: show toast when link resolution fails. (c) Project disappearance: show toast when project directory not found. (d) Search empty state: show "No results" message in command palette.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useFileOperations.ts`, `src/components/MarkdownContent.tsx`, `src/components/CommandPalette.tsx`

---

## Tier 5: Type Safety

### #30 — Create Rust AIProviderType enum

**Description:** Replace `provider: String` with `#[derive(Serialize, Deserialize)] enum AIProviderType { Anthropic, OpenAI, Ollama, OpenAICompatible, LocalBundled }` using `#[serde(rename_all = "snake_case")]`. Update all `match provider.as_str()` patterns to `match provider { AIProviderType::Anthropic => ... }`. Update frontend Tauri invoke calls to pass the enum string values (serde handles the rename). **High blast radius — test all provider paths.**

**Complexity:** L | **Category:** both | **Dependencies:** None

**Files:** `src-tauri/src/commands/ai.rs`, `src/lib/tauri.ts`

---

### #31 — Create typed editor storage interfaces

**Description:** Define `EditorStorageImage`, `EditorStorageMarkdown` interfaces. Replace `(editor.storage as any).image` with typed access via a `getEditorStorage<T>(editor, key)` helper. Update 3 call sites in `useEditorTabSwitch.ts`, `useEditor.ts`, and `pm-replace.ts`. Also change `editor: any` to `editor: Editor` in `ai-suggestion.ts` exports.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useEditorTabSwitch.ts`, `src/hooks/useEditor.ts`, `src/lib/pm-replace.ts`, `src/components/editor/extensions/ai-suggestion.ts`

---

## Tier 6: Decomposition

### #32 — Extract Toolbar sub-components

**Description:** Extract 8 inline sub-components from Toolbar.tsx into separate files: `HeadingPicker`, `LinkButton`, `TextColorPopover`, `HighlightPopover`, `TypographyPopover`, `MicButton`, `TableGridPicker`, `TableToolsPopover`. Keep `ToolbarButton` in Toolbar.tsx (tiny). Target: Toolbar.tsx reduces from 1,050 to \~150 lines.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/Toolbar.tsx`, new: 8 files in `src/components/editor/toolbar/`

---

### #33 — Extract ConnectionConfigDialog form sections

**Description:** Extract form sections from ConnectionConfigDialog.tsx: `ApiKeyForm`, `ModelSelectionForm`, `AdvancedSettingsForm` (temp/tokens/telemetry/sandbox). Target: dialog reduces from 896 to \~300 lines.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/settings/ConnectionConfigDialog.tsx`, new: 3 files in `src/components/settings/connection/`

---

### #34 — Extract index/mod.rs internal modules

**Description:** Extract `file_scanner.rs` (scan_files, is_indexable) and `reindex_queue.rs` (queue management, process_reindex_queue) from index/mod.rs. Target: mod.rs reduces from 917 to \~680 lines.

**Complexity:** L | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/src/index/mod.rs`, new: `src-tauri/src/index/file_scanner.rs`, `src-tauri/src/index/reindex_queue.rs`

---

## Tier 7: Test Infrastructure

### #35 — Create markdown round-trip test framework

**Description:** Create 10+ fixture `.md` files in `tests/fixtures/` covering all supported syntax (headings, lists, tables, code blocks, frontmatter, task lists, blockquotes, images, links, horizontal rules). Write a vitest test that for each fixture: parses markdown → creates ProseMirror doc → serializes back → compares with whitespace normalization. This is the #1 spec requirement ("must pass before any PR").

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `tests/fixtures/*.md`, `src/lib/__tests__/markdown-roundtrip.test.ts`

---

### #36 — Add Rust tests for SQL query builders

**Description:** Add `#[cfg(test)]` module to `src-tauri/src/index/queries.rs` with in-memory SQLite database. Test `query_tags`, `query_mentions`, `query_content` (FTS5), `query_stats`, and task toggle. Use the schema from `db.rs` to set up test database.

**Complexity:** L | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/src/index/queries.rs`

---

### #37 — Add vitest tests for core hooks

**Description:** Set up Tauri IPC mocking infrastructure (`vi.mock('@tauri-apps/api/core')`). Write tests for `useFileOperations` (create/save/delete cycle) and `useAIOperations` (provider routing, error handling). Use `@testing-library/react` `renderHook`. Target: 15+ test cases covering happy path and error cases.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useFileOperations.test.ts`, `src/hooks/__tests__/useAIOperations.test.ts`, `src/test/tauri-mock.ts`

---

### #38 — Add store persistence round-trip tests

**Description:** Write vitest tests that verify Zustand persist middleware correctly saves to and restores from localStorage for the 3 most critical stores: `editor-store` (tabs, active tab), `connections-store` (provider connections minus API keys), `chat-store` (messages, conversations). Mock localStorage, write state, create fresh store, verify rehydration matches.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/persistence-roundtrip.test.ts`