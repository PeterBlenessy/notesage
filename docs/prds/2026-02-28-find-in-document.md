# PRD: Find in Document

**Date:** 2026-02-28 **Status:** Draft **Parent:** Editor

## Problem

There is no way to search for text within the currently open document. Cmd+F does nothing — the keyboard shortcut documented as "Native browser find" is not wired up, and Tauri's webview doesn't expose browser find by default. For a text editor, in-document search is a fundamental expectation. Users working with long notes, PDFs, EPUBs, or Word documents have no way to locate specific content without manually scrolling.

## Goals

1. Cmd+F opens a find bar scoped to the active document
2. Search results are highlighted with a distinct "current match" indicator
3. Next/previous navigation (Enter / Shift+Enter or arrow buttons)
4. Match count displayed (e.g., "3 of 12")
5. Works across all searchable document types: markdown (WYSIWYG + source), PDF, EPUB, DOCX, and plain text
6. Escape closes the find bar and clears highlights
7. Optional replace functionality for editable documents (markdown, plain text)

## Non-Goals

- Cross-file search (searching across multiple documents)
- Regex search (plain text matching only for v1)
- Case-sensitive toggle (default case-insensitive, toggle can be added later)
- Search history or persistence across tab switches

## User Stories

- As a user editing a long markdown note, I want to press Cmd+F and type a word to find all occurrences highlighted in the document, so I can quickly navigate to the section I need.
- As a user reading a PDF or EPUB, I want to search for a term and jump between matches, so I can find relevant passages without scrolling through the entire document.
- As a user editing markdown, I want to replace a found term with new text (one at a time or all at once), so I can make bulk corrections efficiently.

## Technical Approach

Each document type uses a different rendering engine, so find must be implemented per-viewer with a shared UI bar.

### Shared Find Bar Component

A `FindBar` React component rendered inside `Editor.tsx`, positioned at the top of the editor area (below the tab bar). Appears on Cmd+F, contains:

- Search input (auto-focused)
- Match count label ("3 of 12")
- Previous / Next buttons (chevron icons)
- Close button (X icon)
- Replace input + Replace / Replace All buttons (only for editable documents, toggled via a chevron expand)

The FindBar is a presentational component. It calls callbacks for search, navigate, replace, and close. Each viewer type provides its own implementation of these callbacks.

### Per-Viewer Search Implementations

#### 1. Markdown WYSIWYG (Tiptap/ProseMirror)

Use ProseMirror's `@tiptap/extension-search-and-replace` or build a custom ProseMirror plugin with `Decoration.inline` for match highlighting (following the existing pattern from `tag-highlight.ts` and `inline-diff.ts`).

- Walk all text nodes, collect match positions
- Create decorations: `find-match` class for all matches, `find-match-active` for the current match
- Navigate by cycling through match positions and scrolling via `editor.view.domAtPos(pos)` + `scrollIntoView`
- Replace: use `editor.chain().setTextSelection({ from, to }).insertContent(replacement).run()`

#### 2. Markdown Source Mode (CodeMirror 6)

CodeMirror 6 has a built-in `@codemirror/search` extension:

- `openSearchPanel()` / `closeSearchPanel()` opens CM's native search
- Alternatively, use `SearchQuery` and `searchNext` / `searchPrevious` programmatically with our custom FindBar UI
- Replace is natively supported

#### 3. PDF (pdfjs-dist)

pdfjs has a built-in `PDFFindController`:

- Call `pdfFindController.executeCommand('find', { query, highlightAll: true })`
- Listen for `updatefindmatchescount` and `updatefindcontrolstate` events for match count and navigation
- Matches are highlighted in the PDF rendering layer automatically

#### 4. EPUB (foliate-js)

The `<foliate-view>` Web Component exposes search via its renderer:

- `view.search(query)` or iterate sections and search within them
- May need to use the underlying `book.sections` to search text content and navigate via CFI
- Highlight matches using the overlayer API

#### 5. DOCX (mammoth HTML)

DOCX is rendered as an HTML div via mammoth. Use the browser's `window.find()` API or a DOM-based text search:

- Walk text nodes in the `.docx-content` container
- Wrap matches in `<mark>` elements
- Navigate by scrolling to each mark

#### 6. Plain Text / Other (CodeMirror 6)

Same approach as Markdown Source Mode — CodeMirror's `@codemirror/search`.

### Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Open find | Cmd+F |
| Find next | Enter (in find input) or Cmd+G |
| Find previous | Shift+Enter or Cmd+Shift+G |
| Open find & replace | Cmd+Shift+H |
| Replace | Enter (in replace input) |
| Replace all | Cmd+Shift+Enter (in replace input) |
| Close find | Escape |

## UI/UX

### Find Bar Layout

```
┌─────────────────────────────────────────────────────┐
│ 🔍 [search input          ] 3 of 12  ‹ › ▼  ✕     │
│    [replace input          ] Replace  Replace All   │  ← expanded with ▼
└─────────────────────────────────────────────────────┘
```

- Appears at the top of the editor content area with a subtle border-bottom
- Does not push document content down — overlays with slight opacity background
- Search input gets focus immediately on open
- If text is selected when Cmd+F is pressed, pre-fill the search input with the selection
- Replace row hidden by default, toggled with a chevron button
- Replace row only available for editable document types (markdown, plain text) — hidden for PDF, EPUB, DOCX
- Matches the app's neutral design system (no chromatic colors)
- Match highlights: subtle background color for all matches, stronger background for the active match

### States

- **Empty**: No input yet — no highlights, match count hidden
- **No matches**: Input entered but nothing found — show "No results" in muted text
- **Matches found**: Highlights visible, match count shown, first match scrolled into view
- **Replace mode**: Additional row with replace input and action buttons

## Data Model

### FindBar Props

```typescript
interface FindBarProps {
  open: boolean;
  onClose: () => void;
  matchCount: number;
  currentMatch: number; // 1-based
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  replaceEnabled: boolean;
  onReplace?: (replacement: string) => void;
  onReplaceAll?: (replacement: string) => void;
  initialQuery?: string; // Pre-fill from selection
}
```

### No new Zustand store needed

Find state is local to the editor component — no persistence needed.

## Dependencies

- `@codemirror/search` — already available if CodeMirror 6 is installed, provides search for source mode and plain text
- No new npm dependencies for ProseMirror search (custom decoration plugin)
- pdfjs `PDFFindController` — already part of pdfjs-dist

## Quality Gates

### Functional

- [x] Cmd+F opens find bar in all document types (markdown WYSIWYG, source, PDF, EPUB, DOCX, plain text)

- [x] Typing in find input highlights all matches in the document

- [x] Match count updates as user types

- [x] Enter / Shift+Enter navigates forward/backward through matches

- [x] Active match is visually distinct from other matches

- [x] Active match scrolls into view

- [x] Escape closes find bar and clears all highlights

- [x] Selected text pre-fills the search input

- [x] Cmd+Shift+H opens find bar with replace row expanded (editable documents only)

- [x] Replace replaces the current match and advances to next

- [x] Replace All replaces all matches

- [x] Find bar does not interfere with other editor features (slash commands, tag autocomplete, ghost text)

- [ ] Works correctly after tab switch (find state resets)

### Design

- [ ] Find bar matches the app's neutral design system

- [ ] Smooth appear/disappear transition

- [ ] Match highlight colors work in both light and dark mode

- [ ] Find bar does not obscure the first line of the document

- [ ] Input styling consistent with other inputs in the app

## Phased Implementation

### Phase 1: Markdown WYSIWYG + Source Mode

Start with the most common document type. ProseMirror decoration plugin for WYSIWYG, CodeMirror search for source mode. Includes replace.

### Phase 2: PDF + EPUB

Add search to read-only viewers. No replace needed.

### Phase 3: DOCX + Plain Text

DOM-based search for DOCX, CodeMirror search for plain text files.

## Out of Scope

- Regex search patterns
- Case sensitivity toggle
- Whole-word matching toggle
- Search across multiple files
- Search result persistence across sessions
- Find in images (OCR)