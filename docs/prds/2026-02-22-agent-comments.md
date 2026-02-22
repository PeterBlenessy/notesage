# PRD: Agent Comment Delegation

**Date:** 2026-02-22
**Phase:** 6.5 — Chat UX & Agent Polish
**Version:** 0.14.1

## Problem

Notesage has inline document comments (select text -> Cmd+Shift+M -> type comment) and AI agent integration via ACP. But these two systems are completely disconnected. When a user writes a comment like "fact check this claim" or "expand this paragraph," they must manually copy the context into the chat panel, wait for the agent's response, and apply changes themselves.

This friction discourages using comments as actionable review items. Comments become passive annotations rather than work items that can be delegated. Users working with AI agents want a natural workflow: highlight text, leave a comment describing what needs to happen, and delegate it to an agent who replies directly in the comment thread.

## Goals / Non-Goals

**Goals:**

1. Users can delegate any comment to an AI agent with one click -- the agent replies within the comment thread
2. Comment lifecycle states (open -> delegated -> done -> resolved) provide clear visibility into what's being worked on
3. Delegation available from both the inline comment popover and the comment list popover
4. Agent replies persisted as part of the comment JSON (survives app restart)
5. Build on existing `useAgentTaskOperations` infrastructure -- no new ACP plumbing

**Non-Goals:**

- Agent Activity Strip/Panel (right-side activity indicator) -- deferred to Part 2
- Auto-apply: agent directly modifying document content from a comment -- deferred to Part 3
- Batch delegation (select multiple comments -> delegate all) -- deferred to Part 2
- Real-time streaming of agent response into the comment thread -- Part 1 shows response after completion
- Comment assignment to specific agents (always uses the `agent_tasks` routing slot)
- Collaborative multi-user comments -- single-user only

## User Stories

**Delegate from create:**
As a user, I want to select text, create a comment like "fact check this claim," and click "Delegate" to immediately send it to an AI agent, so I don't have to context-switch to the chat panel.

**Delegate existing comment:**
As a user, I want to delegate an already-created comment to an agent from the comment popover, so comments written during review can become agent tasks retroactively.

**Delegate from list:**
As a user, I want to click a delegate icon on any comment in the comment list popover, so I can quickly triage multiple comments for agent processing.

**See agent working:**
As a user, I want to see a spinner/indicator when an agent is processing my comment, so I know it's being handled and haven't lost track.

**Read agent reply:**
As a user, I want the agent's response to appear as a reply in the comment thread (with agent author attribution), so the conversation stays in context with the highlighted text.

**Resolve comment:**
As a user, I want to mark a comment as resolved after reviewing the agent's reply, so the comment highlight disappears and my document looks clean.

**No agent configured:**
As a user without an agent connection configured, I want to see a clear error toast if I try to delegate, telling me to set up agent routing in Settings.

## Technical Approach

### Data Model Changes

**`src/stores/comment-store.ts`**

Add reply and status types to the existing Comment interface. All new fields are optional (`?`) for backward compatibility with existing stored JSON:

```typescript
export interface CommentReply {
  id: string;
  body: string;
  author: string;      // e.g., "AI Agent"
  timestamp: number;
}

export interface Comment {
  // ... existing fields (id, documentId, anchorText, from, to, body, author, createdAt, updatedAt) ...
  replies?: CommentReply[];
  status?: 'open' | 'delegated' | 'done' | 'resolved';
  taskId?: string;  // ACP task ID when delegated
}
```

New store methods:
- `addReply(documentId, commentId, body, author)` -- pushes a `CommentReply` to the comment's `replies` array
- `setCommentStatus(documentId, commentId, status)` -- updates the comment's `status` field
- `setTaskId(documentId, commentId, taskId)` -- stores the ACP task ID on the comment

### Agent Task Integration

**`src/hooks/useAgentTaskOperations.ts`**

Add optional `onComplete` callback to `startTask`. When the `agent_turn_complete` event fires, invoke the callback with the accumulated output. This lets callers react to task completion without polling.

```typescript
startTask(prompt: string, onComplete?: (output: string) => void): Promise<string>
```

The callback fires inside the existing `acp-session-update` listener when `sessionUpdate === 'agent_turn_complete'`, reading the accumulated `output` from the task object.

### Comment Delegation Hook

**New file: `src/hooks/useCommentDelegation.ts`**

Encapsulates the delegation flow:
1. Checks that `taskConnection` exists (from `useAgentTaskOperations`)
2. Sets comment status to `delegated`
3. Builds a prompt from the comment body + anchor text context
4. Calls `startTask` with an `onComplete` callback that:
   - Adds the agent's output as a `CommentReply`
   - Sets comment status to `done`
   - Persists comments to disk via `saveComments`
5. Stores the `taskId` on the comment for future cancellation support

### CommentPopover Changes

**`src/components/editor/CommentPopover.tsx`**

- **Create mode:** Add a "Delegate" button next to "Add" (outline variant, `BotMessageSquare` icon). Clicking saves the comment AND delegates in one action.
- **View mode:** Add `BotMessageSquare` icon button (delegate) and `CheckCircle2` icon button (resolve) in the action bar. Display replies below the comment body with agent attribution. Show spinner when `status === 'delegated'`.

### CommentListPopover Changes

**`src/components/editor/CommentListPopover.tsx`**

Per comment row: add agent icon button + status indicators (spinner for delegated, bot icon for done).

### Comment Decoration Changes

**`src/hooks/useCommentOperations.ts`**

- Filter out `resolved` comments from ProseMirror decorations (no highlight shown)
- Add CSS class `comment-highlight-delegated` when `status === 'delegated'`

**`src/styles/editor.css`**

- Subtle pulse animation for delegated comment highlights

### Editor.tsx Wiring

Wire `useCommentDelegation()` hook, pass delegation callbacks to CommentPopover and through StatusBar -> CommentListPopover.

## UI/UX

### Create mode -- Delegate button

```
+--------------------------------------+
| Add comment                          |
| +----------------------------------+ |
| | Fact check this claim            | |
| |                                  | |
| +----------------------------------+ |
| Cmd+Enter to submit  [Delegate] [Add] |
+--------------------------------------+
```

"Delegate" button: outline variant with `BotMessageSquare` icon. Creates the comment AND sends to agent.

### View mode -- Agent reply + status

```
+--------------------------------------+
| You             2m ago  [bot] [v] [x]|
| Fact check this claim                |
| ------------------------------------ |
| [bot] AI Agent                1m ago |
| The claim about X is accurate per    |
| [source]. The figure of Y matches... |
| ------------------------------------ |
| [spinner] AI is working on this...   |
+--------------------------------------+
```

- Agent replies separated by a thin border
- `BotMessageSquare` icon with author name and relative timestamp
- Spinner + "AI is working on this..." when status is `delegated`
- `CheckCircle2` resolve button in action bar (marks as resolved -> hides highlight)

### Comment list -- Status indicators

```
+------------------------------------+
| Comments (3)                       |
+------------------------------------+
| "highlighted text..."    2m ago [s]|  <- delegated (spinner)
| Fact check this claim              |
| "other text..."         5m ago [b]|  <- done (bot icon, no spin)
| Expand this section                |
| "more text..."          1h ago    |  <- open (no icon)
| Fix the grammar here               |
+------------------------------------+
```

- Spinner icon for delegated comments
- Bot icon for done comments (reply received)
- Delegate icon button on hover for comments that haven't been delegated
- Resolved comments hidden from the list

## Data Model

```typescript
// New types (comment-store.ts)
interface CommentReply {
  id: string;           // crypto.randomUUID()
  body: string;         // Agent response text
  author: string;       // "AI Agent"
  timestamp: number;    // Date.now()
}

// Extended Comment (backward compatible)
interface Comment {
  id: string;
  documentId: string;
  anchorText: string;
  from: number;
  to: number;
  body: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  replies?: CommentReply[];                              // NEW
  status?: 'open' | 'delegated' | 'done' | 'resolved';  // NEW
  taskId?: string;                                        // NEW
}
```

Stored in `.notesage/comments/{documentId}.json` -- same file, extended shape. Existing comments without `replies`/`status`/`taskId` load fine (optional fields).

## Dependencies

- `useAgentTaskOperations` hook -- existing ACP task infrastructure
- `agent_tasks` routing slot -- existing per-use-case routing
- `comment-store` -- existing Zustand store
- `BotMessageSquare`, `CheckCircle2`, `Loader2` -- lucide-react icons (already available)
- No new libraries required

## Quality Gates

### Functional

- [ ] **Delegate from create:** Select text -> Cmd+Shift+M -> type comment -> click Delegate -> comment saved with status `delegated`, agent starts, spinner visible
- [ ] **Delegate from view:** Click existing comment -> click bot icon -> status changes to `delegated`, spinner visible
- [ ] **Delegate from list:** Comment list popover -> click bot icon on comment -> status changes, popover closes
- [ ] **Agent reply appears:** After agent completes, reply shows in comment popover with "AI Agent" attribution and relative timestamp
- [ ] **Status lifecycle:** open -> delegated (spinner) -> done (reply received) -> resolved (highlight removed)
- [ ] **Resolve comment:** Click CheckCircle2 in view mode -> comment highlight disappears from editor
- [ ] **Resolved comments hidden:** Resolved comments not shown in decoration highlights or comment list
- [ ] **Persistence:** Agent replies and status survive app restart (persisted in sidecar JSON)
- [ ] **No agent configured:** Click Delegate without agent_tasks routing -> toast error
- [ ] **Backward compatibility:** Existing comments without status/replies load and display correctly
- [ ] **TypeScript:** `npx tsc --noEmit` passes
- [ ] **Tests:** `pnpm test` passes

### Design

- [ ] Delegate button matches existing popover button styling (outline variant, xs size)
- [ ] Agent reply section visually distinct from user comment (border separator, bot icon)
- [ ] Spinner animation smooth, uses existing `animate-spin` utility
- [ ] Delegated highlight pulse subtle, not distracting
- [ ] All new UI works in both light and dark mode
- [ ] No chromatic accent colors (greyscale palette only)

## Out of Scope (Future Parts)

**Part 2 -- Agent Activity & Batch:**
- Agent Activity Strip (right-side vertical indicator showing active agent tasks)
- Batch delegation (select multiple comments -> delegate all at once)
- Agent task cancellation from comment UI
- Progress streaming (show agent response as it generates)

**Part 3 -- Auto-Apply:**
- Agent directly applies suggested changes to the document
- Inline diff review for agent-proposed edits
- "Apply suggestion" button on agent replies
- Conflict resolution when agent edits overlap with user edits

## Files

| File | Role |
|------|------|
| `src/stores/comment-store.ts` | Add `CommentReply`, extend `Comment`, add `addReply`, `setCommentStatus`, `setTaskId` |
| `src/hooks/useAgentTaskOperations.ts` | Add `onComplete` callback to `startTask` |
| `src/hooks/useCommentDelegation.ts` | **New** -- delegation flow hook |
| `src/components/editor/CommentPopover.tsx` | Delegate button (create + view), replies, status, resolve |
| `src/components/editor/CommentListPopover.tsx` | Delegate icon + status per comment |
| `src/components/editor/Editor.tsx` | Wire delegation callbacks |
| `src/components/editor/StatusBar.tsx` | Pass delegation props through |
| `src/hooks/useCommentOperations.ts` | Filter resolved from decorations, add delegated class |
| `src/styles/editor.css` | `comment-highlight-delegated` pulse animation |
