# Agent Auto-Apply — Implementation Tasks

**PRD:** `docs/prds/2026-03-01-agent-auto-apply.md`
**Dependency:** `docs/prds/2026-03-01-diff-fidelity.md` (done)
**Date:** 2026-03-01

## Summary

**9 tasks: 3S, 4M, 2L**

All tasks are frontend-only. No backend (Rust/Tauri) changes needed.

Two main work streams:
- **Part A (Multi-turn threads):** Allow user to reply to agent in the comment thread, creating a back-and-forth conversation before applying.
- **Part B (Apply-to-document):** Explicit "Apply" button on agent replies that shows inline diff via existing `ai-suggestion.ts` infrastructure.

**Suggested implementation order:** #1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9

**Risks:**
- ACP session reuse: continuing an existing agent session for follow-up replies is ideal but may not work if the session was cleaned up. Fallback: start new session with conversation history in the prompt.
- Editor access for Apply: the Apply button is in the CommentPopover which may not have direct editor access. The `CommentMarkPluginKey` dispatches are already used for comment creation — same pattern can pass apply intent.
- Suggestion queueing: `ai-suggestion.ts` supports one suggestion at a time. Multiple Apply clicks need a queue or a "one at a time" guard.

---

## Tasks

### #1 — Add Reply input to CommentPopover

| Field | Value |
|-------|-------|
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | — |
| **Files** | `src/components/editor/CommentPopover.tsx` |

**Description:**

When a comment has status `done` (agent has responded), show a reply input below the thread.

- Add a text input with placeholder "Reply to agent..." and a send button
- Input appears below the last reply, above the activity log toggle
- Send button triggers a new reply flow (wired in task #3)
- Input should be compact: single-line text input with an arrow/send icon button
- Pressing Enter in the input also sends (Shift+Enter for newline if needed)
- Input is hidden when status is `delegated` (agent is still responding)
- Input is hidden when status is `open` or `resolved`

**Acceptance:** CommentPopover shows reply input when status is `done`. Typing and pressing Enter/send button works (action wired in #3). Compiles.

---

### #2 — Add `extractReplacementText()` helper

| Field | Value |
|-------|-------|
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | — |
| **Files** | `src/lib/pm-replace.ts` |

**Description:**

Strip common AI preamble patterns from agent response text before using as replacement. Add to `src/lib/pm-replace.ts`:

```typescript
export function extractReplacementText(response: string): string {
  const cleaned = response
    .replace(/^(here'?s?|below is|the following is)[\s\S]*?:\s*/i, '')
    .replace(/^(sure|certainly|of course)[,!.]?\s*/i, '')
    .trim();
  // Strip trailing sign-off patterns
  return cleaned
    .replace(/\n\n(let me know|feel free|hope this|i hope|would you like)[\s\S]*$/i, '')
    .trim();
}
```

**Acceptance:** `extractReplacementText("Here's the improved version:\n\nThe quick brown fox")` returns `"The quick brown fox"`. Plain text without preamble passes through unchanged. Trailing "Let me know if you'd like changes." is stripped.

---

### #3 — Add `delegateReply()` to `useCommentDelegation`

| Field | Value |
|-------|-------|
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/hooks/useCommentDelegation.ts`, `src/components/editor/CommentPopover.tsx` |

**Description:**

New function that continues the conversation in a comment thread. Unlike `delegateComment()` which starts fresh, this includes the full conversation history in the prompt.

```typescript
const delegateReply = useCallback(
  async (
    comment: Comment,
    replyText: string,
    documentId: string,
    projectRoot: string
  ) => {
    // 1. Add user reply to the thread
    const store = useCommentStore.getState();
    store.addReply(documentId, comment.id, replyText, 'user');

    // 2. Set status back to delegated
    store.setCommentStatus(documentId, comment.id, 'delegated');

    // 3. Build prompt with conversation history
    const prompt = [
      'Continuing our conversation about this text:',
      '',
      `> ${comment.anchorText}`,
      '',
      `Original comment: ${comment.body}`,
      ...(comment.replies ?? []).map(r =>
        `${r.author === 'user' ? 'User' : 'Agent'}: ${r.body}`
      ),
      `User: ${replyText}`,
      '',
      'Please respond to the latest message.',
    ].join('\n');

    // 4. Start task with same callbacks as delegateComment
    //    (onComplete adds reply, sets status to done, etc.)
  },
  [startTask, taskConnection]
);
```

Wire the reply input from #1 to call `delegateReply()` on send.

**Acceptance:**
- User types reply in CommentPopover → user reply appears in thread → status becomes `delegated` → agent responds → new agent reply appears
- Conversation history is included in the prompt so agent has context
- Multi-turn: 3+ exchanges work correctly
- Compiles

---

### #4 — Add `resolveAnchorRange()` helper

| Field | Value |
|-------|-------|
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | — |
| **Files** | `src/lib/pm-replace.ts` |

**Description:**

Find the current document position of a comment's anchor text. Two strategies:

**Strategy 1 — CommentMark decoration positions (primary):**
- Import `CommentMarkPluginKey` from `@/components/editor/extensions/comment-mark`
- Call `CommentMarkPluginKey.getState(editor.state)` to get the comment mark state
- Search the comments array for the matching `commentId` — returns `{ from, to }`
- Positions are accurate even after edits because they're remapped through ProseMirror's mapping

**Strategy 2 — Text search fallback:**
- If no decoration found, walk `editor.state.doc.descendants()` looking for `comment.anchorText` in text nodes
- Return `{ from, to }` of the first match

```typescript
export function resolveAnchorRange(
  editor: Editor,
  comment: { id: string; anchorText: string }
): { from: number; to: number } | null
```

Return `null` if anchor text cannot be found.

**Acceptance:**
- Returns correct positions for a comment whose anchor text hasn't moved
- Returns correct positions after the document has been edited (positions remapped)
- Returns `null` when anchor text has been deleted
- Falls back to text search when decoration is not found

---

### #5 — Add Apply button to agent replies in CommentPopover

| Field | Value |
|-------|-------|
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #2, #4 |
| **Files** | `src/components/editor/CommentPopover.tsx` |

**Description:**

Each agent-authored reply in the comment popover gets an "Apply" button. Only visible on agent replies (not user replies). The button:

1. Calls `extractReplacementText(reply.body)` to strip preamble
2. Calls `resolveAnchorRange(editor, comment)` to find current anchor position
3. If range found and no active suggestion: calls `setSuggestion(editor, from, to, anchorText, replacementText)`
4. If range not found: toast "Anchor text not found in document"
5. If another suggestion is active: toast "Accept or reject the current suggestion first"

**UI:**
- Small ghost button aligned right below each agent reply: `[Apply]`
- Use `FileOutput` or `Replace` icon from lucide-react
- Disabled when status is `delegated` (agent still responding)
- Hidden on user-authored replies

**Editor access:** The CommentPopover is rendered inside the editor component tree. Access the editor via the existing pattern used for comment creation (dispatch meta via `CommentMarkPluginKey`), or pass editor as prop/context.

Import `setSuggestion`, `hasActiveSuggestion` from `@/components/editor/extensions/ai-suggestion` and `extractReplacementText`, `resolveAnchorRange` from `@/lib/pm-replace`.

**Acceptance:**
- Agent reply shows Apply button
- Click Apply → inline diff decoration appears on anchor text
- Accept (Cmd+Enter) → text replaced
- Reject (Cmd+Backspace) → text unchanged, can click Apply again
- Anchor deleted → toast error, no crash
- Another suggestion active → toast warning

---

### #6 — Handle suggestion collision guard

| Field | Value |
|-------|-------|
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #5 |
| **Files** | `src/components/editor/CommentPopover.tsx` |

**Description:**

Before calling `setSuggestion()` in the Apply button handler, check `hasActiveSuggestion(editor)`. If active, show toast: "Accept or reject the current suggestion first."

This is the minimal approach — no queueing. The user must handle one suggestion at a time. This is simpler than auto-queueing and gives the user full control.

**Acceptance:** If an AI suggestion (from BubbleMenu or another Apply) is active when Apply is clicked, a toast appears and no new suggestion is created.

---

### #7 — Add suggestion queue for Delegate All

| Field | Value |
|-------|-------|
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #5, #6 |
| **Files** | `src/hooks/useCommentDelegation.ts`, `src/components/editor/extensions/ai-suggestion.ts` |

**Description:**

When "Delegate All" is used and multiple agents respond, the user gets multiple replies with Apply buttons. They can apply them one at a time manually (clicking Apply on each after accepting/rejecting the previous). No automatic queueing needed — the collision guard from #6 ensures only one suggestion at a time.

However, if we want a smoother UX for bulk operations, add optional queue support:

**Module-level queue:**
```typescript
const suggestionQueue: PendingSuggestion[] = [];

export function enqueueOrShowSuggestion(editor, from, to, original, suggested) {
  if (hasActiveSuggestion(editor)) {
    suggestionQueue.push({ from, to, original, suggested });
    toast.info(`Queued suggestion (${suggestionQueue.length} pending)`);
  } else {
    setSuggestion(editor, from, to, original, suggested);
  }
}
```

**Wire into accept/reject:** Watch for `clearSuggestion` meta on transactions to auto-show next queued suggestion.

**Note:** This task is optional/deferred. The manual Apply-one-at-a-time flow from #5/#6 is a complete UX. Queue is an enhancement for power users doing bulk delegation.

**Acceptance:**
- Without queue: multiple Apply buttons work one at a time with collision guard
- With queue (if implemented): accept → next queued suggestion auto-shows

---

### #8 — Update comment lifecycle UI

| Field | Value |
|-------|-------|
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #5 |
| **Files** | `src/components/editor/CommentPopover.tsx` |

**Description:**

Update the action buttons at the bottom of the CommentPopover for the new flow:

- When status `done`: show **Reply** input (#1), **Resolve** button (replaces "Done"), delegate button (re-delegate from scratch)
- Rename "Done" to "Resolve" for clarity
- After accepting an inline suggestion: optionally auto-set status to `resolved` (configurable — default: don't auto-resolve, let user decide)

**Acceptance:** Button labels updated. Resolve works. Comment lifecycle states transition correctly through multi-turn + apply flows.

---

### #9 — Verify quality gates and edge cases

| Field | Value |
|-------|-------|
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #8 |
| **Files** | All modified files |

**Description:**

Verify all quality gates from the PRD:

- [ ] `npx tsc --noEmit` passes
- [ ] Delegate comment → agent responds → Apply button visible on reply
- [ ] Click Apply → inline suggestion appears on anchor text
- [ ] Accept suggestion → text replaced, comment can be resolved
- [ ] Reject suggestion → text unchanged, can Apply again or Reply
- [ ] Reply to agent → agent responds with updated suggestion → Apply new version
- [ ] Multi-turn: user sends 3+ messages, agent responds each time
- [ ] "Explain this" comment → agent explains → user resolves without Apply
- [ ] Anchor text deleted → Apply button disabled or toast error
- [ ] Another suggestion active → toast warning, Apply blocked
- [ ] Comment reply visible in thread regardless of accept/reject
- [ ] Agent response with preamble stripped correctly on Apply
- [ ] Works in both light and dark mode
- [ ] BubbleMenu AI actions (Improve/Summarize/Expand) still work correctly
- [ ] External change diff review still works correctly

Fix any issues found.

**Acceptance:** All quality gates pass. No regressions.

---

## Dependency Graph

```
#1 (reply input UI) ──▶ #3 (delegateReply) ──┐
#2 (preamble strip) ──┐                       │
                       ├──▶ #5 (Apply button) ──▶ #6 (collision) ──▶ #7 (queue, optional) ──┐
#4 (resolve anchor) ──┘                       │                                              ├──▶ #9 (verify)
                                              └──▶ #8 (lifecycle UI) ───────────────────────┘
```

Tasks #1, #2, #4 can be done in parallel (no dependencies between them).
Task #7 is optional — the flow works without it via manual one-at-a-time Apply.
