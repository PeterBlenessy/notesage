# PRD: Tag Occurrence Search with Jump-to-Line

**Date:** 2026-02-28 **Status:** Draft **Depends on:** Inline Tag Badges (2026-02-28-inline-tag-badges.md)

## Problem

When a user clicks a tag badge, the command palette opens showing files that contain that tag. However, selecting a file simply opens it with no way to jump to the tag's location. Tags can appear multiple times in a file (e.g., daily notes tagging meetings by project). Users need to see individual occurrences with context and jump directly to the specific line.

## Goals

1. Show individual tag occurrences in the command palette — not just files, but each line where the tag appears
2. Each occurrence displays: file name, 1-based line number, and a snippet of the surrounding line content
3. Selecting an occurrence opens the file and scrolls to the exact line containing the tag
4. Tags appearing multiple times in one file show as separate entries
5. Works for files already open in tabs (jump without reload) and for files not yet opened

## Non-Goals

- No full-text search — this is tag-specific, triggered by clicking a tag badge
- No regex or fuzzy matching — exact tag match only
- No persistent bookmarking or pinning of tag occurrences

## Technical Approach

### Backend: `find_tag_occurrences` Rust command

New Tauri command in `src-tauri/src/commands/file.rs` that accepts a tag name and list of directory paths, scans `.md` files for exact tag matches, and returns per-line occurrences with context snippets.

### Frontend: Scroll-to-line infrastructure

- `scrollToLine` field on `Tab` interface (session-only, not persisted)
- `openFileAtLine` function in `useFileOperations` that opens a file and sets `scrollToLine`
- `findPosAtLine` helper in `Editor.tsx` that maps 1-based line numbers to ProseMirror positions
- `useEffect` in `Editor.tsx` that scrolls to the target line after content loads

### CommandPalette: Occurrence rendering

- New `tagOccurrences` prop replaces `tagFiles` when present
- Each item shows file name, line number, and snippet
- Selection calls `openFileAtLine` instead of `openFile`

### App.tsx: Async occurrence lookup

- Tag badge click handler calls `find_tag_occurrences` instead of using pre-computed `filesByTag`
- Results passed to CommandPalette as `tagOccurrences`

## Files Modified

- `src-tauri/src/commands/file.rs` — New `TagOccurrence` struct and `find_tag_occurrences` command
- `src-tauri/src/lib.rs` — Register command in `generate_handler![]`
- `src/lib/tauri.ts` — Typed wrapper and interface
- `src/stores/editor-store.ts` — `scrollToLine` on Tab, `setScrollToLine` action
- `src/hooks/useFileOperations.ts` — `openFileAtLine` function
- `src/components/editor/Editor.tsx` — `findPosAtLine` helper and scroll-to-line useEffect
- `src/components/CommandPalette.tsx` — Render tag occurrences with line numbers and snippets
- `src/App.tsx` — Async tag occurrence lookup on badge click

## Verification

1. Click a tag badge → command palette shows individual occurrences with file name, line number, and snippet
2. Select an occurrence → file opens and scrolls to the exact line
3. Tag appearing 3 times in one file → 3 separate entries in the list
4. Tag in multiple files → entries sorted by file then line
5. Opening a file that's already in a tab → jumps to line without reloading
6. Arrow keys navigate the occurrence list normally
7. Escape closes the palette