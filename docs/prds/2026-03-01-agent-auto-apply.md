# Agent Comment Delegation Part 3 — Multi-Turn Threads & Apply-to-Document

**Date:** 2026-03-01 **Status:** Done **Parent:** Phase 6.5 **Depends on:** `2026-03-01-diff-fidelity.md`

## Problem

Two limitations in the current comment delegation flow:

1. **Comments are single-turn.** The user writes one comment, the agent replies once, and the thread is done. There's no way to say "make it shorter", "try a different approach", or ask a follow-up question. The user must create a new comment to continue the conversation.

2. **Agent responses can't be applied to the document.** When the agent suggests rewritten text, the user must manually copy it from the comment thread and paste it into the document. There's no way to preview the change as an inline diff or accept it with one keystroke.

## How It Should Work

```
1. User delegates comment ("make this clearer")
     ↓
2. Agent responds with suggested rewrite
     ↓
3. User reads the response and has three options:
   a. [Apply] → show inline diff on anchor text → accept/reject
   b. [Reply] → send follow-up message → agent responds again → repeat from 3
   c. [Resolve] → comment was informational, no text change needed
```

The key insight: **Apply is an explicit user action, not automatic.** Not all comments need text changes ("explain this", "is this correct?"), and the user may want to refine the agent's response before applying it.

## Goals

- Multi-turn comment threads: user can reply to the agent, agent responds, repeat
- Explicit "Apply" button on agent replies that shows the response as an inline diff
- Same review UX as Improve/Summarize/Expand (accept/reject via `Cmd+Enter` / `Cmd+Backspace`)
- Agent response still visible in comment thread after apply/reject
- Preserve formatting marks when accepting (uses diff-fidelity infrastructure)
- Work with the existing `useAgentTaskOperations` and `useCommentDelegation` infrastructure

## Non-Goals

- Multi-file agent edits (agent modifying files other than the commented document)
- Agent returning structured file diffs (we parse the text response)
- Automatic acceptance without user review
- Changing the initial delegation prompt or agent behavior
- AI classification of "is this response an edit or an explanation?" — the user decides

## User Stories

- As a user, when an agent responds to my comment, I want to reply with "make it shorter" and get a refined version before applying.
- As a user, I want to click "Apply" on an agent reply to see it as an inline diff on my document, then accept or reject it.
- As a user, when my comment is "explain this paragraph", I want to read the explanation and resolve the comment without any inline diff appearing.
- As a user, I want to see the full conversation thread even after applying or rejecting a suggestion.

## Technical Approach

### Part A: Multi-Turn Comment Threads

Currently comments have one body (user) and zero or more replies (agent). Extend to allow the user to reply back, creating a conversation.

**Comment thread model:**

```
Comment body (user)        — "make this clearer"
  Reply 1 (agent)          — "Here's a clearer version: ..."
  Reply 2 (user)           — "good but keep the technical terms"
  Reply 3 (agent)          — "Here's the revised version: ..."
```

**Changes to** `CommentReply`**:**

```typescript
export interface CommentReply {
  id: string;
  body: string;
  author: string;       // 'user' | agent name (e.g. 'Claude Code')
  timestamp: number;
}
```

The `author` field already distinguishes user vs agent. No schema change needed — just allow user-authored replies.

**New: "Reply" input in CommentPopover (view mode, status** `done`**)**

When a comment has status `done` (agent has responded), show a reply input below the thread:

- Text input with placeholder "Reply to agent..."
- Send button that:
  1. Adds a user reply to the thread via `addReply(documentId, commentId, text, 'user')`
  2. Sets status back to `delegated`
  3. Calls `delegateComment` variant that continues the conversation with the new message

**Changes to delegation flow:**

The current `delegateComment` always starts a fresh prompt with just the anchor text + comment body. For follow-up messages, we need to include the conversation history:

```typescript
// New: delegateReply() — continue an existing thread
async function delegateReply(
  comment: Comment,
  replyText: string,
  documentId: string,
  projectRoot: string
) {
  // Build prompt with full conversation history
  const prompt = [
    'Continuing our conversation about this text:',
    '',
    `> ${comment.anchorText}`,
    '',
    // Include all previous messages
    `Original comment: ${comment.body}`,
    ...(comment.replies ?? []).map(r =>
      `${r.author === 'user' ? 'User' : 'Agent'}: ${r.body}`
    ),
    `User: ${replyText}`,
    '',
    'Please respond to the latest message.',
  ].join('\n');

  // Rest follows the same startTask pattern as delegateComment
}
```

**ACP session reuse:** If the comment's `taskId` maps to a still-alive ACP session, we could continue the same session for true multi-turn. If the session is gone (app restart, different agent), start a new one with conversation history in the prompt. This is an optimization — the conversation-in-prompt approach works as a baseline.

### Part B: Apply-to-Document

**"Apply" button on agent replies:**

Each agent reply in the comment popover gets an "Apply" button (only on agent-authored replies, not user replies). Clicking it:

1. Extracts the replacement text from the reply (with preamble stripping)
2. Resolves the anchor range in the current document
3. Calls `setSuggestion(editor, from, to, anchorText, replacementText)` to show inline diff
4. The existing accept/reject UX takes over (`Cmd+Enter` / `Cmd+Backspace`)

**Preamble stripping:**

```typescript
function extractReplacementText(response: string): string {
  const cleaned = response
    .replace(/^(here'?s?|below is|the following is)[\s\S]*?:\s*/i, '')
    .replace(/^(sure|certainly|of course)[,!.]?\s*/i, '')
    .trim();
  return cleaned;
}
```

**Anchor range resolution:**

```typescript
function resolveAnchorRange(
  editor: Editor,
  comment: Comment
): { from: number; to: number } | null {
  // Strategy 1: Use comment mark decoration positions
  // The CommentMark extension tracks positions that update via PM mapping
  const commentState = CommentMarkPluginKey.getState(editor.state);
  // Find the decoration for this comment's range
  // ...

  // Strategy 2: Text search fallback
  // If decoration is gone, search for anchor text in document
  // ...

  return null; // anchor not found
}
```

**Reuse:** `ai-suggestion.ts`

The existing AI suggestion extension handles:

- Red strikethrough on original text + green insert with new text
- Accept/reject buttons and keyboard shortcuts
- Clearing decorations after accept/reject
- Mapping decorations through document changes

No changes needed — just call `setSuggestion()` from the Apply button click handler.

### Interaction with Comment Lifecycle

| Event | Comment status | Inline suggestion | Comment thread |
| --- | --- | --- | --- |
| Delegation starts | `delegated` | — | Spinner |
| Agent responds | `done` | — | Reply visible, Apply/Reply/Resolve available |
| User clicks Apply | `done` | Decoration appears | Thread still visible |
| User accepts suggestion | `done` → `resolved` (optional) | Cleared, text replaced | Thread preserved |
| User rejects suggestion | `done` | Cleared, text unchanged | Thread preserved, can Apply again or Reply |
| User sends Reply | `delegated` | — | New user message, spinner for agent |
| Agent responds to reply | `done` | — | New reply visible, Apply/Reply/Resolve |
| User clicks Resolve | `resolved` | — | Hidden |

### Edge Cases

| Case | Behavior |
| --- | --- |
| User clicks Apply on an explanatory response | Diff looks wrong — user rejects. No harm done, thread preserved. |
| Anchor text deleted since comment | `resolveAnchorRange()` returns null → toast "Anchor text not found", Apply button disabled |
| Anchor text modified since comment | Diff shows against current text. May look odd but functional. |
| Another suggestion already active | Toast "Another suggestion is active — accept or reject it first" |
| Multiple agent replies in thread | Each has its own Apply button. User picks which to apply. |
| Apply from comment list (no active editor) | Navigate to file first, then apply. Or disable Apply when file isn't open. |
| User replies while agent is still responding | Queue the reply — send after current response completes. |

## UI Changes

### CommentPopover — View Mode (status `done`)

Current:

```
┌──────────────────────────────────┐
│ [avatar] User              2m ago│
│ make this clearer                │
│──────────────────────────────────│
│ [bot] Claude Code          1m ago│
│ Here's a clearer version:        │
│ The system processes...          │
│──────────────────────────────────│
│ [activity log toggle]            │
│                    [🤖] [✓ Done] │
└──────────────────────────────────┘
```

New:

```
┌──────────────────────────────────┐
│ [avatar] User              2m ago│
│ make this clearer                │
│──────────────────────────────────│
│ [bot] Claude Code          1m ago│
│ Here's a clearer version:        │
│ The system processes...          │
│                          [Apply] │
│──────────────────────────────────│
│ [Reply to agent...        ] [⏎]  │
│ [activity log toggle]            │
│                    [🤖] [✓ Done] │
└──────────────────────────────────┘
```

Changes:

- **Apply button** on each agent reply (right-aligned, subtle ghost button)
- **Reply input** below the thread (text input + send button)
- Resolve button remains (renames from "Done" to "Resolve" for clarity)

## Files Modified

- `src/stores/comment-store.ts` — no schema changes needed (replies already support any author)
- `src/hooks/useCommentDelegation.ts` — add `delegateReply()` for multi-turn, remove auto-apply from `onComplete`
- `src/components/editor/CommentPopover.tsx` — Add Apply button on agent replies, add Reply input in view mode
- `src/lib/pm-replace.ts` — add `extractReplacementText()` helper (preamble stripping)
- No changes to `ai-suggestion.ts` (reuse as-is)
- No changes to `inline-diff.ts`
- No backend changes

## Dependencies

- `2026-03-01-diff-fidelity.md` — accepted suggestions preserve formatting marks (done)

## Quality Gates

- [x] `npx tsc --noEmit` passes

- [x] Delegate comment → agent responds → Apply button visible on reply

- [x] Click Apply → inline suggestion appears on anchor text

- [x] Accept suggestion → text replaced, comment can be resolved

- [x] Reject suggestion → text unchanged, can Apply again or Reply

- [x] Reply to agent → agent responds with updated suggestion → Apply new version

- [x] Multi-turn: user sends 3+ messages, agent responds each time

- [x] "Explain this" comment → agent explains → user resolves without Apply

- [x] Anchor text deleted → Apply button disabled or toast error

- [x] Another suggestion active → toast warning, Apply blocked

- [x] Comment reply visible in thread regardless of accept/reject

- [x] Agent response with preamble stripped correctly on Apply

- [x] Works in both light and dark mode