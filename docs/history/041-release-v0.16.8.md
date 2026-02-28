# Release v0.16.8

**Date:** 2026-02-28
**Previous version:** 0.16.7

## Changes

### Features
- Find in document across all viewer types — Cmd+F now works in PDF, EPUB, DOCX, and plain text viewers (previously only markdown WYSIWYG/source)
- Shared DOM search utility (`dom-search.ts`) for DOCX and plain text viewers — TreeWalker-based text node walking with `<mark>` element wrapping
- DOCX viewer: FindBar with match highlighting, match count, prev/next navigation
- Plain text viewer: toolbar with filename display, FindBar with match highlighting
- PDF viewer: text layer search with match highlighting and page-aware navigation
- EPUB viewer: CFI-based search via foliate-js `view.search()`, native text selection highlighting via `view.select()`
- Inline tag badges — `#tag` patterns render as styled pill badges in the editor
- Tag occurrence search — click a tag badge to find all occurrences across the workspace
- Tag autocomplete — typing `#` suggests known tags from the workspace index
- Cmd+3 keyboard shortcut for direct tag search via command palette

### Fixes
- EPUB search: removed red SVG overlay artifacts by patching vendored `view.js` to suppress `addAnnotation` calls from the search generator
- EPUB keyboard forwarding: all keydown events (including modifier keys) forwarded from EPUB iframes to parent window, enabling Escape to close FindBar and app shortcuts (Cmd+T, etc.) when EPUB has focus
- FindBar: global Escape key listener ensures FindBar closes regardless of focus state

### Improvements
- Find-in-document PRD marked as Complete (all three phases done)
- Architecture docs updated with viewer components and dom-search utility
- Product description updated with comprehensive find-in-document coverage

## Files Changed
- 11 files changed across 9 commits
