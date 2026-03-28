# Bug: Document Outline navigation shows blank document

|  |  |
| --- | --- |
| **Date observed** | 2026-03-28 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Selecting a heading in Document Outline jumps to the position but renders a blank document; manual scroll required to restore visibility |
| **Versions affected** | v0.23.2 (current) |
| **Reproducibility** | Intermittent |

## Symptoms

1. Open Document Outline via Cmd+Shift+O
2. Select a heading from the list
3. Editor jumps to the heading position but the document content area appears blank/empty
4. Manually scrolling up or down by any amount makes the text visible again

## Root Cause

The scroll logic in `DocumentOutline.tsx` (lines 38-50) uses a fragile manual coordinate calculation that diverges from the proven scroll patterns used elsewhere in the codebase.

### Problem 1: Manual coordinate math instead of native scrollIntoView

```typescript
const coords = editor.view.coordsAtPos(pos + 1);
const editorRect = editorEl.getBoundingClientRect();
const scrollOffset = coords.top - editorRect.top - 80;
editorEl.scrollBy({ top: scrollOffset, behavior: "smooth" });
```

The `-80` magic number assumes a fixed toolbar height. This breaks when toolbar visibility changes, focus mode is toggled, or font size affects layout. The browser's native `scrollIntoView()` handles all container nesting automatically.

### Problem 2: Single RAF timing vs dialog close re-render

```typescript
editor.commands.setTextSelection(pos + 1);
onOpenChange(false);                         // closes dialog, triggers React re-render
requestAnimationFrame(() => {
  editor.commands.focus();
  const coords = editor.view.coordsAtPos(pos + 1);  // may get stale coordinates
  // ...
});
```

The dialog close triggers a React re-render. A single `requestAnimationFrame` may fire before layout has settled, causing `coordsAtPos()` to return invalid coordinates. The codebase uses double-RAF elsewhere (e.g., `useScrollPersistence.ts:59-72`) for cross-component scroll operations.

### Problem 3: Scroll container detection fallback

```typescript
const editorEl = editor.view.dom.closest(".overflow-y-auto") ?? editor.view.dom.parentElement;
```

If `.closest(".overflow-y-auto")` fails, the fallback `parentElement` is the centering wrapper (`min-h-full flex justify-center`), not the actual scrollable container. Scrolling on a non-scrollable element has no effect.

## Working patterns in the codebase

Comment navigation (`Editor.tsx:533-537`):
```typescript
const dom = editor.view.domAtPos(comment.from);
const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
```

Tag/text navigation (`editor-utils.ts:120-153`):
- Uses `domAtPos()` to get the DOM element
- Calls `scrollIntoView()` on the element
- Sets `isProgrammaticScroll` guard before scroll

## Suggested Fix

Refactor `DocumentOutline.tsx` scroll logic to use the proven `scrollPosToCenter()` pattern from `editor-utils.ts`: get the DOM node via `domAtPos()`, call native `scrollIntoView({ block: 'center' })`, and use double-RAF for timing safety.

## Key Files

| File | Lines | Role |
| --- | --- | --- |
| `src/components/DocumentOutline.tsx` | 34-51 | Broken scroll logic |
| `src/components/editor/editor-utils.ts` | 120-153 | Working scroll pattern |
| `src/components/editor/Editor.tsx` | 533-537 | Working comment scroll |
| `src/hooks/useScrollPersistence.ts` | 59-72 | Double-RAF scroll restoration |
