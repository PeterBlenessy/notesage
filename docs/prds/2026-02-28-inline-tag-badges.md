# PRD: Inline Tag Badges & Autocomplete

**Date:** 2026-02-28 **Status:** ✅ Complete **Parent:** Phase 6.5 — Chat UX & Agent Polish

## Problem

Notesage users write hashtags in their markdown notes (e.g., `#project1`, `#ai`, `#meeting`) to categorize and cross-reference content. These tags are rendered as plain text with no visual distinction, making them hard to spot in a document. There is no way to discover which files share a tag or to autocomplete previously used tags.

## Goals

1. Visually distinguish `#tag` patterns in the editor as inline badges
2. Clicking a tag badge opens the command palette showing all files containing that tag
3. Typing `#` triggers an autocomplete suggestion popup listing known tags from the workspace
4. Scan workspace files on startup to build a tag index for autocomplete and search
5. Tags inside code blocks and inline code are excluded from decoration and autocomplete

## Non-Goals

- No tag management UI (rename, merge, delete tags)
- No tag-specific sidebar panel or graph view
- No tag persistence beyond the workspace scan (tags are derived from file content)
- No tag rendering in non-markdown file types

## Solution

### Tag Highlighting (ProseMirror Decoration Plugin)

A Tiptap extension (`TagHighlight`) that uses a ProseMirror plugin to:

- Scan document text nodes for `#tagName` patterns using regex `(?:^|[^\w])#([a-zA-Z][a-zA-Z0-9_-]*)`
- Create inline decorations with `class="tag-badge"` and `data-tag` attribute
- Rebuild decorations on every document change
- Skip code blocks and text nodes with code marks
- Intercept `mousedown` on `.tag-badge` elements to dispatch a `notesage:open-tag-search` CustomEvent with the tag name

### Tag Badge Styling

CSS in `editor.css`:

- Rounded pill shape with subtle background color
- Monospace font at slightly smaller size
- Hover state with cursor pointer
- Smooth transitions

### Tag Autocomplete (Tiptap Suggestion Extension)

A Tiptap extension (`TagSuggestion`) using `@tiptap/suggestion`:

- Triggers on `#` character input
- Queries the tag store for matching tags (case-insensitive substring match)
- Renders a floating popup with tag suggestions (Hash icon + tag name)
- Keyboard navigation (arrow keys, Enter to select, Escape to dismiss)
- Suppressed inside code blocks and when cursor is inside an existing tag decoration
- Selecting a tag inserts `#tagName `(with trailing space)

### Tag Store (Zustand)

A non-persisted Zustand store (`tag-store`) holding:

- `tags: string[]` — sorted list of all known tag names (without `#`)
- `filesByTag: Record<string, string[]>` — map of tag name to file paths
- `setScanResult()` — bulk update from workspace scan

### Workspace Tag Scanning (Rust Backend)

Existing `scan_tags_in_directories` Tauri command scans `.md` files across all workspace directories (projects, explorer folders, notes root) for `#tag` patterns. Called on startup and debounced after file saves.

### Command Palette Integration

When a tag badge is clicked:

1. `notesage:open-tag-search` event fires with tag name
2. `App.tsx` handler looks up `filesByTag` from tag store for immediate file-level results
3. Command palette opens in files-only mode with tag files displayed
4. cmdk filtering is disabled (backend provides the results, not fuzzy matching)

## Files Created

- `src/components/editor/extensions/tag-highlight.ts` — TagHighlight ProseMirror plugin
- `src/components/editor/extensions/tag-suggestion.tsx` — TagSuggestion autocomplete extension
- `src/stores/tag-store.ts` — Tag index store

## Files Modified

- `src/components/editor/extensions/index.ts` — Register TagHighlight and TagSuggestion extensions
- `src/styles/editor.css` — Tag badge styles
- `src/hooks/useEditor.ts` — Include tag extensions in editor setup
- `src/hooks/useFileOperations.ts` — Debounced tag scanning after file saves
- `src/App.tsx` — Tag badge click handler, command palette tag file results
- `src/components/CommandPalette.tsx` — Tag file results rendering, cmdk filter suppression
- `src/lib/tauri.ts` — Tag scanning API wrapper
- `src-tauri/src/commands/file.rs` — Tag scanning command (if not already present)

## Verification

1. Type `#ai` in a document → text renders as a styled badge
2. Tags in code blocks → no badge decoration
3. Click a tag badge → command palette opens with files containing that tag
4. Type `#` in the editor → autocomplete popup shows known tags
5. Select a tag from autocomplete → `#tagName `inserted
6. Arrow keys navigate the autocomplete list
7. Escape dismisses the autocomplete popup
8. Works in both light and dark mode
9. Tag index updates after saving a file with new tags