# Chat Message Resend & Edit — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **PRD** | [chat-message-resend-edit](../prds/2026-03-31-chat-message-resend-edit.md) |
| **Total** | 7 tasks: 3S, 3M, 1L |
| **Suggested order** | State (#1) -&gt; UI (#2-#5) -&gt; Integration (#6) -&gt; Tests (#7) |

**Risks:**

- The `onSend` callback in `ChatPanel.handleSend` does skill/agent expansion and project context assembly — resend must go through the same path (not bypass it) to ensure skills and agents are handled correctly
- Edit context must survive the async send flow — if the user edits a message and an `AgentSwitchCard` blocks the send, the edit context should persist until the send actually happens or is cancelled

---

### #1 — Add edit context state to ChatPanel ✅

**Description:** Add state to `ChatPanel` that tracks when the user is editing/resending a previous message. This state holds the parent message ID to branch from and the original content.

The state lives in `ChatPanel` (not the store) because it's transient UI state — it doesn't need persistence, and it needs access to the send flow.

```typescript
interface EditContext {
  parentId: string | null;  // Branch from this message's parent
  originalContent: string;
}
```

**Acceptance criteria:**

- `editContext` state in ChatPanel, initially `null`
- `setEditContext` / `clearEditContext` handlers
- When `editContext` is set, `handleSend` uses `editContext.parentId` as the branch parent instead of appending to the current thread
- After send completes (or on cancel), `editContext` is cleared
- `editContext` and `clearEditContext` passed down to `ChatFooter` -&gt; `ChatInput` via props

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/chat/ChatPanel.tsx` (state, modified handleSend)
- `src/components/chat/ChatFooter.tsx` (pass through props)

---

### #2 — Add resend and edit buttons to ChatMessage hover actions ✅

**Description:** Add Edit (Pencil) and Resend (RotateCcw) icon buttons to the hover action row on user messages, alongside existing Copy and Branch buttons.

Currently the hover actions are: delete (top corner), copy (bottom row, assistant only), branch (bottom row). Add edit and resend for user messages only.

**Acceptance criteria:**

- Edit button (Pencil icon) shown on hover for `role: 'user'` messages only
- Resend button (RotateCcw icon) shown on hover for `role: 'user'` messages only
- Button order in the action row: Edit, Resend, Copy, Branch
- Neither button shown on assistant, system, or tool messages
- Neither button shown while `isLoading` (prevent resend during active generation)
- Both buttons use the same styling as existing copy/branch buttons
- Tooltips: "Edit message", "Resend message"
- `onEdit` and `onResend` callbacks passed as props from `ChatMessageList`

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/chat/ChatMessage.tsx` (new buttons in action row)
- `src/components/chat/ChatMessageList.tsx` (pass onEdit/onResend callbacks)

---

### #3 — Implement resend flow ✅

**Description:** Wire up the resend button to create a new branch from the target message's parent and immediately send the same content.

Resend flow:

1. User clicks resend on a user message
2. `onResend(message)` callback fires in `ChatPanel`
3. Get `message.parentId` (the parent to branch from) — if the message itself is a root message, `parentId` is `null`
4. Set edit context with `parentId` and original content
5. Immediately call `handleSend(message.content)` — which uses `editContext.parentId` to create the branch
6. Active leaf switches to the new branch automatically (existing `addMessage` with explicit `parentId` behavior)

**Acceptance criteria:**

- Clicking resend triggers an immediate AI response with the same message content
- A new branch is created from the correct parent message
- The active thread switches to the new branch
- Previous branch is preserved and accessible via BranchSwitcher
- Branch count at the fork point increments
- Works for both ACP and direct API conversations
- Works for root messages (parentId = null) and mid-conversation messages

**Complexity:** M **Category:** frontend **Dependencies:** #1, #2 **Files:**

- `src/components/chat/ChatPanel.tsx` (handleResend callback)
- `src/components/chat/ChatMessageList.tsx` (wire callback)

---

### #4 — Add editing indicator banner to ChatInput ✅

**Description:** When edit context is active, show a subtle banner above the input area indicating "Editing message" with an X button to cancel. Pre-fill the input with the original message content.

**Acceptance criteria:**

- When `editContext` prop is set, input pre-fills with `editContext.originalContent`
- Banner appears above the textarea: "Editing message" text + X cancel button
- Banner styled subtly — muted background, small text, consistent with app design (follow existing context pill patterns)
- Clicking X or pressing Escape clears the edit context and resets the input to empty
- Cursor placed at the end of the pre-filled text
- Input textarea auto-focuses when entering edit mode
- Sending the message clears the edit context (handled by parent)

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:**

- `src/components/chat/ChatInput.tsx` (editContext prop, banner UI, pre-fill logic)
- `src/components/chat/ChatFooter.tsx` (pass editContext prop through)

---

### #5 — Implement edit flow ✅

**Description:** Wire up the edit button to copy message content into the input with edit context, then send the edited version as a new branch.

Edit flow:

1. User clicks edit on a user message
2. `onEdit(message)` callback fires in `ChatPanel`
3. Sets `editContext` with `{ parentId: message.parentId, originalContent: message.content }`
4. `ChatInput` pre-fills with content, shows "Editing message" banner
5. User modifies text and presses Send
6. `handleSend` detects `editContext`, creates branch from `editContext.parentId`
7. Edit context cleared after send

**Acceptance criteria:**

- Clicking edit pre-fills the input with the message content
- "Editing message" banner visible with cancel option
- Modified content sent as a new branch from the correct parent
- Cancelling edit (X or Escape) returns input to normal empty state
- If user clicks edit on a different message while already editing, the new edit replaces the old one
- Works for messages at any point in the conversation tree

**Complexity:** S **Category:** frontend **Dependencies:** #1, #2, #4 **Files:**

- `src/components/chat/ChatPanel.tsx` (handleEdit callback)
- `src/components/chat/ChatMessageList.tsx` (wire callback)

---

### #6 — Ensure branching sends through the full AI pipeline ✅

**Description:** Verify that resend/edit messages go through the complete `handleSend` flow in `ChatPanel` — including skill expansion, agent addressing, project context, and provider routing. The branch parent override from `editContext` must integrate with the existing `addMessage` + `sendChatMessage` pipeline without bypassing any steps.

This is an integration task to ensure correctness across both ACP and direct API paths.

**Acceptance criteria:**

- Resent/edited messages trigger skill expansion if content starts with `/`
- Resent/edited messages trigger agent addressing if content starts with `@`
- Project context (selected projects, goals) included in resent/edited messages
- ACP path: session management works correctly (reuses session or creates new one as appropriate)
- Direct API path: message array built correctly with branch history (not the old branch's history)
- `getThread()` from `chat-tree.ts` returns the correct message sequence for the new branch
- After resend/edit, follow-up messages continue on the new branch naturally

**Complexity:** S **Category:** frontend **Dependencies:** #3, #5 **Files:**

- `src/components/chat/ChatPanel.tsx` (verify handleSend integration)
- `src/stores/chat-store.ts` (verify addMessage with explicit parentId builds correct thread)

---

### #7 — Write tests for resend and edit flows ✅

**Description:** Add unit and component tests covering the new resend/edit behavior.

**Acceptance criteria:**

- Test: resend creates a sibling message with same content and correct parentId
- Test: edit creates a sibling message with modified content and correct parentId
- Test: edit context clears after send
- Test: edit context clears on cancel (Escape or X button)
- Test: resend/edit buttons only appear on user messages, not assistant/system/tool
- Test: resend/edit buttons hidden during loading state
- Test: editing a different message replaces the current edit context
- Test: branch count increments at the fork point after resend/edit
- Test: `getThread()` returns the correct sequence for the new branch (not the old one)

**Complexity:** M **Category:** frontend **Dependencies:** #3, #5 **Files:**

- `src/components/chat/__tests__/ChatMessage.test.tsx` (button visibility)
- `src/components/chat/__tests__/ChatInput.test.tsx` (edit banner, pre-fill, cancel)
- `src/stores/__tests__/chat-store.test.ts` (branching with explicit parentId)