# Editor Architecture

Deep technical reference for the editor subsystem. For feature overview, see [editor.md](editor.md).

## ProseMirror as Source of Truth

- **ProseMirror is the single source of truth** for the currently open document
- All modifications flow through ProseMirror transactions
- The React component receives editor state updates via Tiptap's `useEditor` hook
- Do NOT maintain a separate "document content" state in Zustand — the editor IS the state
- Updating `tab.content` in Zustand does NOT update the editor visually — must use `editor.commands.setContent()` to push content to ProseMirror

## Tiptap Extension Model

Tiptap v2 wraps ProseMirror with a composable extension system. Each extension can define:
- Schema nodes/marks (document model)
- ProseMirror plugins (state, decorations, key bindings)
- Commands (imperative operations)
- Input rules (auto-formatting on type)

## Custom Extensions Inventory

| Extension | File | Type | Purpose |
| --- | --- | --- | --- |
| GhostText | `ghost-text.ts` | Plugin + Decoration | Copilot/local inline completion ghost text (widget decorations) |
| CommentMark | `comment-mark.ts` | Plugin + Decoration | Comment highlight decorations with status classes (open, delegated, done) |
| InlineDiff | `inline-diff.ts` | Plugin + Decoration | Inline diff decorations shared by external change review and git branch diff review |
| SearchHighlight | `search-highlight.ts` | Plugin + Decoration | Find-in-document match decorations with current/other match styling |
| TagHighlight | `tag-highlight.ts` | Plugin + Decoration | Inline tag badge decorations (#tag → styled pill) |
| TagSuggestion | `tag-suggestion.tsx` | Suggestion | Tag autocomplete popup (triggered by # character, uses `@tiptap/suggestion`) |
| SlashCommand | `slash-command.ts` | Suggestion | Block insertion menu (triggered by / at start of line) |

## Decoration System

ProseMirror decorations are the mechanism for visual overlays that don't modify the document:

- **Widget decorations** (`Decoration.widget()`): Insert DOM elements at a position. Used by GhostText for inline completion preview.
- **Inline decorations** (`Decoration.inline()`): Style text ranges. Used by CommentMark, SearchHighlight, InlineDiff, TagHighlight.
- **Node decorations** (`Decoration.node()`): Style entire nodes. Not currently used.

Each decoration-based extension follows a pattern:
1. Define a `PluginKey` for the plugin state
2. Store decoration state in the plugin's `DecorationSet`
3. Update decorations via transactions (either document changes or external dispatch)
4. Read decorations in `props.decorations()` for rendering

## Plugin State Patterns

### CommentMark (`CommentMarkPluginKey`)
- Decorations rebuilt when comments change (dispatched from `useCommentOperations`)
- Tracks anchor positions through document edits via ProseMirror mapping
- Status-based CSS classes: `comment-open`, `comment-delegated`, `comment-done`
- Primary source for `resolveAnchorRange()` when applying agent replies

### SearchHighlight
- Decorations rebuilt on search query change or document change
- Two decoration classes: `search-match-current` and `search-match-other`
- Integrates with FindBar for navigation (next/previous match)

### InlineDiff
- Singleton decoration layer shared by two features (external changes + git diff)
- Red strikethrough for deletions, green for insertions
- Per-hunk accept/reject via inline click controls or keyboard shortcuts
- Built from `diff-match-patch` output mapped to ProseMirror positions via `buildTextWithPositions`

### GhostText
- Single widget decoration at cursor position
- Cleared on any transaction with `docChanged` (auto-dismiss on type)
- Tab key handler for acceptance, Escape for dismissal
- Shared between Copilot LSP and local completion — both dispatch `setGhostText`

## Markdown Conversion

- Uses `prosemirror-markdown` for parse (markdown → PM doc) and serialize (PM doc → markdown)
- The conversion must handle all supported node types
- **Test strategy**: Reference `.md` files in `tests/fixtures/` covering all syntax. Round-trip test: parse → serialize → compare. Must pass before any PR.
- Whitespace normalization applied during comparison (trailing spaces, blank line counts)

## State Stores

- **editor-store**: Open tabs (file path + dirty state + per-tab `copilotDisabled` flag), active tab index, external change tracking per tab
- **tag-store** (non-persisted): Workspace tag index — all known tags and tag-to-file mapping, rebuilt from periodic scans
- **external-change-store** (non-persisted): Pending external file changes with hunks, old/new content, status (`pending` → `deferred`)
- **comment-store**: Comments per document, replies, delegation status, activity log

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/editor/extensions/` | All custom Tiptap extensions |
| `src/lib/markdown.ts` | Markdown ↔ ProseMirror conversion |
| `src/lib/dom-search.ts` | Shared DOM text search utility (DOCX, plain text viewers) |
| `src/lib/ai/ai-suggestion.ts` | `setSuggestion()` / `hasActiveSuggestion()` for inline diff display |
| `src/lib/ai/pm-replace.ts` | `extractReplacementText()` and `resolveAnchorRange()` |
| `src/styles/editor.css` | Editor-specific styles (ProseMirror overrides) |
