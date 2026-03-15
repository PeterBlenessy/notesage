# Agent Data Safety — Tasks

**PRD:** `docs/prds/2026-03-15-agent-data-safety.md`
**Status:** ✅ Complete

**Total:** 11 tasks (3S, 5M, 3L) — all implemented

---

## Layer 1: Sandbox Multi-Path Support

### #1 — Update sandbox profile to accept multiple writable paths ✅

- **Complexity:** S | **Category:** backend
- **Description:** Change `generate_seatbelt_profile(working_directory: &str)` to `generate_seatbelt_profile(writable_paths: &[String])`. Generate one `(subpath ...)` entry per path. Update `sandboxed_command()` to match. Update Linux `sandboxed_command()` placeholder similarly. Hash all paths together for the profile filename.
- **Files:** `src-tauri/src/commands/sandbox.rs`

### #2 — Add `sandbox_paths` parameter to `acp_agent_spawn` ✅

- **Complexity:** S | **Category:** backend | **Depends on:** #1
- **Description:** Add `sandbox_paths: Option<Vec<String>>` to `acp_agent_spawn`. Pass to `run_agent_thread`. In the spawn logic, use `sandbox_paths` (if provided) instead of `[working_directory]` when building the sandbox profile. Fall back to `[working_directory]` if `sandbox_paths` is `None`. Update `sandboxed_command` call site.
- **Files:** `src-tauri/src/commands/acp.rs`

### #3 — Pass workspace folders from chat spawn, single folder from delegation spawn ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #2
- **Description:** Update `ensureAcpAgent()` in `useAcpLifecycle.ts` to read all workspace folders (projects + explorer folders from `workspace-store`) and pass them as `sandboxPaths` to `acp_agent_spawn`. Update `ensureTaskAgent()` in `useAgentTaskOperations.ts` to pass only the document's parent project/explorer folder as `sandboxPaths: [parentFolder]`. Update health check in `ConnectionCard.tsx` to pass `sandboxPaths: []` (tmp only). Fix codex-acp model flag in `useAgentTaskOperations.ts` (currently uses `--model`, should use `-c model=`).
- **Files:** `src/hooks/useAcpLifecycle.ts`, `src/hooks/useAgentTaskOperations.ts`, `src/components/settings/ConnectionCard.tsx`

---

## Layer 2: Chat Context Isolation — Data Model

### #4 — Add conversation segments to chat store ✅

- **Complexity:** M | **Category:** frontend
- **Description:** Add `ConversationSegment` interface and `segments: ConversationSegment[]` + `activeSegmentIndex: number` to `Conversation`. Initialize with one segment on conversation creation (using initial `projectPaths`). Add store actions: `addSegment(projectPaths, historyIncluded)` — creates a new segment at the current message count, sets it as active; `getActiveSegment()` — returns the current segment. Migrate existing conversations (add default single segment on load).
- **Files:** `src/stores/chat-store.ts`

### #5 — Filter message history by active segment when sending to agent ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #4
- **Description:** Update `acpSendChatMessage` in `useAcpLifecycle.ts`. When preparing messages for the agent: if `historyIncluded` is false on the active segment, only send messages from `startMessageIndex` onward. If `historyIncluded` is true, send all messages. The system message is always regenerated from the current segment's `projectPaths`. Invalidate `acpAgent.chatSessionId` when a new segment is created (forces `acp_session_new` on next send). Direct API path (`useAIOperations.ts`): apply the same segment filtering to the messages array.
- **Files:** `src/hooks/useAcpLifecycle.ts`, `src/hooks/useAIOperations.ts`

---

## Layer 2: Chat Context Isolation — UI

### #6 — Project switch prompt component ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #4
- **Description:** Create `ProjectSwitchCard` component. Renders inline in the chat message list when a project scope change is pending. Shows: folder icon, new project name(s), "Previous messages won't be shared with the agent", two buttons: "Include history" (outline) and "Start fresh" (filled, default). On user choice: calls `addSegment()` on chat store with the chosen `historyIncluded` value. Card becomes read-only after choice (shows what was decided). Style to match `PermissionCard` — rounded border, muted background, compact.
- **Files:** `src/components/chat/ProjectSwitchCard.tsx` (new)

### #7 — Detect project selection changes and show prompt ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #6
- **Description:** In `ChatPanel.tsx`, watch `selectedProjectPaths` for changes. When the set changes (any addition, removal, or replacement): insert a pending `ProjectSwitchCard` into the chat. The prompt blocks further message sending until the user chooses (disable ChatInput while pending). Track pending state in a local ref or chat store flag. Any change to the project set triggers a new prompt, even adding one project to an existing selection.
- **Files:** `src/components/chat/ChatPanel.tsx`

### #8 — Context divider component ✅

- **Complexity:** S | **Category:** frontend | **Depends on:** #6
- **Description:** Create `ContextDivider` component. Collapsible horizontal rule with CONTEXT label. Collapsed (default): shows project names. Expanded: shows switched-from, history status, session status, included projects. Distinct background when expanded.
- **Files:** `src/components/chat/ContextDivider.tsx` (new)

### #9 — Render segments, prompts, and dividers in chat message list ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #7, #8
- **Description:** Update the chat message rendering loop in `ChatPanel.tsx` to interleave `ProjectSwitchCard` (pending) and `ContextDivider` (resolved) between message bubbles at segment boundaries. Messages from prior segments render normally (no hiding). The divider visually separates contexts. Trailing divider appears immediately after user resolves switch. Ensure scroll-to-bottom still works after inserting cards.
- **Files:** `src/components/chat/ChatPanel.tsx`

---

## Integration

### #10 — Delegation: restrict sandbox to document's parent folder ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #2
- **Description:** In `useAgentTaskOperations.ts`, the task agent spawn passes `sandboxPaths: [cwd]` restricting to the document's parent folder. Inline actions in `useAcpLifecycle.ts` also use single-folder sandboxing.
- **Files:** `src/hooks/useAgentTaskOperations.ts`, `src/hooks/useAcpLifecycle.ts`

### #11 — Respawn agent on workspace changes ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #3
- **Description:** Watch workspace-store for changes to `explorerFolders` and `projects` arrays. When folders are added or removed: stop the current chat agent (`acp_agent_stop`), clear `acpAgent` state, so the next message send triggers a fresh spawn with the updated sandbox paths. Do NOT respawn on project selection changes in chat footer (handled by Layer 2 session isolation). Do NOT respawn the task agent (it uses single-folder sandbox anyway).
- **Files:** `src/hooks/useAcpLifecycle.ts`
