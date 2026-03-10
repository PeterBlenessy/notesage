# Task Breakdown: Comment Delegation Modes (v2)

**PRD:** `docs/prds/2026-03-03-comment-delegation-modes.md` **Total:** 9 tasks (2S, 5M, 1L, 1M-verify) **Status:** Complete

**Note:** Tasks #1–#7 from the v1 breakdown are complete (committed in 258ff74, fb6c9e3, 9078741). All v2 tasks below are also complete — verified against codebase 2026-03-05.

## Implementation Order

1. Bug fix: cancel from activity panel updates comment store (#1)
2. Bug fix: agent panel does not auto-expand on new tasks (#2)
3. Chat store — conversation model with migration (#3)
4. Activity isolation in useAgentTaskOperations (#4)
5. useCommentDelegation — activity isolation + moveToChat rewrite (#5)
6. CommentPopover — button layout + reply delegate + activity default (#6)
7. ChatPanel — conversation management UI (#7)
8. Editor.tsx — wiring updates (#8)
9. End-to-end verification (#9)

## Risks / Open Questions

- **Persist migration**: Chat store uses Zustand persist middleware. The v1→v2 migration must handle both empty and non-empty old message arrays gracefully. Test with existing persisted data.
- **Activity isolation edge cases**: When `trackInActivityStore: false`, the `cancelTask()` flow must check whether the task exists in the activity store before trying to update it.
- **Conversation selector UX**: The chat panel header conversation list could get long. For v1, a simple scrollable list is sufficient — search/filter deferred.

---

## Tasks

### #1 — Fix: Cancel from activity panel must update comment store

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/App.tsx`, `src/stores/comment-store.ts`

**Description**: When a user cancels a running task from the agent activity panel's Stop button, the comment store is not updated — spinners keep spinning in the comment popover and comment list. The `cancelTask()` in `useAgentTaskOperations` only updates the activity store; it has no knowledge of the associated comment.

**Root cause:** `handleCancelTask` in `App.tsx` calls `cancelTask(taskId)` which updates only `activity-store`. The comment-store is never notified.

**Fix:** In `handleCancelTask` (App.tsx), after `cancelTask()` completes:

1. Look up the cancelled task in `activity-store` by `taskId`
2. If the task has `commentId` and `documentId` in its metadata, update the comment store:
   - `clearPartialReply(documentId, commentId)`
   - `completeAllActivities(commentId)`
   - `setCommentStatus(documentId, commentId, hasReplies ? 'done' : 'open')`
   - `clearDelegationMode(commentId)`
   - `saveComments(documentId, projectRoot)`

**Acceptance criteria:**

- Cancelling from the activity panel stops spinners in both the comment popover and comment list
- Comment status reverts to `open` (no replies) or `done` (has replies)
- Delegation mode is cleared
- Existing cancel from comment popover still works (no regression)

---

### #2 — Fix: Agent panel does not auto-expand on new tasks

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/stores/activity-store.ts`

**Description**: When new tasks are delegated, the agent activity panel auto-expands. The strip should just show a new icon — the user decides when to open the panel.

**Root cause:** `addTask()` in `activity-store.ts` sets `isManuallyHidden: false` on every new task, which causes the full panel to expand.

**Fix:** Remove `isManuallyHidden: false` from the `addTask()` action. The rail (40px strip) will still show icons for active tasks. The user can click to expand the panel when they want to monitor progress.

**Acceptance criteria:**

- Delegating a comment does NOT auto-expand the agent activity panel
- The activity strip (rail) shows icons for active tasks as before
- User can manually open the panel via the title bar button or Cmd+Shift+A
- If the user has already opened the panel, it stays open (no change)

---

### #3 — Chat store conversation model

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:** `src/stores/chat-store.ts`

**Description**: Replace the flat `messages[]` array with a multi-conversation model.

**New interface:**

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  projectPaths: string[];
  sourceCommentId?: string;
  sourceDocumentId?: string;
}
```

**Store changes:**

- Replace `messages: ChatMessage[]` with `conversations: Conversation[]` + `activeConversationId: string | null`
- Remove top-level `selectedProjectPaths` — now per-conversation (`conv.projectPaths`)
- Scope all message methods to active conversation: `addMessage`, `updateMessage`, `deleteMessage`, `clearMessages`, `setMessageError`, `addActivity`, `completeLastActivity`, `completeAllActivities`
- Scope `setSelectedProjectPaths` / `toggleProjectPath` to active conversation's `projectPaths`
- New methods:
  - `createConversation(opts?: { title?, projectPaths?, sourceCommentId?, sourceDocumentId? }) → string` — returns ID, sets as active
  - `deleteConversation(id: string)` — removes, switches active to next or null
  - `setActiveConversation(id: string | null)`
  - `renameConversation(id: string, title: string)`
- Auto-title: first user message truncated to \~50 chars when title is empty
- `updatedAt` bumped on every `addMessage`

**Persist migration** (version 1 → 2):

- Old `messages[]` non-empty → wrap in conversation `{ id: 'migrated-default', title: 'Chat History', messages: [...], projectPaths: oldSelectedProjectPaths }`
- Empty → `conversations: []`
- Preserve `isLoading`, `error` fields as-is

**Acceptance criteria:**

- All existing message methods work scoped to active conversation
- `createConversation` / `deleteConversation` / `setActiveConversation` work correctly
- Per-conversation `projectPaths` replaces top-level `selectedProjectPaths`
- Persist migration correctly wraps old flat messages
- App loads without errors when upgrading from v1 persisted data

---

### #4 — Activity isolation in useAgentTaskOperations

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAgentTaskOperations.ts`

**Description**: Add `trackInActivityStore?: boolean` to `TaskMeta` so chat mode tasks stay invisible to the agent panel.

- Add `trackInActivityStore?: boolean` to `TaskMeta` interface (default `true`)
- `setupTask()`: skip `activityStore.addTask()` / `resetTaskForContinuation()` when `trackInActivityStore === false`
- `startAcpTask()`: guard all `activityStore.*` calls with `if (track)`:
  - `appendPartialOutput`, `appendThinkingOutput`, `appendActivity`, `completeLastActivity`, `updateTaskStatus`, `setFinalOutput`
  - Callbacks (`onChunk`, `onActivity`, `onComplete`, `onError`) remain unconditional
- `startDirectApiTask()`: same guards as `startAcpTask()`
- `cancelTask()`: check if task exists in activity-store before calling `updateTaskStatus`

**Acceptance criteria:**

- When `trackInActivityStore: false`, no entries appear in the activity store or agent panel
- When `trackInActivityStore: true` (default), behavior is identical to current
- Callbacks still fire regardless of tracking flag
- `cancelTask()` doesn't crash when task isn't in activity store
- Type check passes

---

### #5 — useCommentDelegation — activity isolation + moveToChat rewrite

**Complexity:** M **Category:** frontend **Dependencies:** #3, #4 **Files:** `src/hooks/useCommentDelegation.ts`

**Description**: Wire activity isolation into delegation flow and rewrite `moveToChat` to create a new conversation.

**Activity isolation:**

- In `delegateComment`: pass `trackInActivityStore: mode === 'delegate'` in `taskMeta`
- In `delegateReply`: pass `trackInActivityStore: mode === 'delegate'` in `taskMeta`
- Chat mode tasks now invisible to agent panel; delegate mode tasks visible as before

`moveToChat` **rewrite** — new signature: `moveToChat(comment: Comment, projectPath?: string)`:

- Map comment thread to `ChatMessage[]`:
  - Original comment → `{ role: 'user', content: "Comment on:\n> {anchorText}\n\n{body}" }`
  - Each reply → `{ role: reply.author === 'You' ? 'user' : 'assistant', content: reply.body }`
- Determine title: truncated anchor text (\~50 chars)
- Call `chatStore.createConversation({ title, projectPaths: projectPath ? [projectPath] : [], sourceCommentId: comment.id, sourceDocumentId: comment.documentId })`
- Call `chatStore.addMessage()` for each mapped message
- Open chat panel via `settingsStore.setChatPanelOpen(true)`

**Acceptance criteria:**

- Chat mode delegation: no agent panel activity
- Delegate mode delegation: agent panel shows task as before
- `moveToChat` creates a new conversation with correct messages, title, and project
- Old `moveToChat` behavior (single injected message) replaced entirely

---

### #6 — CommentPopover — button layout + reply delegate + activity default

**Complexity:** M **Category:** frontend **Dependencies:** #4, #5 **Files:** `src/components/editor/CommentPopover.tsx`

**Description**: Fix button layout, add reply delegate option, collapse activity by default.

**Remove** `onChatExisting` **prop** — no Chat button in view mode header.

**View mode header buttons** (updated layout):

- Delegate (SendHorizontal): only when `status === 'open'` (fresh comments without replies)
- Move to Chat (MessagesSquare): promoted to direct icon button, visible when `status === 'done' && has replies`
- DropdownMenu: Resolve, Edit, Delete (Move to Chat removed from dropdown)
- Close (X)

**Reply input** — add `onDelegateReply?: (text: string) => void` prop:

- Send button (SendHorizontal): existing, calls `onReply` (chat mode — stays open)
- Delegate button (BotMessageSquare): new, calls `onDelegateReply(text)`, popover closes
- Both disabled when input empty

**Activity section**: `activityExpanded` initial state → `false` (collapsed by default).

**Acceptance criteria:**

- No Chat button in view mode header (removed)
- Move to Chat is a visible icon button (not in dropdown)
- Reply input has both Send (chat) and Delegate (background) buttons
- Activity section starts collapsed
- Type check passes

---

### #7 — ChatPanel — conversation management UI

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:** `src/components/chat/ChatPanel.tsx`

**Description**: Replace static "AI Chat" header with conversation management.

**Header redesign:**

- Left: conversation title (clickable) → Popover with conversation list
  - "New Chat" button at top with Plus icon
  - List of conversations — click to switch, hover to show delete (X) button
  - Active conversation highlighted with `bg-accent`
- Right: New Chat (Plus) button

**State references:**

- `messages` derived from `conversations[activeConversationId].messages`
- `selectedProjectPaths` derived from `conversations[activeConversationId].projectPaths`

**Auto-create**: `handleSend` creates a conversation if none active.

`handleClear`: Delete active conversation instead of clearing all history.

**Acceptance criteria:**

- Conversation list shows all conversations with titles
- Click to switch, hover to delete
- New Chat button creates empty conversation
- Messages and project paths scoped to active conversation
- Sending a message auto-creates a conversation if none exists
- Type check passes

---

### #8 — Editor.tsx — wiring updates

**Complexity:** S **Category:** frontend **Dependencies:** #5, #6 **Files:** `src/components/editor/Editor.tsx`

**Description**: Update Editor.tsx to wire the new props and handlers.

- Remove `onChatExisting` prop and handler
- `onMoveToChat`: pass `projectPath` → `moveToChat(comment, projectPath)`
- Add `onDelegateReply` handler: calls `delegateReply(comment, text, docId, root, 'delegate')`, then closes popover
- `onReply` unchanged (already uses `'chat'` mode)

**Acceptance criteria:**

- `onChatExisting` removed — no separate Chat button in view mode header
- `onMoveToChat` passes project path for auto-selection
- `onDelegateReply` delegates with full history in background mode
- Type check passes

---

### #9 — End-to-end verification and polish

**Complexity:** M **Category:** frontend **Dependencies:** #1–#8 **Files:** All modified files

**Description**: Full verification pass against PRD quality gates.

**Functional checks:**

- [x]Chat button in create mode: saves, streams inline, popover stays open, NO agent panel activity

- [x]Delegate button in create mode: saves, closes, visible in activity panel

- [x]Add button: unchanged

- [x]View mode header: Delegate icon for open comments, Move to Chat for done comments (no Chat button)

- [x]Chat mode streaming: popover open, reply input on completion, activity collapsed

- [x]Delegate mode: popover closes, activity panel shows task

- [x]Reply + Send: chat mode, popover stays open, no agent panel

- [x]Reply + Delegate: delegate mode, full history sent, visible in agent panel, popover closes

- [x]"Move to Chat": creates NEW conversation thread with mapped messages + project auto-selected

- [x]Conversation management: create, switch, delete conversations in chat panel

- [x]Persist migration: old flat chat history wrapped in conversation

- [x]Bulk delegation: unchanged behavior

- [x]Cancel/Stop: works in both modes, clears delegation mode

- [x]Cancel from activity panel: spinners stop in comment popover and comment list

- [x]Agent panel does NOT auto-expand when tasks are delegated — strip shows icon only

- [x]Error handling: chat mode shows error inline, delegate mode shows toast

- [x]Apply-to-document: works on agent replies regardless of delegation mode

**Design checks:**

- [x]Button icons communicate intent clearly

- [x]Conversation selector in chat panel is clean and intuitive

- [x]No visual regression in comment list popover

- [x]Light and dark mode

- [x]Popover doesn't accidentally dismiss during chat streaming