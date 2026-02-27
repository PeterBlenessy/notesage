# Release v0.16.7

**Date:** 2026-02-27
**Previous version:** 0.16.6

## Changes

### Features
- EPUB viewer: replace epubjs with foliate-js for reliable paginated and scroll rendering
- EPUB viewer: dark/light mode support — content theme follows app theme with full element coverage
- EPUB viewer: running header (chapter title) and footer (page number) in paginated mode
- EPUB viewer: book-wide page numbering accumulated from physical pages across sections

### Fixes
- EPUB viewer: table overflow constrained to column width in paginated mode (paginator.js)
- EPUB viewer: null guard fixes in paginator.js for documents without expected elements
- Frontmatter parser: gracefully handle invalid YAML instead of throwing

### Improvements
- EPUB viewer: single-column layout following foliate-js reference implementation pattern
- EPUB viewer: bookmark persistence and restoration on app restart
- EPUB viewer: arrow key navigation in paginated mode
- EPUB viewer: TOC dropdown for chapter navigation
- File types: register `.epub` as binary file type, add `.log`/`.txt` as plain text types
- Removed epubjs dependency in favor of vendored foliate-js (MIT licensed)

## Files Changed
- 15+ files changed including new vendored foliate-js library
