# Test Coverage Expansion Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-27 |
| **Status** | Not started |
| **PRD** | [test-coverage-expansion](../prds/2026-03-27-test-coverage-expansion.md) |
| **Total** | 25 tasks: 6S, 12M, 7L |
| **Suggested order** | Small stores (#1-#4) → Large stores (#5-#8) → Small hooks (#9-#12) → Large hooks (#13-#16) → Coverage gate (#17-#19) → Markdown fixtures (#20-#23) → Markdown unit tests (#24) → Coverage verification (#25) |

**Risks:**

- `chat-store` and `editor-store` have 34 and 28 actions respectively — tests will be large files. Split into logical groups (CRUD, persistence, edge cases) within each test file.
- `useAgentTaskOperations` (622 lines) and `useCommentDelegation` (486 lines) have deep dependency trees requiring extensive mocking. May need to mock 5+ modules each.
- `useFileWatcher` depends on 8 stores — setting up initial state for each test is verbose. Consider a shared `setupWatcherTest()` helper.
- Some hooks use module-level singletons (`useAgentTaskOperations` has a module-level task agent) which complicate test isolation. May need `vi.resetModules()` between tests.
- Markdown round-trip fixtures may reveal existing serializer bugs that need fixing before the fixture can "pass." Budget time for fix-alongside-test.
- `permission-store` already has 2 test files (`permission-store-acp.test.ts`, `permission-store-skills.test.ts`) — task #4 extends these rather than starting from scratch.

---

## Phase A: Store Unit Tests

### #1 — Store test: routing-store

**Description:** Write unit tests for `routing-store.ts` (136 lines, 7 actions). Test: initial state has null routes, `setRoute` assigns a connection to a use case, `autoAssignRoutes` fills empty slots based on connection capabilities, `clearRoute` removes assignment, `clearAllRoutes` resets everything, capability matching respects connection capabilities array. Mock `connections-store` for auto-assign tests.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/routing-store.test.ts`

---

### #2 — Store test: settings-store

**Description:** Write unit tests for `settings-store.ts` (308 lines, 43 actions). Despite many actions, most are simple boolean setters. Test: initial state defaults, `toggleTheme` cycles light/dark, `setSoftContrast` toggles, `setStartupReady` flag, `setExternalChangeDiffReview` toggle, persistence round-trip for persisted fields, transient fields (`startupReady`) NOT persisted. Use the `simulateRestart` pattern from `persistence-roundtrip.test.ts`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/settings-store.test.ts`

---

### #3 — Store test: project-metadata-store

**Description:** Write unit tests for `project-metadata-store.ts` (117 lines, 8 actions). Test: `setMetadata` stores metadata keyed by path, `getMetadata` retrieves it, `removeMetadata` deletes it, AI override resolution returns correct provider/agent/context for a project path, metadata for non-existent path returns undefined. This store is NOT persisted (no Zustand persist) — no persistence tests needed.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/project-metadata-store.test.ts`

---

### #4 — Store test: permission-store (extend existing)

**Description:** Extend existing `permission-store-acp.test.ts` and `permission-store-skills.test.ts` with missing coverage. Add tests for: domain allowlists (`addAlwaysAllowedDomain`, `removeAlwaysAllowedDomain`, `isDomainAllowed` with wildcards), session domain management (`addSessionDomain`, `clearSessionDomains`), the distinction between persisted (`alwaysAllowed`, `alwaysAllowedDomains`) and non-persisted (session) state. Target: 75%+ line coverage (up from 52%).

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** modified: `src/stores/__tests__/permission-store-acp.test.ts` or new: `src/stores/__tests__/permission-store-domains.test.ts`

---

### #5 — Store test: activity-store

**Description:** Write unit tests for `activity-store.ts` (234 lines, 14 actions). Test: `createTask` returns ID and sets pending status, `updateTaskStatus` transitions through lifecycle (pending → running → completed / error), `addActivity` appends log entries to a task, `setThinkingOutput` / `setStreamingResponse` update task output, `completeTask` marks done with final response, rehydration cleanup (interrupted tasks marked as error on startup), TTL pruning of old completed tasks. Mock `createTauriStorage`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/activity-store.test.ts`

---

### #6 — Store test: workspace-store

**Description:** Write unit tests for `workspace-store.ts` (266 lines, 22 actions). Test: `addExplorerFolder` / `removeExplorerFolder` manage folder list, `addProject` / `removeProject` manage projects, `updateFileTree` replaces tree for a path, `setFolderExpanded` tracks expansion state, `addRecentProject` / `removeRecentProject` manage recent list with max cap, persistence round-trip (explorer folders and projects restored, transient tree data rebuilt). Mock Tauri IPC for `list_directory`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/workspace-store.test.ts`

---

### #7 — Store test: editor-store

**Description:** Write unit tests for `editor-store.ts` (417 lines, 28 actions). Group tests into sections: **Tab management:** `openTab` creates tab with correct fields, `closeTab` removes tab and switches active, `setActiveTab` updates active ID, duplicate open reuses existing tab. **Dirty tracking:** `updateTabContent` marks dirty, `markTabClean` clears dirty. **External changes:** `setExternalChange` / `clearExternalChange` per tab. **Persisted state:** `persistedTabs` and `persistedActiveFilePath` round-trip through persistence, `tabs` array and `activeTabId` are NOT persisted. **Recent files:** `addRecentFile` with max cap, dedup. **Scroll positions:** save/restore per file path.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/editor-store.test.ts`

---

### #8 — Store test: chat-store

**Description:** Write unit tests for `chat-store.ts` (546 lines, 34 actions). The largest store — group tests into sections: **Conversation CRUD:** `createConversation` returns ID, `deleteConversation` removes it, `setActiveConversation` switches, `renameConversation` updates title. **Messages:** `addMessage` appends to active conversation, `updateMessage` modifies by timestamp, `deleteMessage` removes by timestamp. **Segments:** `pushSegment` creates new segment, `setActiveSegment` switches, segment project paths tracking. **Persistence:** conversations and activeConversationId round-trip, `isLoading` / `error` / `activeTool` are NOT persisted. **Edge cases:** operations on non-existent conversation IDs, empty conversation list, message operations with no active conversation.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/stores/__tests__/chat-store.test.ts`

---

## Phase B: Critical Hook Tests

### #9 — Hook test: useEditorResize

**Description:** Write unit tests for `useEditorResize.ts` (86 lines). The simplest hook. Test: hook creates ResizeObserver on mount, cleans up on unmount, updates width state when container resizes, debounces rapid resize events, scroll restoration triggered on resize. Mock `ResizeObserver` and `requestAnimationFrame`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useEditorResize.test.ts`

---

### #10 — Hook test: useRecording

**Description:** Write unit tests for `useRecording.ts` (~100 lines). Test: `startRecording` calls Tauri `start_recording`, `stopRecording` calls `stop_recording` and returns audio info, `isRecording` state toggles correctly, error state when microphone unavailable, recording timer increments, cleanup on unmount stops active recording. Mock Tauri IPC and `recording-store`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useRecording.test.ts`

---

### #11 — Hook test: useLocalCompletion

**Description:** Write unit tests for `useLocalCompletion.ts` (~100+ lines). Test: hook activates only when routing-store has a local/local_bundled/openai_compatible connection for inline_completion, debounces completion requests (300ms), extracts prefix/suffix context around cursor, dispatches `setGhostText` on successful completion, clears ghost text on editor change, error backoff (stops after 5 consecutive failures), backoff resets on connection/model/tab change. Mock Tauri IPC, editor store, routing store. Use `vi.useFakeTimers()` for debounce testing.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useLocalCompletion.test.ts`

---

### #12 — Hook test: useCopilotCompletion

**Description:** Write unit tests for `useCopilotCompletion.ts` (~100+ lines). Test: hook spawns LSP via `copilot_lsp_start` when connection is configured, sends `textDocument/didOpen` on tab activation, sends `textDocument/didChange` on editor updates, sends `textDocument/inlineCompletion` after debounce, strips already-typed prefix from completion, dispatches `setGhostText`, handles LSP errors gracefully, cleanup stops LSP on unmount. Mock Tauri IPC and events (`copilot-lsp-message`).

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useCopilotCompletion.test.ts`

---

### #13 — Hook test: useFileWatcher

**Description:** Write unit tests for `useFileWatcher.ts` (279 lines). Test: **Create events:** new file triggers `refreshFileTree`. **Modify events:** changed file reads new content from disk, compares with tab content, auto-reloads clean tabs (with toast), shows reload prompt for dirty tabs. **Delete events:** triggers `refreshFileTree`. **Self-write suppression:** recently saved files don't trigger reload. **Path normalization:** `/private/var` prefix stripped to match tab paths. **Debouncing:** rapid events coalesced. Mock 8 stores, Tauri IPC (`read_file`), and emit `file-changed` events via `emitMockEvent`. Use `vi.useFakeTimers()`.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useFileWatcher.test.ts`

---

### #14 — Hook test: useSkillOperations

**Description:** Write unit tests for `useSkillOperations.ts` (364 lines, 2 exported hooks). Test `useSkillDiscovery`: waits for `startupReady`, calls `extract_bundled_skills` and `extract_bundled_agents`, triggers `scanSkills` and `scanAgents` on skill-store, handles persona→agent migration (calls `migratePersonasToAgents` once, gated by flag). Test `useSkillOperations`: `deleteSkill` / `deleteAgent` calls Tauri `delete_path`, `moveSkill` / `moveAgent` calls `copy_directory` + `delete_path`, `rescanSkills` triggers fresh discovery. Mock Tauri IPC, skill-store, settings-store.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/hooks/__tests__/useSkillOperations.test.ts`

---

### #15 — Hook test: useAgentTaskOperations

**Description:** Write unit tests for `useAgentTaskOperations.ts` (622 lines). The most complex hook. Test: `startAgentTask` creates an activity-store task and starts streaming, routes to ACP or direct API based on connection type, `cancelTask` stops the active agent, permission request handling (tool call approval/denial), streaming text chunks accumulate in response, task completes with final response, error handling (agent crash → task marked as error), concurrent task limitation. Mock extensively: routing-store, connections-store, chat-store, permission-store, activity-store, Tauri IPC, ACP utils. Note: module-level singleton state — use `vi.resetModules()` for isolation.

**Complexity:** L | **Category:** frontend | **Dependencies:** #5 (activity-store tests validate the store this hook depends on)

**Files:** new: `src/hooks/__tests__/useAgentTaskOperations.test.ts`

---

### #16 — Hook test: useCommentDelegation

**Description:** Write unit tests for `useCommentDelegation.ts` (486 lines). Test: `delegateComment` creates a task and updates comment status to delegated, `delegateReply` sends reply with conversation history, agent response triggers comment status update to done, `applyReply` dispatches AISuggestion decoration on the editor, `moveToChat` transfers comment thread to chat panel, activity log entries recorded for each step, error during delegation marks comment back to open. Mock: useAgentTaskOperations (return mock task operations), comment-store, chat-store, editor instance.

**Complexity:** L | **Category:** frontend | **Dependencies:** #15 (depends on understanding useAgentTaskOperations behavior)

**Files:** new: `src/hooks/__tests__/useCommentDelegation.test.ts`

---

## Phase C: Coverage Regression Gate

### #17 — Add vitest perFile coverage thresholds

**Description:** Update `vitest.config.ts` to add `thresholds` configuration with `perFile: true` and initial global thresholds at 0 (no enforcement yet — just enable the infrastructure). Verify `pnpm test:coverage` still passes and reports per-file threshold status.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** modified: `vitest.config.ts`

---

### #18 — Add coverage summary to CI PR comments

**Description:** Add a step to `.github/workflows/test.yml` that posts coverage summary on PRs. Evaluate `davelosert/vitest-coverage-report-action` — if it works, add it after the coverage step. It reads `coverage/coverage-summary.json` and posts a formatted comment with per-file coverage. If the action doesn't fit, use a simple script that extracts the summary JSON and posts via `gh pr comment`. Warning-only (no blocking).

**Complexity:** M | **Category:** frontend | **Dependencies:** #17

**Files:** modified: `.github/workflows/test.yml`

---

### #19 — Add coverage baseline and regression detection

**Description:** Create a script (`scripts/coverage-check.ts` or shell) that: (1) reads `coverage/coverage-summary.json` from the current run, (2) reads a baseline from `coverage-baseline.json` (committed to repo), (3) compares coverage for each file that changed in the PR (via `git diff --name-only`), (4) flags any file where line coverage dropped. Add this as a CI step. Generate the initial baseline by running `pnpm test:coverage` and committing the summary. Enforcement: warning-only initially, add blocking after 2-week observation. Add a `pnpm coverage:update-baseline` script to regenerate the baseline.

**Complexity:** L | **Category:** frontend | **Dependencies:** #17, #18

**Files:** new: `scripts/coverage-check.ts`, `coverage-baseline.json`; modified: `.github/workflows/test.yml`, `package.json`

---

## Phase D: Markdown Round-Trip Hardening

### #20 — Add nested-lists and complex-tables fixtures

**Description:** Create `tests/fixtures/nested-lists.md` with 3+ levels of nested bullets, ordered lists inside bullets, task lists inside ordered lists, mixed indentation. Create `tests/fixtures/complex-tables.md` with tables containing inline formatting (bold, code, links), empty cells, single-column tables, tables preceded by and followed by other block types. Add both to the round-trip test runner. Fix any serializer issues that the fixtures reveal.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `tests/fixtures/nested-lists.md`, `tests/fixtures/complex-tables.md`; modified: `src/lib/__tests__/markdown-roundtrip.test.ts`

---

### #21 — Add mixed-formatting and frontmatter-edge-cases fixtures

**Description:** Create `tests/fixtures/mixed-formatting.md` with bold inside italic, code inside links, strikethrough with links, nested inline formatting combinations. Create `tests/fixtures/frontmatter-edge-cases.md` with YAML containing colons in values, multi-line strings (`|` and `>`), arrays, boolean values, empty frontmatter (`---\n---`), special characters in values. Add both to the round-trip test runner. Fix any parse/serialize issues.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** new: `tests/fixtures/mixed-formatting.md`, `tests/fixtures/frontmatter-edge-cases.md`; modified: `src/lib/__tests__/markdown-roundtrip.test.ts`

---

### #22 — Add whitespace-edge-cases and unicode-content fixtures

**Description:** Create `tests/fixtures/whitespace-edge-cases.md` with trailing whitespace, multiple blank lines between blocks, indented code blocks vs fenced, tabs vs spaces in lists. Create `tests/fixtures/unicode-content.md` with emoji in headings and list items, CJK characters in tables, accented characters in links, mixed-script paragraphs. Add both to round-trip tests.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** new: `tests/fixtures/whitespace-edge-cases.md`, `tests/fixtures/unicode-content.md`; modified: `src/lib/__tests__/markdown-roundtrip.test.ts`

---

### #23 — Add large-document stress test fixture

**Description:** Create `tests/fixtures/large-document.md` — a 500+ line document combining all block types: headings at every level, nested lists 3+ deep, multiple tables, code blocks with various languages, blockquotes with nested content, task lists, horizontal rules, links, images, inline formatting throughout. This tests serializer state management across a long document. Add to round-trip tests with a longer timeout if needed.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** new: `tests/fixtures/large-document.md`; modified: `src/lib/__tests__/markdown-roundtrip.test.ts`

---

### #24 — Unit tests for markdown.ts edge cases

**Description:** Create `src/lib/__tests__/markdown-edge-cases.test.ts` with targeted unit tests for `markdown.ts` functions. Test: `serializeTable` with empty cells, single-column tables, cells containing pipe characters. Test `parseMarkdownToDoc` with malformed markdown (unclosed code blocks, broken links, nested blockquotes). Test `stripAnnotationsFromMarkdown` preserves document content. Test that parse→serialize produces correct node types for each block type (inspect the intermediate ProseMirror doc). Target: `markdown.ts` line coverage ≥ 60%.

**Complexity:** L | **Category:** frontend | **Dependencies:** #20, #21 (understanding fixture patterns helps write targeted tests)

**Files:** new: `src/lib/__tests__/markdown-edge-cases.test.ts`

---

## Phase E: Verification

### #25 — Run full coverage and verify 65%+ target

**Description:** Run `pnpm test:coverage`, extract per-directory and total coverage. Verify: stores ≥ 70%, hooks ≥ 60%, `markdown.ts` ≥ 60%, total frontend ≥ 65%. If any target is not met, identify the gap and add targeted tests. Update the PRD "Current state" section with final numbers. Update `docs/architecture.md` testing section with new coverage stats.

**Complexity:** S | **Category:** frontend | **Dependencies:** #1-#24

**Files:** modified: `docs/prds/2026-03-27-test-coverage-expansion.md`, `docs/architecture.md`
