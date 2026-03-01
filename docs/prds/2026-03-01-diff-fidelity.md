# Diff Fidelity — Mark-Preserving Inline Changes

**Date:** 2026-03-01 **Status:** Planning **Parent:** Phase 6.5

## Problem

When accepting an inline change — whether from an external file change, an AI suggestion (Improve/Summarize/Expand), or a future agent auto-apply — all formatting marks (bold, italic, code, links, etc.) are stripped from the affected range. The current code uses `tr.insertText()` which replaces the range with a plain text string, discarding any ProseMirror marks.

**Example:**

```
Original:  The **quick** brown fox
AI says:   The fast brown fox
Accepted:  The fast brown fox        ← bold lost
```

This affects three code paths that all share the same flaw:

| Code path | File | Accept function |
|-----------|------|----------------|
| External change review | `inline-diff.ts` | `acceptDiffHunk()` — `tr.insertText(hunk.insertText, from, to)` |
| AI suggestion (Improve/Summarize/Expand) | `ai-suggestion.ts` | `acceptSuggestion()` — `.deleteRange().insertContentAt()` |
| Future: agent auto-apply | Will use one of the above | Same issue |

## Goals

- When accepting a diff hunk or AI suggestion, preserve inline formatting marks that existed in the original range
- Parse inserted text through the markdown parser so AI responses with `**bold**` or `*italic*` render correctly
- Fix all three code paths with a shared solution
- No visual or behavioral changes to the diff/suggestion decorations themselves

## Non-Goals

- Changing how diffs are computed (the text-level diffing works fine)
- Changing how decorations are rendered (red/green display is fine)
- Handling structural node changes (e.g., turning a paragraph into a heading) — this is a separate, much harder problem
- Making the diff computation itself mark-aware (would require a PM-level differ, which is overkill)

## Technical Approach

### The Core Fix: Parse-and-Replace Instead of insertText

Instead of inserting plain text, parse the replacement text through the editor's markdown parser to produce a ProseMirror `Slice`, then use `tr.replaceRange()` or `tr.replace()` which preserves document structure.

**Current (broken):**
```typescript
// inline-diff.ts — acceptDiffHunk()
tr.insertText(hunk.insertText, hunk.from, hunk.to);

// ai-suggestion.ts — acceptSuggestion()
editor.chain()
  .deleteRange({ from, to })
  .insertContentAt(from, suggestedText)
  .run();
```

**Fixed:**
```typescript
// Shared helper
function replaceRangeWithMarkdown(
  editor: Editor,
  from: number,
  to: number,
  text: string
): void {
  const tr = editor.state.tr;

  // Try parsing as markdown first (handles **bold**, *italic*, etc.)
  const parsed = parseInlineMarkdown(editor, text);
  if (parsed) {
    tr.replaceWith(from, to, parsed);
  } else {
    // Fallback: insert as plain text but copy marks from the original range
    const marksAtFrom = editor.state.doc.resolve(from).marks();
    const textNode = editor.state.schema.text(text, marksAtFrom);
    tr.replaceWith(from, to, textNode);
  }
}
```

### Strategy 1: Parse Inline Markdown (Primary)

AI responses often contain markdown formatting (`**bold**`, `*italic*`, `` `code` ``). Parse the replacement text through the editor's markdown parser to produce properly marked ProseMirror content:

```typescript
function parseInlineMarkdown(editor: Editor, text: string): PMNode[] | null {
  // Use tiptap-markdown's parser to convert markdown → HTML → PM nodes
  const parser = editor.storage.markdown?.parser;
  if (!parser) return null;

  const html = parser.parse(text);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const doc = PMDOMParser.fromSchema(editor.schema).parse(wrapper);

  // Extract inline content from the parsed document
  // (the parser wraps in a doc > paragraph, we want just the inline nodes)
  const content: PMNode[] = [];
  doc.descendants((node) => {
    if (node.isText) {
      content.push(node);
      return false;
    }
    if (node.isInline) {
      content.push(node);
      return false;
    }
    return true;
  });

  return content.length > 0 ? content : null;
}
```

### Strategy 2: Copy Marks from Original Range (Fallback)

When the replacement text is plain (no markdown formatting), copy the marks from the start of the original range so the new text inherits the surrounding formatting:

```typescript
function replaceWithInheritedMarks(
  tr: Transaction,
  from: number,
  to: number,
  text: string,
  doc: PMNode
): void {
  // Get marks at the start of the replaced range
  const $from = doc.resolve(from);
  const marks = $from.marks();

  // Create a text node with those marks
  const textNode = $from.parent.type.schema.text(text, marks);
  tr.replaceWith(from, to, textNode);
}
```

This handles the common case where a word inside a bold span is replaced with another word — the replacement inherits the bold mark.

### Where to Apply the Fix

**1. `inline-diff.ts` — `acceptDiffHunk()`**

Replace:
```typescript
tr.insertText(hunk.insertText, hunk.from, hunk.to);
```

With a call to the shared `replaceRangeWithMarkdown()` helper.

**2. `ai-suggestion.ts` — `acceptSuggestion()`**

Replace:
```typescript
editor.chain()
  .deleteRange({ from, to })
  .insertContentAt(from, suggestedText)
  .run();
```

With:
```typescript
const tr = editor.state.tr;
replaceRangeWithMarkdown(editor, from, to, suggestedText);
tr.setMeta(AISuggestionPluginKey, { clearSuggestion: true });
editor.view.dispatch(tr);
```

**3. `inline-diff.ts` — `acceptAllDiffHunks()`**

Same pattern — replace each `tr.insertText()` with the mark-preserving variant within the bottom-to-top loop.

### Shared Helper Location

Create a new utility at `src/lib/pm-replace.ts`:

```typescript
export function replaceRangeWithMarkdown(
  editor: Editor,
  tr: Transaction,
  from: number,
  to: number,
  text: string
): void
```

Both `inline-diff.ts` and `ai-suggestion.ts` import from this shared module.

## Edge Cases

| Case | Behavior |
|------|----------|
| Replacement text has markdown (`**bold**`) | Parse through markdown parser, produce marked nodes |
| Replacement text is plain | Copy marks from start of original range |
| Replacement spans multiple mark boundaries (`**bold** and *italic*`) | Parser handles this naturally |
| Pure deletion (no insertText) | No change needed — `tr.delete()` already works |
| Pure insertion (no deleteText) | Parse insertText; if no marks context, insert unmarked |
| Replacement crosses node boundaries (paragraph → paragraph) | Use `tr.replace()` with a proper Slice |
| Code block content | Don't apply markdown parsing — code blocks should be literal text |

## Files Modified

- `src/lib/pm-replace.ts` — NEW: shared mark-preserving replace helper
- `src/components/editor/extensions/inline-diff.ts` — update `acceptDiffHunk()` and `acceptAllDiffHunks()`
- `src/components/editor/extensions/ai-suggestion.ts` — update `acceptSuggestion()`

## Quality Gates

- [ ] `npx tsc --noEmit` passes
- [ ] Accept AI suggestion on bold text: bold preserved in result
- [ ] Accept AI suggestion with `**bold**` in response: renders as bold
- [ ] Accept external change hunk on italic text: italic preserved
- [ ] Accept all hunks: marks preserved across all hunks
- [ ] Pure deletion still works
- [ ] Pure insertion still works
- [ ] Code block content not parsed as markdown (literal text)
- [ ] Reject suggestion/hunk still works (no change)
- [ ] Round-trip: accept change → save → reopen → content correct
