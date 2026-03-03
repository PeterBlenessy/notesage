# PRD: Comment Delegation Modes

**Date:** 2026-03-03 **Status:** Draft

## Problem

Comment delegation currently has a single interaction mode: click "Delegate", the agent works in the background, and the response appears as a reply in the comment thread. This one-size-fits-all approach doesn't match the two distinct ways users interact with comments:

1. **Interactive exploration** — The user has a question or wants to iterate on the commented text. They want a back-and-forth conversation right there, staying focused on the specific passage.
2. **Background work** — The user writes an instruction (e.g., "research this topic", "improve this paragraph") and wants to hand it off, moving on to other work and checking back later.

The current flow forces both use cases into the background delegation model, which is suboptimal for interactive exploration where the user wants to stay engaged.

## Goals

1. **Two delegation modes in the comment popover** — "Chat" for interactive inline conversation, "Delegate" for background handoff
2. **Escalation path** — A comment conversation that outgrows the popover can be moved to the chat panel for more room
3. **Unified result storage** — All agent responses land in the comment thread regardless of mode, so there's one source of truth
4. **Bulk delegation unchanged** — Comment list "Delegate all" continues routing to the activity panel
5. **Same underlying engine** — Both modes use the same ACP/direct API task infrastructure with full tool use capabilities

## Non-Goals

- Changing the agent task operations infrastructure (`useAgentTaskOperations`)
- Adding new AI providers or routing slots
- Modifying the activity store or activity panel behavior
- Real-time collaboration (multi-user) on comments
- Detachable/floating comment windows

## User Stories

### Chat Mode (Interactive)

- As a user, I want to click "Chat" on a comment so the popover stays open and I can have a real-time conversation with the agent about the commented text
- As a user, I want to see the agent's streaming response directly in the comment popover so I stay in context
- As a user, I want to reply immediately after the agent responds, without closing and reopening the popover
- As a user, I want to move an ongoing comment conversation to the chat panel when it gets too long for the popover

### Delegate Mode (Background)

- As a user, I want to click "Delegate" on a comment so the popover closes and the agent works in the background
- As a user, I want to return to the comment popover later to see the agent's response and optionally continue the conversation
- As a user, I want to monitor delegation progress in the activity panel without staying anchored to the comment

### Bulk Delegation

- As a user, I want to delegate all open comments from the comment list popover so they're processed in the background with progress visible in the activity panel

### Escalation

- As a user, I want to move a comment conversation to the chat panel when the popover feels too constrained, so I can continue with more space while scrolling the document freely

## Technical Approach

### Two Modes, Same Engine

Both "Chat" and "Delegate" use the existing `useAgentTaskOperations.startTask()` with the same callback pattern. The difference is purely in the UX layer:

| Aspect | Chat Mode | Delegate Mode |
| --- | --- | --- |
| Popover behavior | Stays open | Closes |
| Progress visibility | Inline in popover | Activity panel |
| Activity store task | Created (for history) | Created (for tracking) |
| Comment status flow | `open` → `delegated` → `done` | `open` → `delegated` → `done` |
| Reply storage | Same `comment.replies[]` | Same `comment.replies[]` |
| Multi-turn | Immediate in popover | Reopen popover to reply |

### Comment Popover Changes

#### Create Mode

Current buttons: "Delegate" | "Add" New buttons: "Chat" | "Delegate" | "Add"

- **Chat**: Saves the comment, sets status to `delegated`, keeps popover open, starts streaming response inline
- **Delegate**: Same as current — saves, sets status, closes popover, background task
- **Add**: Same as current — saves without delegation

#### View Mode (status: `open`)

Current: Bot icon button for delegation New: Two buttons — chat icon (interactive) and send-away icon (delegate)

#### View Mode (status: `done`)

Current: Reply input at bottom, sends via `delegateReply()`New: Reply input stays, but user can choose "Chat" (stay open) or "Delegate" (close, background) for the reply. Default behavior: chat (stay open), since the user is already looking at the popover.

### Escalate to Chat Panel

When a comment conversation grows long, the user can click "Move to Chat" to continue in the chat panel:

1. User clicks "Move to Chat" action in the comment popover header (available when `status === 'done'` and at least one reply exists)
2. The full comment thread (anchor text, original comment, all replies) is injected into the chat panel as context
3. Chat panel opens with a system message providing the conversation context
4. The comment popover closes
5. The comment remains in the comment store with its full thread intact
6. Future chat messages in the panel are independent of the comment thread (no back-sync)

**Implementation:**

- Add a `moveToChat` action in `useCommentDelegation` that:
  - Builds a context summary from the comment thread
  - Calls `chatStore.addMessage()` with a system message containing the context
  - Calls `chatStore.addMessage()` with a user message like "Continue the conversation about: \[anchor text\]"
  - Opens the chat panel via `settingsStore.setChatPanelOpen(true)`
- The chat panel then uses the `interactive` routing slot (its normal path), not the `agent_tasks` slot

### Bulk Delegation (Unchanged)

`CommentListPopover` "Delegate all" and per-comment delegate buttons continue to use the current background delegation flow. These always close the popover and route progress to the activity panel — the user is in triage mode.

### State Changes

No new stores needed. Minimal additions to existing state:

#### comment-store

- Add `delegationMode` to runtime state per comment: `'chat' | 'delegate' | null`
- Used by `CommentPopover` to decide whether to stay open and show inline streaming
- Cleared when delegation completes

#### editor-store

- No changes

#### chat-store

- No structural changes — `addMessage()` already supports injecting messages

### Data Flow

#### Chat Mode Flow

```
User clicks "Chat" on comment
  → comment status → "delegated"
  → delegationMode → "chat"
  → popover stays open
  → startTask() with onChunk callback
  → chunks stream into popover via partialReply
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
  → startTask() (same as current)
  → progress visible in activity panel
  → agent completes → addReply() → status → "done"
  → delegationMode → null
  → user reopens popover to see response
```

#### Escalation Flow

```
User clicks "Move to Chat" in popover
  → build context from comment thread
  → inject into chat-store as system + user messages
  → open chat panel
  → close comment popover
  → user continues conversation in chat panel
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

- **Chat** (MessageSquare icon): Primary action when user wants to explore
- **Delegate** (SendHorizonal icon): Background handoff
- **Add**: Save without delegation (existing)

### Comment Popover — View Mode (Open)

```
┌─────────────────────────────────┐
│ Author · 2m ago   [💬] [➡] [···]│
│─────────────────────────────────│
│ Comment body text here          │
└─────────────────────────────────┘
```

- 💬 Chat icon: Start interactive conversation
- ➡ Delegate icon: Background handoff

### Comment Popover — View Mode (Done, with replies)

```
┌─────────────────────────────────┐
│ Author · 2m ago  [↗Chat] [···] │
│─────────────────────────────────│
│ Comment body text here          │
│                                 │
│ 🤖 Agent · 1m ago              │
│ Agent response rendered here... │
│                [Apply]          │
│                                 │
│ [reply input...        ] [Send] │
│─────────────────────────────────│
│ ▶ Agent activity (2 steps)      │
└─────────────────────────────────┘
```

- **↗Chat**: "Move to Chat" — escalate to chat panel (appears when thread has replies)
- Reply input: Send button defaults to chat mode (popover stays open)
- Reply input could have a small dropdown on Send for "Send & close" (delegate mode) — but this may be over-engineering for v1

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

### Comment List Popover (Unchanged)

Bulk "Delegate all" and per-comment delegate buttons behave exactly as today — background delegation, activity panel tracking.

## Dependencies

No new libraries. All changes use existing infrastructure:

- `useAgentTaskOperations` — task execution engine
- `useCommentDelegation` — delegation flow orchestration
- `comment-store` — comment state management
- `chat-store` — chat panel message injection
- Existing UI components (CommentPopover, ChatPanel, ActivityPanel)

## Quality Gates

### Functional

- [ ] "Chat" button in create mode saves comment, keeps popover open, and streams agent response inline

- [ ] "Delegate" button in create mode saves comment, closes popover, and routes to activity panel (existing behavior preserved)

- [ ] "Add" button unchanged — saves without delegation

- [ ] View mode shows both chat and delegate icons for open comments

- [ ] Chat mode: popover stays open during streaming, reply input appears on completion

- [ ] Delegate mode: popover closes, progress visible in activity panel

- [ ] Multi-turn works in both modes — full conversation history sent with each turn

- [ ] "Move to Chat" injects comment thread context into chat panel and opens it

- [ ] Bulk delegation from comment list popover unchanged

- [ ] Cancel/Stop works in both modes

- [ ] Error handling: chat mode reverts status and shows error inline; delegate mode shows toast

- [ ] Apply-to-document works on agent replies regardless of delegation mode

### Design

- [ ] Button icons clearly communicate "stay here" vs "hand off" intent

- [ ] Chat mode streaming feels responsive — same quality as current delegation streaming

- [ ] "Move to Chat" transition feels smooth — chat panel opens with full context

- [ ] No visual regression in comment list popover

- [ ] Works in both light and dark mode

## Out of Scope

- **Back-sync from chat to comments** — Once a conversation moves to the chat panel, the chat messages are independent. No attempt to sync chat responses back into the comment thread.
- **Choosing which agent to delegate to** — Both modes use the `agent_tasks` routing slot. Per-comment agent selection is a future enhancement.
- **Detachable/floating popover** — The escalation path to the chat panel solves the space constraint without adding window management complexity.
- **Delegate mode with popover staying open** — If the user wants to watch progress, they use chat mode. Delegate mode is explicitly "I'll check back later."
- **Keyboard shortcuts for mode selection** — v1 uses buttons only. Shortcuts can be added later if warranted by usage patterns.