# PRD: Comment Delegation Modes

**Date:** 2026-03-03 **Updated:** 2026-03-05 **Status:** ✅ Complete

## Problem

Comment delegation currently has a single interaction mode: click "Delegate", the agent works in the background, and the response appears as a reply in the comment thread. This one-size-fits-all approach doesn't match the two distinct ways users interact with comments:

1. **Interactive exploration** — The user has a question or wants to iterate on the commented text. They want a back-and-forth conversation right there, staying focused on the specific passage.
2. **Background work** — The user writes an instruction (e.g., "research this topic", "improve this paragraph") and wants to hand it off, moving on to other work and checking back later.

The v1 implementation (v0.17.x) introduced Chat and Delegate buttons but has several UX issues that need correction:

- Chat mode leaks activity to the agent panel — conversations in the popover should stay self-contained
- "Move to Chat" appends to the existing flat chat history instead of creating a separate conversation
- No way to manage separate chat conversations (list, select, delete threads)
- Delegating from an ongoing conversation discards the message history and starts over
- "Chat with agent" button in view mode header is redundant when the reply input already provides chat functionality
- Activity section expands by default during chat, cluttering the popover
- Cancelling a task from the agent activity panel doesn't update the comment — spinners keep spinning in the comment popover and comment list
- Agent activity panel auto-expands when new tasks are delegated — should only show a new icon in the strip

## Goals

1. **Two delegation modes with clear boundaries** — "Chat" stays fully within the comment popover (no agent panel), "Delegate" hands off to the agent panel
2. **Conversation continuity** — Delegating from an ongoing conversation preserves the full message history
3. **Chat thread separation** — Moving to chat panel creates a new conversation thread, not appending to existing chat
4. **Conversation management** — Chat panel supports multiple threads with list, select, and delete
5. **Context preservation** — Moving to chat panel auto-selects the document's project for correct AI context
6. **Unified result storage** — All agent responses land in the comment thread regardless of mode
7. **Bulk delegation unchanged** — Comment list "Delegate all" continues routing to the activity panel

## Non-Goals

- Adding new AI providers or routing slots
- Real-time collaboration (multi-user) on comments
- Detachable/floating comment windows
- Back-sync from chat panel conversations to comment threads

## User Stories

### Chat Mode (Interactive)

- As a user, I want to click "Chat" on a new comment so the popover stays open and I can have a real-time conversation with the agent about the commented text
- As a user, I want the chat conversation to stay fully within the comment popover — no activity appearing in the agent panel
- As a user, I want to see the agent's streaming response directly in the comment popover so I stay in context
- As a user, I want to reply immediately after the agent responds, without closing and reopening the popover
- As a user, I want the agent activity section collapsed by default so it doesn't clutter the conversation

### Delegate Mode (Background)

- As a user, I want to click "Delegate" on a new comment so the popover closes and the agent works in the background
- As a user, I want to type a reply in an ongoing conversation and delegate it (with full message history) so the agent has context
- As a user, I want to return to the comment popover later to see the agent's response and optionally continue the conversation
- As a user, I want to monitor delegation progress in the activity panel without staying anchored to the comment

### Escalation to Chat Panel

- As a user, I want to move a comment conversation to the chat panel when the popover feels too constrained, so I can continue with more space
- As a user, I want the moved conversation to appear as a new, separate chat thread — not appended to an existing conversation
- As a user, I want the document's project to be auto-selected in the new chat thread so AI context is correct

### Chat Conversation Management

- As a user, I want to see a list of all my chat conversations in the chat panel header
- As a user, I want to switch between conversations without losing history
- As a user, I want to delete individual conversations I no longer need
- As a user, I want to start a new blank conversation at any time

### Bulk Delegation

- As a user, I want to delegate all open comments from the comment list popover so they're processed in the background with progress visible in the activity panel

## Technical Approach

### Two Modes, Same Engine — with Activity Isolation

Both "Chat" and "Delegate" use `useAgentTaskOperations.startTask()` with the same callback pattern. The key difference: **chat mode does NOT register tasks in the activity store**, keeping the agent panel clean.

| Aspect | Chat Mode | Delegate Mode |
| --- | --- | --- |
| Popover behavior | Stays open | Closes |
| Progress visibility | Inline in popover only | Activity panel |
| Activity store task | **NOT created** | Created (for tracking) |
| Comment status flow | `open` → `delegated` → `done` | `open` → `delegated` → `done` |
| Reply storage | Same `comment.replies[]` | Same `comment.replies[]` |
| Multi-turn | Immediate in popover | Reopen popover to reply |

**Activity isolation implementation:** Add `trackInActivityStore?: boolean` to `TaskMeta` (default `true`). When `false`, `startTask()` skips all `activityStore.*` calls (`addTask`, `appendPartialOutput`, `appendThinkingOutput`, `appendActivity`, `completeLastActivity`, `updateTaskStatus`, `setFinalOutput`). Callbacks (`onChunk`, `onActivity`, `onComplete`, `onError`) remain unconditional — the comment-store activity log still works.

### Comment Popover Changes

#### Create Mode

Buttons: "Chat" | "Delegate" | "Add" (unchanged from v1 implementation)

- **Chat**: Saves the comment, sets status to `delegated`, keeps popover open, starts streaming response inline. Task NOT tracked in activity store.
- **Delegate**: Saves, sets status, closes popover, background task visible in activity panel.
- **Add**: Saves without delegation (existing).

#### View Mode (status: `open`)

Header action buttons: Delegate icon only (no separate Chat button — the Chat button in create mode is sufficient for new comments, and for open comments without replies the user can delegate to background).

#### View Mode (status: `done`)

Reply input with two send actions:

- **Send** (SendHorizontal icon): Calls `delegateReply` with `mode: 'chat'` — popover stays open, response streams inline, NOT tracked in activity store.
- **Delegate** (BotMessageSquare icon): Calls `delegateReply` with `mode: 'delegate'` — popover closes, full conversation history included in prompt, progress visible in activity panel.

Both buttons disabled when input is empty.

#### Activity Section Default

Activity section (`activityExpanded`) initializes to `false` (collapsed by default) to reduce clutter during chat conversations.

### Escalate to Chat Panel — New Conversation Thread

When a comment conversation grows long, the user can click "Move to Chat" to continue in the chat panel. This creates a **new, separate conversation** — not appending to an existing one.

1. User clicks "Move to Chat" button in the comment popover header (visible when `status === 'done'` and at least one reply exists)
2. `moveToChat` maps the comment thread to `ChatMessage[]`:
   - Original comment → `{ role: 'user', content: "Comment on:\n> {anchorText}\n\n{body}" }`
   - Each reply → `{ role: reply.author === 'You' ? 'user' : 'assistant', content: reply.body }`
3. Creates a new conversation via `chatStore.createConversation()` with:
   - `title`: Truncated anchor text (\~50 chars)
   - `projectPaths`: Auto-selected from the document's project
   - `sourceCommentId` and `sourceDocumentId` for traceability
4. Adds each mapped message to the new conversation
5. Opens the chat panel
6. Comment popover closes
7. Comment thread remains intact in comment-store (no back-sync)
8. Chat panel uses the `interactive` routing slot (its normal path)

### Chat Store — Conversation Model

The flat `messages[]` array is replaced with a multi-conversation model:

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  projectPaths: string[];
  sourceCommentId?: string;   // if created from "Move to Chat"
  sourceDocumentId?: string;
}
```

**Store changes:**

- Replace `messages: ChatMessage[]` with `conversations: Conversation[]` + `activeConversationId: string | null`
- Remove top-level `selectedProjectPaths` — now per-conversation (`conv.projectPaths`)
- All message methods scoped to active conversation
- New methods: `createConversation()`, `deleteConversation()`, `setActiveConversation()`, `renameConversation()`
- Auto-title: first user message truncated to \~50 chars when title is empty

**Migration** (persist version 1 → 2):

- Old `messages[]` non-empty → wrap in `{ id: 'migrated-default', title: 'Chat History', messages: [...] }`
- Empty → `conversations: []`

### Chat Panel — Conversation Management

The static "AI Chat" header becomes a conversation selector:

- Left: Conversation title (clickable) → Popover with conversation list
  - "New Chat" button at top
  - List of conversations — click to switch, hover to show delete button
  - Active conversation highlighted
- Right: New Chat (Plus) button
- `handleSend` creates a conversation if none is active
- `handleClear` deletes the active conversation instead of clearing all history

### Bulk Delegation (Unchanged)

`CommentListPopover` "Delegate all" and per-comment delegate buttons continue to use background delegation with `trackInActivityStore: true`. These always close the popover and route progress to the activity panel.

### State Changes

#### comment-store (already implemented in v1)

- `delegationModeByComment: Record<string, DelegationMode>` — runtime-only, tracks `'chat' | 'delegate'`
- No additional changes needed

#### chat-store (significant restructuring)

- New `Conversation` interface and `conversations[]` array
- Per-conversation `projectPaths` (replaces top-level `selectedProjectPaths`)
- Persist middleware version 1 → 2 migration
- New CRUD methods for conversation management

#### useAgentTaskOperations

- New `trackInActivityStore?: boolean` on `TaskMeta`
- Conditional guards on all `activityStore.*` calls in `setupTask()`, `startAcpTask()`, `startDirectApiTask()`

### Data Flow

#### Chat Mode Flow

```
User clicks "Chat" on comment
  → comment status → "delegated"
  → delegationMode → "chat"
  → popover stays open
  → startTask() with trackInActivityStore: false
  → NO task created in activity store
  → chunks stream into popover via partialReply
  → comment-store activity log updated (local to popover)
  → agent completes → addReply() → status → "done"
  → delegationMode → null
  → reply input appears, user can continue
```

#### Delegate Mode Flow

```
User clicks "Delegate" on comment
  → comment status → "delegated"
  → delegationMode → "delegate"
  → popover closes
  → startTask() with trackInActivityStore: true
  → task created in activity store → visible in agent panel
  → agent completes → addReply() → status → "done"
  → delegationMode → null
  → user reopens popover to see response
```

#### Reply with Delegate Flow (new)

```
User types reply, clicks Delegate button (BotMessageSquare)
  → addReply(userReply) to comment thread
  → delegateReply(comment, text, docId, root, 'delegate')
  → full conversation history included in prompt
  → trackInActivityStore: true → visible in agent panel
  → popover closes
  → agent completes → addReply(agentResponse) → status → "done"
```

#### Escalation Flow

```
User clicks "Move to Chat" in popover
  → map comment thread to ChatMessage[] (user/assistant roles)
  → chatStore.createConversation({ title, projectPaths, sourceCommentId })
  → add mapped messages to new conversation
  → open chat panel
  → close comment popover
  → user continues in a separate, independent conversation
```

## UI/UX

### Comment Popover — Create Mode

```
┌─────────────────────────────────┐
│ [textarea: comment body]        │
│                                 │
│         [Chat] [Delegate] [Add] │
└─────────────────────────────────┘
```

- **Chat** (MessageSquare icon): Primary action when user wants to explore — stays in popover, no agent panel activity
- **Delegate** (SendHorizonal icon): Background handoff — closes popover, visible in agent panel
- **Add**: Save without delegation (existing)

### Comment Popover — View Mode (Open)

```
┌─────────────────────────────────┐
│ Author · 2m ago    [➡] [···] [X]│
│─────────────────────────────────│
│ Comment body text here          │
└─────────────────────────────────┘
```

- [ ] 

- \[ \]
- \[x\]
- \[ \]
- \[ \]
- ➡ Delegate icon (SendHorizontal): Background handoff — no separate Chat icon (use Chat from create mode for new comments)
- \[···\] DropdownMenu: Edit, Delete, Resolve

- [x] Close

### Comment Popover — View Mode (Done, with replies)

```
┌─────────────────────────────────┐
│ Author · 2m ago [💬→] [···] [X] │
│─────────────────────────────────│
│ Comment body text here          │
│                                 │
│ 🤖 Agent · 1m ago              │
│ Agent response rendered here... │
│                [Apply]          │
│                                 │
│ [reply input...     ] [📤] [🤖] │
│─────────────────────────────────│
│ ▶ Agent activity (2 steps)      │
└─────────────────────────────────┘
```

- **💬→ Move to Chat** (MessagesSquare icon): Visible button — escalates to chat panel as a new conversation thread with project auto-selected
- **📤 Send** (SendHorizontal): Chat mode reply — popover stays open, streams inline, NOT in agent panel
- **🤖 Delegate** (BotMessageSquare): Delegate reply — popover closes, full history sent, visible in agent panel
- \[···\] DropdownMenu: Edit, Delete, Resolve
- Activity section collapsed by default

### Comment Popover — Active Chat (Delegated, chat mode)

```
┌─────────────────────────────────┐
│ Author · 2m ago          [Stop] │
│─────────────────────────────────│
│ Comment body text here          │
│                                 │
│ 🤖 Agent · streaming...        │
│ Response streaming in here ████ │
│                                 │
│─────────────────────────────────│
│ ● AI is working on this...      │
│ ▶ Agent activity (1 step)       │
└─────────────────────────────────┘
```

- Popover stays open, streaming visible
- Stop button to cancel
- Auto-scrolls as response streams in (existing behavior)
- Activity section collapsed by default — expandable on click
- Agent panel shows NO activity for this task

### Chat Panel — Conversation Header

```
┌──────────────────────────────────────┐
│ [Conversation Title ▼]        [+] [X]│
│──────────────────────────────────────│
│ ...messages...                       │
│                                      │
│ [input...                    ] [Send]│
│ [project selector]                   │
└──────────────────────────────────────┘
```

Clicking the conversation title opens a popover:

```
┌──────────────────────┐
│ [+ New Chat]         │
│──────────────────────│
│ ● Comment on intro.. │  ← active
│   API research       │
│   Chat History       │  ← migrated
└──────────────────────┘
```

- Click to switch conversations
- Hover to show delete (X) button
- Active conversation highlighted
- \[+\] in header creates new blank conversation

### Comment List Popover (Unchanged)

Bulk "Delegate all" and per-comment delegate buttons behave exactly as today — background delegation, activity panel tracking.

## Dependencies

No new libraries. All changes use existing infrastructure:

- `useAgentTaskOperations` — task execution engine (modified: `trackInActivityStore` flag)
- `useCommentDelegation` — delegation flow orchestration (modified: activity isolation, moveToChat rewrite)
- `comment-store` — comment state management (already has `delegationModeByComment`)
- `chat-store` — restructured with conversation model and persist migration
- `activity-store` — conditional registration (no structural changes)
- Existing UI components (CommentPopover, ChatPanel, ActivityPanel, CommentListPopover)

## Quality Gates

### Functional

- \[x\]"Chat" button in create mode saves comment, keeps popover open, and streams agent response inline

- \[x\]"Delegate" button in create mode saves comment, closes popover, and routes to activity panel (existing behavior preserved)

- \[x\]"Add" button unchanged — saves without delegation

- \[x\]Chat mode: NO activity appears in the agent panel — fully contained in popover

- \[x\]Delegate mode: popover closes, progress visible in activity panel

- \[x\]Chat mode streaming: popover stays open, reply input appears on completion

- \[x\]Multi-turn works in both modes — full conversation history sent with each turn

- \[x\]Reply + Delegate: sends with full conversation history, shows in agent panel, popover closes

- \[x\]"Move to Chat" creates a NEW conversation thread (not appending to existing)

- \[x\]"Move to Chat" auto-selects the document's project in the new conversation

- \[x\]Chat panel conversation list: create, switch, delete conversations

- \[x\]Persist migration: old flat chat history wrapped in a conversation on upgrade

- \[x\]Activity section collapsed by default in comment popover

- \[x\]Bulk delegation from comment list popover unchanged

- \[x\]Cancel/Stop works in both modes, clears delegation mode

- \[x\]Cancel from activity panel updates comment store — spinners stop, status reverts to open

- \[x\]Agent activity panel does NOT auto-expand when new tasks are delegated — strip shows icon only

- \[x\]Error handling: chat mode reverts status and shows error inline; delegate mode shows toast

- \[x\]Apply-to-document works on agent replies regardless of delegation mode

### Design

- \[x\]Button icons clearly communicate "stay here" vs "hand off" intent

- \[x\]Chat mode streaming feels responsive — same quality as current delegation streaming

- \[x\]"Move to Chat" transition feels smooth — new conversation opens with full context

- \[x\]Conversation selector in chat panel header is clean and intuitive

- \[x\]No visual regression in comment list popover

- \[x\]Works in both light and dark mode

## Out of Scope

- **Back-sync from chat to comments** — Once a conversation moves to the chat panel, the chat messages are independent. No attempt to sync chat responses back into the comment thread.
- **Choosing which agent to delegate to** — Both modes use the `agent_tasks` routing slot. Per-comment agent selection is a future enhancement.
- **Detachable/floating popover** — The escalation path to the chat panel solves the space constraint without adding window management complexity.
- **Delegate mode with popover staying open** — If the user wants to watch progress, they use chat mode. Delegate mode is explicitly "I'll check back later."
- **Keyboard shortcuts for mode selection** — Buttons only. Shortcuts can be added later if warranted by usage patterns.
- **Conversation renaming** — Auto-titled from first message. Manual rename deferred to future iteration.
- **Conversation search** — Searching across conversation history is deferred.