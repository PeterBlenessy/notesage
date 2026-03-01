# Agent Comment Delegation Part 3 — Auto-Apply Agent Edits

**Date:** 2026-03-01 **Status:** Planning **Parent:** Phase 6.5 **Depends on:** `2026-03-01-diff-fidelity.md`

## Problem

When an agent responds to a delegated comment, its response appears as text in the comment thread. If the response is a rewrite or improvement of the anchor text, the user must manually copy the suggestion and paste it into the document. This defeats the purpose of delegation — the agent did the work, but the user still has to do the mechanical part.

## How It Should Work

Agent auto-apply should work like the existing Improve/Summarize/Expand flow in the BubbleMenu:

1. User delegates a comment on selected text ("make this clearer")
2. Agent processes the request and returns a response
3. The response is shown as an **inline diff decoration** over the anchor text (red strikethrough + green insert)
4. User reviews and accepts or rejects with `Cmd+Enter` / `Cmd+Backspace`

The only difference from BubbleMenu AI actions: the trigger is a comment delegation instead of a bubble menu click, and the prompt includes the comment body.

## Goals

- Auto-apply agent suggestions as inline diff decorations on the comment's anchor text
- Same review UX as Improve/Summarize/Expand (accept/reject via keyboard or inline buttons)
- Agent response still visible in comment thread as a reply (dual display)
- Preserve formatting marks when accepting (depends on diff-fidelity PRD)
- Work with the existing `useAgentTaskOperations` infrastructure

## Non-Goals

- Multi-file agent edits (agent modifying files other than the commented document)
- Agent returning structured file diffs (we parse the text response, not tool call outputs)
- Automatic acceptance without user review
- Changing how the agent processes the request (prompt stays the same)

## User Stories

- As a user, when I delegate a comment and the agent suggests rewritten text, I want to see the suggestion overlaid on my document so I can accept it with one keystroke.
- As a user, I want to still see the full agent response in the comment thread, even after accepting or rejecting the inline suggestion.
- As a user, I want to reject an agent's suggestion without losing the response — I can read it in the comment thread and apply parts manually.

## Technical Approach

### Detection: Is the Agent Response an Edit?

Not every agent response is a text replacement. The agent might ask a clarifying question, explain something, or suggest structural changes. We need a heuristic to detect "this looks like a replacement for the anchor text."

**Approach — always offer auto-apply:**

Since the user delegated a comment on a specific text range, the response is almost always relevant to that range. Show the inline diff decoration for every delegation response. If the response is a question or explanation (not a replacement), the diff will look obviously wrong and the user will reject it. This is simpler than building a classifier.

**Refinement — strip preamble:**

Agent responses often start with "Here's the improved version:" or similar preamble. Strip common preamble patterns before applying:

```typescript
function extractReplacementText(response: string): string {
  // Strip common AI preamble patterns
  const cleaned = response
    .replace(/^(here'?s?|below is|the following is)[\s\S]*?:\s*/i, '')
    .replace(/^(sure|certainly|of course)[,!.]?\s*/i, '')
    .trim();
  return cleaned;
}
```

### Flow

```
1. User delegates comment (existing flow)
     ↓
2. Agent processes, streams response (existing flow)
     ↓
3. onComplete(output) fires in useCommentDelegation
     ↓
4. NEW: addReply() stores response in comment thread (existing)
        + call setSuggestion() to show inline diff on anchor range
     ↓
5. Inline diff decoration appears over anchor text
   (red strikethrough on original, green insert with agent's text)
     ↓
6. User accepts (Cmd+Enter) or rejects (Cmd+Backspace)
     ↓
7. If accepted: anchor text replaced with agent's suggestion
   If rejected: decoration removed, original text preserved
     ↓
8. Either way: comment reply remains visible in thread
```

### Implementation

**Modified:** `useCommentDelegation.ts` **—** `onComplete` **callback**

Currently `onComplete` just adds a reply and sets status to `done`. Add a call to show the inline suggestion:

```typescript
onComplete: (output: string) => {
  // Existing: add reply to comment thread
  addReply(documentId, commentId, {
    author: 'AI Agent',
    content: output,
    createdAt: Date.now(),
  });
  setCommentStatus(documentId, commentId, 'done');

  // NEW: show inline suggestion on the anchor range
  const comment = getComment(documentId, commentId);
  if (comment && editor) {
    const replacementText = extractReplacementText(output);
    const { from, to } = resolveAnchorRange(editor, comment);
    if (from !== null && to !== null) {
      setSuggestion(editor, from, to, comment.anchorText, replacementText);
    }
  }
},
```

**New:** `resolveAnchorRange()` **— find the comment's anchor in the current document**

The comment stores `anchorText` and the original position range. But the document may have changed since the comment was created (user typed, other edits). We need to find the current position of the anchor text:

```typescript
function resolveAnchorRange(
  editor: Editor,
  comment: Comment
): { from: number | null; to: number | null } {
  // Strategy 1: Use the comment mark decoration positions
  // The CommentMark extension tracks decoration positions that update
  // as the document changes via ProseMirror mapping.
  const commentState = CommentMarkPluginKey.getState(editor.state);
  const decoration = commentState?.decorations.find(
    /* find decoration for this comment ID */
  );
  if (decoration) {
    return { from: decoration.from, to: decoration.to };
  }

  // Strategy 2: Text search fallback
  // If decoration is gone, search for the anchor text in the document
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.text?.includes(comment.anchorText)) {
      const idx = node.text.indexOf(comment.anchorText);
      found = { from: pos + idx, to: pos + idx + comment.anchorText.length };
      return false;
    }
    return true;
  });

  return found ?? { from: null, to: null };
}
```

**Reuse:** `ai-suggestion.ts` **— existing decoration infrastructure**

The AI suggestion extension already handles:

- Showing red strikethrough on original text
- Showing green insert with new text
- Accept/reject buttons and keyboard shortcuts
- Clearing decorations after accept/reject
- Mapping decorations through document changes

No changes needed to this extension. We just call `setSuggestion()` from the delegation flow.

### Interaction with Comment Lifecycle

| Event | Comment status | Inline suggestion | Comment thread |
| --- | --- | --- | --- |
| Delegation starts | `delegated` | — | Spinner |
| Agent responds | `done` | Decoration appears | Reply visible |
| User accepts suggestion | `done` (or `resolved`) | Decoration cleared, text replaced | Reply still visible |
| User rejects suggestion | `done` | Decoration cleared, text unchanged | Reply still visible |
| User resolves comment | `resolved` | — | Hidden |

**Auto-resolve on accept?** Optional. Could auto-set status to `resolved` when the user accepts the suggestion, since the comment has been addressed. But the user might want to keep the comment open for follow-up. Default: don't auto-resolve.

### Edge Cases

| Case | Behavior |
| --- | --- |
| Agent response is a question, not a replacement | Diff looks wrong — user rejects. Reply still in thread for user to read. |
| Anchor text has been deleted since delegation | `resolveAnchorRange()` returns null — skip auto-apply, reply still visible in thread |
| Anchor text has been modified since delegation | Decoration shows diff against current text, not original. May look odd but is functional. |
| Another suggestion is already active | Queue or skip. Current `ai-suggestion.ts` supports one suggestion at a time. |
| Comment delegated from comment list (no active editor) | Skip auto-apply. Reply still visible. Apply when user opens the file. |
| Multiple comments delegated simultaneously | Each completion triggers a suggestion. Since only one can be active, queue them. |

### Queueing Multiple Suggestions

The current `ai-suggestion.ts` supports one suggestion at a time. For the case where multiple comments complete around the same time, add a simple queue:

```typescript
// In useCommentDelegation or a new useSuggestionQueue hook
const pendingSuggestions: Array<{from, to, original, suggested}> = [];

function showNextSuggestion(editor: Editor) {
  if (hasActiveSuggestion(editor)) return;
  const next = pendingSuggestions.shift();
  if (next) {
    setSuggestion(editor, next.from, next.to, next.original, next.suggested);
  }
}

// Call showNextSuggestion when a suggestion is accepted or rejected
```

## Files Modified

- `src/hooks/useCommentDelegation.ts` — add auto-apply logic in `onComplete`
- `src/lib/pm-replace.ts` — `extractReplacementText()` helper (preamble stripping)
- No changes to `ai-suggestion.ts` (reuse as-is)
- No changes to `inline-diff.ts`
- No backend changes

## Dependencies

- `2026-03-01-diff-fidelity.md` should be implemented first so accepted suggestions preserve formatting marks. Without it, auto-apply works but loses marks (same as current Improve/Summarize/Expand behavior).

## Quality Gates

- [ ] `npx tsc --noEmit` passes

- [ ] Delegate comment → agent responds → inline suggestion appears on anchor text

- [ ] Accept suggestion → anchor text replaced with agent's response

- [ ] Reject suggestion → anchor text unchanged

- [ ] Comment reply visible in thread regardless of accept/reject

- [ ] Agent response with preamble ("Here's the improved version:") → preamble stripped

- [ ] Anchor text moved since delegation → suggestion still appears at correct position

- [ ] Anchor text deleted since delegation → no crash, reply still in thread

- [ ] Multiple delegations → suggestions queue and show one at a time

- [ ] Works in both light and dark mode