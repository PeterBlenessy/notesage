# Task Breakdown: Comment Delegation Modes

**PRD:** `docs/prds/2026-03-03-comment-delegation-modes.md`**Total:** 7 tasks (2S, 4M, 1L) **Estimated effort:** \~6-8 hours

## Implementation Order

1. State layer first (comment-store)
2. Hook layer (useCommentDelegation)
3. UI layer (CommentPopover, then CommentListPopover)
4. Escalation feature (move to chat)
5. Verification pass

## Risks / Open Questions

- **Popover dismiss behavior**: The comment popover currently auto-closes on outside clicks. Chat mode needs the popover to stay open while the agent streams — must ensure no accidental dismissals during streaming. Verify that clicking in the editor while popover is open doesn't close it during chat mode.
- **Reply input mode**: PRD notes that reply sends could default to chat (stay open) vs delegate (close). For v1, default to chat since the user is already in the popover. A dropdown on Send is deferred.

---

## Tasks

### #1 — Add `delegationMode` to comment-store runtime state

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/stores/comment-store.ts`

**Description**:Add runtime-only (non-persisted) state to track the active delegation mode per comment.

- Add `delegationModeByComment: Record<string, 'chat' | 'delegate'>` to the store state (alongside `activitiesByComment`)
- Add actions:
  - `setDelegationMode(commentId: string, mode: 'chat' | 'delegate'): void`
  - `clearDelegationMode(commentId: string): void`
- Clear the mode entry in `deleteComment` and `clearDocument` cleanup actions
- Do NOT persist — this is ephemeral UI state, same pattern as `activitiesByComment`

**Acceptance criteria:**

- `setDelegationMode` / `clearDelegationMode` work correctly
- Mode is cleaned up on comment deletion and document close
- No changes to persisted comment JSON

---

### #2 — Update useCommentDelegation to accept delegation mode

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/hooks/useCommentDelegation.ts`

**Description**:Extend `delegateComment` and `delegateReply` to accept and track the delegation mode.

- Add `mode: 'chat' | 'delegate'` parameter to `delegateComment(comment, documentId, projectRoot, mode)`
- Add `mode: 'chat' | 'delegate'` parameter to `delegateReply(comment, replyText, documentId, projectRoot, mode)` — default to `'chat'`
- At the start of each function, call `commentStore.setDelegationMode(comment.id, mode)`
- On completion (both success and error), call `commentStore.clearDelegationMode(comment.id)`
- On cancellation in `cancelDelegation`, call `commentStore.clearDelegationMode(comment.id)`
- `delegateAll` always passes `mode: 'delegate'` (background/bulk)

**Acceptance criteria:**

- Mode is tracked in comment-store during delegation lifecycle
- Mode is cleared on completion, error, and cancellation
- `delegateAll` uses delegate mode exclusively
- No behavioral change to existing delegation — delegate mode behaves identically to current behavior

---

### #3 — Update CommentPopover create mode with Chat and Delegate buttons

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:** `src/components/editor/CommentPopover.tsx`, `src/components/editor/Editor.tsx`

**Description**:Replace the single "Delegate" button in create mode with two buttons: "Chat" and "Delegate".

**CommentPopover changes:**

- Add new prop: `onChat?: (body: string) => void` — create + chat mode (popover stays open)
- Rename existing `onDelegate` to keep it as-is (create + delegate mode, popover closes)
- Create mode button layout: `[Chat] [Delegate] [Add]`
  - Chat: `MessageSquare` icon, calls `onChat(trimmedBody)`, does NOT close popover
  - Delegate: `SendHorizonal` icon, calls `onDelegate(trimmedBody)`, closes popover (existing behavior)
  - Add: unchanged
- Both Chat and Delegate disabled if body is empty or `!canDelegate`
- After Chat click, switch the internal popover mode from `'create'` to `'view'` so the streaming response and activity footer render inline

**Editor.tsx wiring:**

- Add `onChat` handler that mirrors the existing `onDelegate` handler but passes `mode: 'chat'` to `delegateComment`
- Existing `onDelegate` handler passes `mode: 'delegate'`
- When `mode === 'chat'`, do NOT call `popoverControls.close()` — popover stays open

**Acceptance criteria:**

- Create mode shows three buttons: Chat, Delegate, Add
- Chat saves comment, starts delegation, popover stays open, response streams inline
- Delegate saves comment, starts delegation, popover closes (existing behavior)
- Add unchanged

---

### #4 — Update CommentPopover view mode with Chat and Delegate buttons

**Complexity:** L **Category:** frontend **Dependencies:** #2, #3 **Files:** `src/components/editor/CommentPopover.tsx`, `src/components/editor/Editor.tsx`

**Description**:Replace the single bot icon delegate button in view mode with two mode-specific buttons. Update reply behavior.

**View mode (status:** `open`**) — header action buttons:**

- Replace single `BotMessageSquare` delegate button with two buttons:
  - Chat icon (`MessageSquare`): calls new `onChatExisting?: () => void` prop — starts interactive delegation, popover stays open
  - Delegate icon (`SendHorizonal`): calls existing `onDelegateExisting` — background delegation, popover closes
- Both hidden when `status === 'delegated'` (delegation in progress)

**View mode (status:** `done`**) — reply input:**

- Current behavior: Enter in reply input calls `onReply(text)` which triggers `delegateReply` (always background)
- New behavior: `onReply` continues to call `delegateReply` but with `mode: 'chat'` by default (popover stays open, response streams inline)
- The popover already shows streaming state when `status === 'delegated'` — chat mode just means we don't close first

**View mode (status:** `delegated`**, chat mode active):**

- Popover remains open (the `delegationMode` for this comment is `'chat'`)
- Streaming response, activity log, stop button all render as they do today
- When delegation completes (`status` → `done`, `delegationMode` cleared), reply input reappears

**Editor.tsx wiring:**

- Add `onChatExisting` handler: reads comment from store, calls `delegateComment(comment, docId, root, 'chat')`
- Existing `onDelegateExisting` handler: calls `delegateComment(comment, docId, root, 'delegate')`
- Update `onReply` handler: calls `delegateReply(comment, text, docId, root, 'chat')`
- When `delegationMode === 'chat'`, suppress popover auto-close logic

**Popover dismiss guard:**

- Read `delegationModeByComment[comment.id]` from comment-store
- When mode is `'chat'` and status is `'delegated'`, prevent popover from closing on outside clicks (override `onOpenChange` to ignore close requests during active chat streaming)

**Acceptance criteria:**

- Open comments show both chat and delegate icons
- Chat mode: delegation starts, popover stays open, response streams inline, reply input appears on completion
- Delegate mode: delegation starts, popover closes (existing behavior)
- Reply input in done state sends with chat mode (stays open)
- Popover does not accidentally dismiss during active chat streaming
- Multi-turn works: user can reply → agent responds → user replies again, all within the open popover

---

### #5 — Add "Move to Chat" escalation action

**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:** `src/hooks/useCommentDelegation.ts`, `src/components/editor/CommentPopover.tsx`, `src/components/editor/Editor.tsx`, `src/stores/chat-store.ts`

**Description**:Add a "Move to Chat" button that transfers a comment conversation to the chat panel.

**useCommentDelegation — new** `moveToChat` **function:**

- Takes `comment: Comment`

- Builds a context message from the full thread:

  ```
  Continuing a conversation about the following text:
  > [anchorText]
  
  Original comment: [body]
  [For each reply: Author: reply.body]
  ```

- Calls `chatStore.addMessage({ role: 'system', content: contextMessage })`

- Calls `chatStore.addMessage({ role: 'user', content: 'Continue the conversation about: "[anchorText snippet]"' })`

- Opens chat panel via `settingsStore.setChatPanelOpen(true)`

- Returns the function from the hook

**CommentPopover changes:**

- Add prop: `onMoveToChat?: () => void`
- Show "Move to Chat" button (`ArrowUpRight` icon + "Move to Chat" label) in the header area
- Only visible when: `status === 'done' && comment.replies && comment.replies.length > 0`
- On click: calls `onMoveToChat`, then closes the popover

**Editor.tsx wiring:**

- Wire `onMoveToChat` to call `moveToChat(comment)` then close the popover

**Acceptance criteria:**

- "Move to Chat" button appears only on comments with agent replies (status: done)
- Clicking it injects the full conversation context into the chat panel
- Chat panel opens with the context visible
- Comment popover closes
- Comment thread remains intact in comment-store
- Chat panel uses `interactive` routing slot (its normal path)

---

### #6 — Ensure CommentListPopover bulk delegation unchanged

**Complexity:** S **Category:** frontend **Dependencies:** #2 **Files:** `src/components/editor/CommentListPopover.tsx`, `src/components/editor/Editor.tsx`

**Description**:Verify and ensure that the comment list popover continues to work with the updated hook signatures.

- `CommentListPopover` per-comment delegate button: wired through Editor.tsx `onDelegateComment` handler — ensure it passes `mode: 'delegate'` to `delegateComment`
- `CommentListPopover` "Delegate all" button: wired through Editor.tsx `onDelegateAll` handler — already uses `delegateAll()` which internally passes `mode: 'delegate'`
- Both buttons should close the popover as they do today
- No UI changes to `CommentListPopover` itself

**Acceptance criteria:**

- Per-comment delegate from comment list triggers background delegation
- "Delegate all" triggers sequential background delegation
- Both close the popover
- Progress visible in activity panel
- No visual or behavioral regression

---

### #7 — End-to-end verification and polish

**Complexity:** M **Category:** frontend **Dependencies:** #1–#6 **Files:** All modified files

**Description**:Full verification pass against PRD quality gates.

**Functional checks:**

- [ ] Chat button in create mode: saves, streams inline, popover stays open

- [ ] Delegate button in create mode: saves, closes, activity panel

- [ ] Add button: unchanged

- [ ] View mode: both chat and delegate icons for open comments

- [ ] Chat mode streaming: popover open, reply input on completion

- [ ] Delegate mode: popover closes, activity panel

- [ ] Multi-turn in chat mode: reply → stream → reply → stream, all in popover

- [ ] Multi-turn in delegate mode: reopen popover to see response, reply sends as delegate

- [ ] "Move to Chat": injects context, opens chat panel, closes popover

- [ ] Bulk delegation: unchanged behavior

- [ ] Cancel/Stop: works in both modes, clears delegation mode

- [ ] Error handling: chat mode shows error inline, delegate mode shows toast

- [ ] Apply-to-document: works on agent replies regardless of delegation mode

**Design checks:**

- [ ] Button icons communicate intent clearly

- [ ] No visual regression in comment list popover

- [ ] Light and dark mode

- [ ] Popover doesn't accidentally dismiss during chat streaming