# Diff Fidelity + Agent Auto-Apply — Implementation Tasks

**Status:** ✅ Complete

**PRDs:** `docs/prds/2026-03-01-diff-fidelity.md` + `docs/prds/2026-03-01-agent-auto-apply.md`**Date:** 2026-03-01

## Summary

**9 tasks: 9/9 done — 3S, 4M, 2L**

Implementation order: Foundation first (shared helper), then fix existing code paths, then add auto-apply. Diff fidelity tasks (#1-#5) must complete before auto-apply tasks (#6-#9).

## Feature A: Diff Fidelity — Mark-Preserving Inline Changes

### #1 — Create `replaceRangeWithMarkdown()` shared helper ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | — |
| **Files** | `src/lib/pm-replace.ts` (NEW) |

**Description:**

Create `src/lib/pm-replace.ts` with the core `replaceRangeWithMarkdown(editor, tr, from, to, text)` function.

- Strategy 1: parse replacement text through `editor.storage.markdown.parser` → HTML → `PMDOMParser.fromSchema()` → extract inline nodes
- Strategy 2 (fallback): if no markdown markers detected, copy marks from `doc.resolve(from).marks()` and create a text node with those marks
- Use `tr.replaceWith()` instead of `tr.insertText()`
- Follow the existing `parseMarkdownToDoc()` pattern in `external-diff.ts` (line 141) for parser access
- Skip markdown parsing for content inside code blocks (check parent node type)

**Acceptance:** Function exists, exported, compiles.

---

### #2 — Update `acceptSuggestion()` in ai-suggestion.ts ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/components/editor/extensions/ai-suggestion.ts` |

**Description:**

Replace the current `editor.chain().deleteRange().insertContentAt()` (lines 173-181) with a call to `replaceRangeWithMarkdown()`. Build a transaction manually: call the helper, set `AISuggestionPluginKey` meta to `{ clearSuggestion: true }`, dispatch. Keep `editor.chain().focus()` for focus handling.

**Acceptance:**

- Accepting an AI suggestion on bold text preserves bold
- Accepting a suggestion with `**bold**` markdown renders as bold

---

### #3 — Update `acceptDiffHunk()` in inline-diff.ts ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/components/editor/extensions/inline-diff.ts` |

**Description:**

Replace `tr.insertText(hunk.insertText, hunk.from, hunk.to)` (line \~315) with `replaceRangeWithMarkdown()`. The function already builds its own transaction, so pass the existing `tr`. Handle all three cases:

- Replacement (has both deleteText and insertText) — use the helper
- Pure deletion (no change needed — `tr.delete()` already works)
- Pure insertion — use the helper

**Acceptance:** Accepting an external change hunk on italic text preserves italic.

---

### #4 — Update `acceptAllDiffHunks()` in inline-diff.ts ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #1, #3 |
| **Files** | `src/components/editor/extensions/inline-diff.ts` |

**Description:**

Same fix applied within the bottom-to-top loop (lines \~342-362). Each hunk's replacement goes through `replaceRangeWithMarkdown()` instead of `tr.insertText()`. Position mapping already handled correctly.

**Acceptance:** Accept All preserves marks across all hunks.

---

### #5 — Verify edge cases and code block safety ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #2, #3, #4 |
| **Files** | All modified files |

**Description:**

Test that:

- Pure deletions still work
- Pure insertions still work
- Content inside code blocks is NOT parsed as markdown (literal text preserved)
- Reject suggestion/hunk still works unchanged
- `npx tsc --noEmit` passes

**Acceptance:** All quality gates from the diff-fidelity PRD pass.

---

## Feature B: Agent Auto-Apply — Inline Suggestions from Comment Delegation

### #6 — Add `extractReplacementText()` helper ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/lib/pm-replace.ts` |

**Description:**

Add to `src/lib/pm-replace.ts`: strip common AI preamble patterns from agent response before using as replacement text. Patterns to strip:

- "Here's the improved version:", "Below is", "The following is" + colon
- "Sure,", "Certainly!", "Of course." + comma/period

Use regex replacements as specified in the agent-auto-apply PRD.

**Acceptance:** Function exported, strips preamble from typical AI responses, returns clean text.

---

### #7 — Add `resolveAnchorRange()` helper ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | — |
| **Files** | `src/lib/pm-replace.ts` |

**Description:**

Find the current position of a comment's anchor text in the editor.

- Strategy 1: look up the comment's mark decoration positions from `CommentMarkPluginKey.getState()`. May need to verify the plugin state shape exposes decoration lookup by comment ID.
- Strategy 2 (fallback): text search — walk `editor.state.doc.descendants()` looking for `comment.anchorText`
- Returns `{ from: number; to: number } | null`
- Import `CommentMarkPluginKey` from the extensions barrel

**Acceptance:** Returns correct positions for a comment's anchor text, even if document has been edited since the comment was created.

---

### #8 — Wire auto-apply in `useCommentDelegation.onComplete` ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #5, #6, #7 |
| **Files** | `src/hooks/useCommentDelegation.ts` |

**Description:**

In the `onComplete` callback (currently at lines 60-67 of `useCommentDelegation.ts`), after `addReply()` and `setCommentStatus('done')`:

1. Get the comment object
2. Call `extractReplacementText(output)`
3. Call `resolveAnchorRange(editor, comment)`
4. If range found, call `setSuggestion(editor, from, to, comment.anchorText, replacementText)`

Need access to the editor instance — either pass it to `delegateComment()` or access via a ref/store. Handle the case where editor is null (file not open — skip auto-apply, reply still in thread).

**Acceptance:**

- Delegate comment → agent responds → inline suggestion decoration appears on anchor text
- Accept → text replaced
- Reject → text unchanged
- Reply visible in thread either way
- Anchor text deleted since delegation → no crash, reply still in thread

---

### #9 — Handle suggestion queueing for multiple delegations ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #8 |
| **Files** | `src/hooks/useCommentDelegation.ts`, `src/components/editor/extensions/ai-suggestion.ts` |

**Description:**

The current `ai-suggestion.ts` supports one suggestion at a time. When multiple comment delegations complete around the same time, queue pending suggestions and show the next one when the current is accepted/rejected.

- Add `onAccept`/`onReject` callbacks to the `AISuggestion` extension options to trigger `showNextSuggestion()`
- Store the queue in the delegation hook or a small module-level array
- When a suggestion is accepted or rejected, automatically show the next queued suggestion

**Acceptance:**

- Two comments delegated simultaneously → first suggestion shows → accept/reject → second suggestion shows automatically
- No crashes or lost suggestions

---

## Risks & Notes

- **Editor access in** `onComplete`: `useCommentDelegation` doesn't currently have access to the editor instance. Need to either accept it as a parameter to `delegateComment()`, or use a ref pattern. Check how the comment delegation callers access the editor.
- **Comment mark decoration positions**: Strategy 1 for `resolveAnchorRange()` depends on `CommentMarkPluginKey` exposing decoration positions. May need a minor enhancement to expose a lookup-by-comment-id method.
- `parseMarkdownToDoc` **reuse**: `external-diff.ts` has a private `parseMarkdownToDoc()` that does exactly what `replaceRangeWithMarkdown()` needs. Consider extracting it to `pm-replace.ts` to avoid duplication.
- **Suggestion queueing interaction**: If a BubbleMenu AI action fires while a queued delegation suggestion is pending, decide priority. Recommended: BubbleMenu takes priority (user-initiated), delegation suggestions re-queue.