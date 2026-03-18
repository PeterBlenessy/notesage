# Release v0.22.4

**Date:** 2026-03-18
**Previous version:** 0.22.3

## Changes

### Features
- Instant tab restore on startup: all tab titles appear immediately, active tab content loads eagerly, background tabs load on demand when clicked
- Lazy-load document viewers (PDF, EPUB, DOCX, image) — heavy libraries only fetched when opening those file types

### Fixes
- Skip .tmp files in SQLite indexer to eliminate transient "Cannot read" warnings from Zustand atomic writes
- Instant tab close: editor content hides via DOM before React unmounts heavy viewers (e.g., 400-page PDFs)

### Improvements
- Remove deprecated persona system from ai-store (~100 LOC)
- Delete deferred AnnotationPicker and item-annotation extensions (~375 LOC)
- Add depth limit (50) to recursive list_directory to prevent stack overflow
- Remove TOCTOU pre-checks in file operations, rely on operation error codes
- Add file path context to all file operation error messages
- Log warnings for swallowed directory recursion errors
- Add domain matching security tests for network proxy (suffix bypass, edge cases)
- Tab restoration runs concurrently with tree validation and index init

## Files Changed
- 16 files changed across 5 commits
