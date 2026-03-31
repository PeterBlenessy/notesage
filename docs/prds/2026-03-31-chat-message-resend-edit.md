# PRD: Chat Message Resend & Edit

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **Priority** | Medium |
| **Impact** | Users can resend or edit any previous message without copy-pasting, and explore alternative conversation paths |
| **Related** | [acp-agent-recovery](2026-03-31-acp-agent-recovery.md) — resend supports the "retry after reconnection" use case |

## Problem

When a user wants to resend a previous message — whether after an agent recovery, to get a different response, or to rephrase a question — they have to manually copy the message text, paste it into the input, and send. There is no way to edit a sent message and regenerate the conversation from that point.

The existing "Branch from here" action (GitBranch icon on messages) creates a branch point but still requires the user to type a new message from scratch. There's no shortcut for "send this exact message again" or "tweak this message and resend."

## Goals

1. **Resend** — one-click resend of any user message, creating a new branch from the message's parent
2. **Edit & resend** — edit a previously sent user message and send the edited version, creating a new branch from the message's parent
3. **Conversation reset** — when resending/editing from an earlier point in the conversation, messages after that point on the current branch are preserved in the tree (accessible via BranchSwitcher) but the active thread follows the new branch

## Non-Goals

- Editing assistant messages (these are generated, not user-authored)
- Deleting individual messages (existing branch deletion covers this)
- Resending assistant messages ("regenerate response") — useful but separate; can be added later using the same branching mechanism
- Inline editing within the chat bubble (too complex for v1 — edit happens in the input area)

## User Experience

### Resend button

Every user message displays a **resend icon** (arrow-path or similar) on hover, alongside the existing copy and branch actions.

Clicking resend:

1. Creates a new branch from the message's parent (same as "Branch from here" on the parent)
2. Immediately sends the exact same message content on the new branch
3. The active thread switches to the new branch
4. The previous branch (with the original response and any subsequent messages) is preserved and accessible via BranchSwitcher at the branch point

From the user's perspective: they click resend, and the AI generates a fresh response to the same message. The old response is still reachable via the branch indicator that appears at the fork point.

### Edit button

Every user message displays an **edit icon** (pencil) on hover.

Clicking edit:

1. Copies the message content into the chat input area
2. The input shows a subtle indicator: "Editing message" with a cancel (X) button
3. The user modifies the text and presses Enter/Send
4. A new branch is created from the message's parent with the edited content
5. The active thread switches to the new branch
6. Previous branch preserved as with resend

If the user cancels (clicks X or presses Escape), the input returns to its normal empty state. No branch is created.

### Visual placement

The resend and edit buttons appear in the existing action row on user messages (where copy already lives), only on hover. Order: Edit, Resend, Copyirtual, Branch.

For assistant messages: only Copy and Branch are shown (no resend or edit).

### After agent recovery

When the ACP agent recovers from an unresponsive state, the user's last unanswered message is still visible in the chat. The user clicks the resend button on that message — the message is resent on a new branch, and the agent generates a response. This is the primary "retry after recovery" interaction.

## Technical Approach

### Branching mechanism

Both resend and edit use the existing tree-based branching in `chat-store`:

**Resend:**

```
1. Get the target message's parentId
2. Call addMessage({ role: 'user', content: originalContent, parentId: parentId })
3. The new message becomes a sibling of the original (same parent, new branch)
4. activeLeafId updates to the new message
5. Trigger the AI response (same as normal send flow)
```

**Edit & resend:**

```
1. User clicks edit → content copied to input, store the parentId as "edit context"
2. User modifies and sends → addMessage({ role: 'user', content: editedContent, parentId: storedParentId })
3. Same branching behavior as resend
```

This is the same mechanism that `branchFromMessage` already uses, but with the message content pre-filled rather than requiring the user to type from scratch.

### Chat input "editing" state

Add an optional editing state to `ChatInput`:

```typescript
interface EditContext {
  /** Parent message ID to branch from */
  parentId: string | null;
  /** Original message content (for display/reference) */
  originalContent: string;
}
```

When `editContext` is set:

- The input pre-fills with the original content
- A small banner appears above the input: "Editing message" with an X to cancel
- On send: the message is added with `parentId` from the edit context, then `editContext` is cleared
- On cancel: input clears, `editContext` is cleared

### ChatMessage component changes

Add two new action buttons to user messages in the hover action row:

- **Edit** (Pencil icon) — calls `onEdit(message)` prop
- **Resend** (RotateCcw or similar icon) — calls `onResend(message)` prop

Both callbacks are passed down from `ChatFooter` / `ChatPanel` where they have access to the chat store and AI operations.

### Branch indicator

When a resend or edit creates a sibling at an existing branch point, the `BranchSwitcher` count increments automatically (it already counts children of each message). No changes needed to the branching UI.

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/chat/ChatMessage.tsx` | Add edit/resend buttons to user message action row |
| `src/components/chat/ChatInput.tsx` | Add edit context state, pre-fill, banner |
| `src/components/chat/ChatFooter.tsx` | Wire up onEdit/onResend callbacks to chat store + AI operations |
| `src/components/chat/ChatPanel.tsx` | Pass callbacks through to ChatMessageList |
| `src/stores/chat-store.ts` | No changes needed — existing `addMessage` with explicit `parentId` handles branching |
| `src/lib/chat-tree.ts` | No changes needed — existing tree utilities handle the new branches |

## Quality Gates

- [x] Resend button visible on hover for all user messages

- [x] Clicking resend creates a new branch and triggers AI response

- [x] Edit button visible on hover for all user messages

- [x] Clicking edit pre-fills the input with message content and shows "Editing" indicator

- [x] Sending an edited message creates a new branch from the correct parent

- [x] Cancelling edit clears the input and editing state

- [x] Previous branch preserved and accessible via BranchSwitcher after resend/edit

- [x] Branch count updates correctly at the fork point

- [x] Resend/edit buttons not shown on assistant or system messages

- [x] Works with both ACP and direct API conversations

- [x] Keyboard shortcut: Escape cancels edit mode