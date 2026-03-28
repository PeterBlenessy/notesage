# Conversation Branching Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | Feature request from [ai-workflows](../features/ai-workflows.md) Future Enhancements |
| **Total** | 10 tasks: 2S, 5M, 3L |
| **Suggested order** | Data model (#1-#2) → Store (#3-#4) → Chat hook (#5) → UI (#6-#9) → Docs (#10) |

**Risks:**

- The current `Conversation.messages` is a flat array indexed by position — segments use `startMessageIndex` to slice it. Branching introduces a tree, which fundamentally changes how messages are stored and traversed. Must preserve backward compatibility with existing conversations (migration from v3 → v4).
- The AI chat hooks (`useDirectApiChat`, `useAcpLifecycle`) build the `messages` array for the API call by reading `chat-store` messages linearly. Branching must provide a `getActiveThread()` method that returns a linear path from root to the active leaf, so hooks work without modification.
- Persistence size: branched conversations store all paths. A conversation with 5 branches of 20 messages each stores 100 messages. The existing `MAX_MESSAGES_PER_CONVERSATION = 500` cap applies to total messages across all branches.
- The History tab and conversation export must handle branched conversations sensibly (export active thread only, or all threads with markers).

---

## Phase 1: Data Model & Store

### #1 — Design branching data model ✅

**Description:** Extend the `Conversation` type to support branching. Each message gets an `id: string` (UUID) and optional `parentId: string | null` (null = root). The `messages` array becomes a flat pool of all messages across all branches (a tree stored as a flat list — same pattern as comment threads). Add `activeLeafId: string | null` to track which branch tip the user is viewing. Add a `branchPoint?: number` (timestamp of the parent message) when creating a branch. The existing linear structure is a degenerate tree where each message's parent is the previous message. Write the TypeScript interfaces.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/ai/types.ts` (extend `ChatMessage`), `src/stores/chat-store.ts` (extend `Conversation`)

---

### #2 — Add tree traversal utilities ✅

**Description:** Create `src/lib/chat-tree.ts` with pure functions for navigating the message tree: (a) `getThread(messages, leafId): ChatMessage[]` — walk from leaf to root via `parentId`, return in chronological order. This is what AI hooks use for the API call. (b) `getChildren(messages, parentId): ChatMessage[]` — direct children of a message. (c) `getBranches(messages, messageId): ChatMessage[][]` — all sibling branches at a branch point. (d) `getLeaves(messages): ChatMessage[]` — all leaf messages (no children). Write unit tests for each function covering: linear conversation (no branches), single branch point, nested branches, empty conversation.

**Complexity:** L | **Category:** frontend | **Dependencies:** #1

**Files:** new: `src/lib/chat-tree.ts`, new: `src/lib/__tests__/chat-tree.test.ts`

---

### #3 — Extend chat-store with branching actions ✅

**Description:** Add branching methods to `chat-store.ts`: (a) `branchFromMessage(messageTimestamp: number): void` — creates a new branch starting after the specified message. Sets `activeLeafId` to null (ready for new user input). The next `addMessage()` call will set `parentId` to the branch point message. (b) `switchBranch(leafId: string): void` — switches the active view to a different branch by setting `activeLeafId`. (c) Update `addMessage()` — new messages get `id: crypto.randomUUID()` and `parentId` set to the current `activeLeafId` (or the last message in the active thread). After adding, update `activeLeafId` to the new message's id. (d) Update `selectMessages` selector — return `getThread(conv.messages, conv.activeLeafId)` instead of `conv.messages` directly (linear view of active branch). (e) Add `selectAllMessages` for the full tree (used by branch UI).

**Complexity:** L | **Category:** frontend | **Dependencies:** #1, #2

**Files:** `src/stores/chat-store.ts`

---

### #4 — Add store migration v3 → v4 ✅

**Description:** Add migration in `chat-store.ts` persist config for v3 → v4. Existing conversations have messages without `id` or `parentId`. Migration: assign each message a UUID `id`, set `parentId` to the previous message's id (first message gets `parentId: null`), set `activeLeafId` to the last message's id. Bump store version to 4. Write a test that migrates a v3 conversation and verifies the tree structure matches the original linear order.

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Files:** `src/stores/chat-store.ts`, `src/stores/__tests__/chat-store.test.ts`

---

## Phase 2: Chat Hook Integration

### #5 — Update useDirectApiChat to use active thread ✅

**Description:** Verify that `useDirectApiChat` reads messages via `selectMessages` (which now returns the active thread, not all messages). The AI API call should only include messages from the active branch — `getThread()` provides this. Verify the ACP path in `useAcpLifecycle` also reads through `selectMessages`. If either hook reads `conv.messages` directly, update to use the selector. No functional change for non-branched conversations (single linear thread returns the same array).

**Complexity:** S | **Category:** frontend | **Dependencies:** #3

**Files:** `src/hooks/useDirectApiChat.ts`, `src/hooks/useAcpLifecycle.ts` (verify, minimal changes)

---

## Phase 3: UI

### #6 — Add branch indicator to chat messages ✅

**Description:** In `ChatMessageList.tsx` / `ChatMessage.tsx`, detect messages that are branch points (have more than one child). Show a small branch indicator: a subtle pill/badge below the message showing "N branches" (e.g., "2 branches"). Clicking it opens a branch switcher (task #7). For messages on a non-active branch that the user has navigated away from, show them with reduced opacity or a subtle "inactive" treatment. Use `getChildren()` from `chat-tree.ts` to detect branch points.

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Files:** `src/components/chat/ChatMessageList.tsx`, `src/components/chat/ChatMessage.tsx`

---

### #7 — Create branch switcher popover ✅

**Description:** Create a `BranchSwitcher` component (popover, triggered by the branch indicator from #6). Shows a list of branches at the selected branch point. Each branch shows: first message preview (truncated), message count, and creation time. Active branch highlighted. Clicking a branch calls `switchBranch(leafId)`. Use shadcn/ui `Popover` with a compact list layout. Each branch preview rendered with the first assistant response or user message after the branch point.

**Complexity:** M | **Category:** frontend | **Dependencies:** #6

**Files:** new: `src/components/chat/BranchSwitcher.tsx`

---

### #8 — Add "Branch from here" action to messages ✅

**Description:** Add a "Branch" action to assistant messages in the chat (alongside existing copy/retry actions). When clicked, calls `branchFromMessage(messageTimestamp)` which positions the conversation at that point, ready for a new user message. The chat input should auto-focus. Show a subtle visual indicator in the chat (e.g., a system message "Branched from message...") so the user understands the context. For user messages, also allow branching (re-ask with different phrasing). The action should be a small `GitBranch` icon (lucide) in the message action bar.

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Files:** `src/components/chat/ChatMessage.tsx`, `src/components/chat/ChatInput.tsx`

---

### #9 — Update conversation export for branches ✅

**Description:** Update the conversation export logic (Markdown and JSON export in `ChatHistoryView.tsx` or `ChatPanel.tsx`) to handle branched conversations. Markdown export: export the active thread only (default), with an option to export all branches (each branch separated by a horizontal rule and "Branch N" header). JSON export: include the full message tree with `id`/`parentId` fields. The History tab conversation list should show branch count alongside message count in the metadata.

**Complexity:** S | **Category:** frontend | **Dependencies:** #3

**Files:** `src/components/chat/ChatHistoryView.tsx`, `src/components/chat/ChatPanel.tsx`

---

## Documentation

### #10 — Update docs for conversation branching ✅

**Description:** Update `docs/features/ai-workflows.md` Chat Panel section to document branching: how to create branches, switch between them, and export. Remove "Conversation branching/forking" from the Future Enhancements section. Add a brief note in `docs/product-description.md` features table if the chat feature description is updated.

**Complexity:** S | **Category:** docs | **Dependencies:** #8

**Files:** `docs/features/ai-workflows.md`, `docs/product-description.md`