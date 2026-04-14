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
| AISuggestion | `ai-suggestion.ts` | Plugin + Decoration | Inline diff decorations for AI suggestions (green insert, red delete) with accept/reject |
| DateHighlight | `date-highlight.ts` | Plugin + Decoration | Decorates `//YYYY-MM-DD` date patterns as styled badge pills |
| DateSuggestion | `date-suggestion.tsx` | Suggestion | Date picker popup triggered by `//` prefix with calendar and preset options |
| LocalImage | `local-image.ts` | Node Extension | Extends Tiptap Image to resolve local file paths via Tauri asset protocol |
| MentionHighlight | `mention-highlight.ts` | Plugin + Decoration | Decorates `@mention` patterns as styled badge pills |
| MentionSuggestion | `mention-suggestion.tsx` | Suggestion | Mention autocomplete popup triggered by `@` with cross-file search |
| PageBreaks | `page-breaks.ts` | Plugin + Decoration | Print Layout mode: three widget decorations per page boundary (`page-top-margin` with header zone, `page-gap` separator, `page-bottom-margin` with footer zone). Header/footer zones are clickable for inline editing via React portal. Reads layout state from Zustand stores directly. |
| TableMarkdown | `table-markdown.ts` | Utility | Custom table markdown serializer for GFM round-tripping |
| ThemedHighlight | `themed-highlight.ts` | Mark Extension | Extends Tiptap Highlight with semantic color names for light/dark mode |
| LinkClick | `link-click.ts` | Plugin | Click handler for link navigation (internal files → open as tab, external → system browser) |
| Callout | `callout.ts` | Node Extension | Callout blocks (Note, Tip, Warning, Important) with Obsidian `> [!type]` markdown round-tripping |
| Drawing | `drawing.ts` | Node Extension + ReactNodeViewRenderer + Plugin | Inline Excalidraw canvas (atom node, inline JSON via `drawingJson` attribute, `` ```excalidraw `` fenced code block markdown, legacy sidecar with auto-migration, deletion cleanup plugin with 5s undo) |
| LinkPreview | `link-preview.ts` | Node Extension + ReactNodeViewRenderer + Plugin | Rich link preview cards (atom node, OG metadata fetch, `> [!link](url)` markdown, paste detection prompt, `/embed` slash command) |
| TableHeaderAttrs | `table-header-attrs.ts` | Node Extension | Extends TableHeader with `colType`, `colCurrency`, `colAggregation`, `colSortDirection` attributes |
| TableAggregation | `table-aggregation.ts` | Plugin + Decoration | Computes column aggregations (sum/avg/count/min/max) and renders footer row via widget decoration |
| TableSort | `table-sort.ts` | Plugin + Decoration + Command | Click-to-sort headers (asc/desc/clear) with sort indicator widget decorations on all header cells |
| TableFilter | `table-filter.ts` | Plugin + Decoration | Row filtering with text input widget decoration; hides non-matching rows via node decorations |
| TableSparkline | `table-sparkline.ts` | Plugin + Decoration | Detects `{{spark:...}}` patterns and renders inline SVG sparkline widgets; reveals raw text on focus |
| TableHeaderMenu | `table-header-menu.ts` | Plugin + Decoration + DOM Event | Right-click context menu handler for column config; type badge widget decorations on header cells |
| SendToAI | `send-to-ai.ts` | Plugin + DOM Event | Right-click "Add to chat" context menu on images and drawings; resolves image data and dispatches to chat via vision event bus |
| Chart | `chart.ts` | Node Extension + ReactNodeViewRenderer | Inline chart blocks (10 types via Recharts) with visual data editor, `` ```chart `` fenced code block markdown |
| Mermaid | `mermaid.ts` | Node Extension + ReactNodeViewRenderer | Mermaid diagram blocks with live rendering, `` ```mermaid `` fenced code block markdown |
| PageBreakNode | `page-break-node.ts` | Node Extension | Explicit page break node for Print Layout mode |
| TableColumnTypes | `table-column-types.ts` | Plugin | Column type inference and locale-aware formatting (number, currency, percentage, date) |
| TableFormatting | `table-formatting.ts` | Plugin | Table cell formatting decorations (alignment, number formatting) |
| TypographyOverrides | `typography-overrides.ts` | Plugin | Custom typography rules (smart quotes, em dashes, ellipsis) |
| TrailingNode | `trailing-node.ts` | Plugin (appendTransaction) | Ensures an empty paragraph at end of document for click-below-last-block UX |
| DecorationFactory | `decoration-factory.ts` | Utility | Shared `createDecorationPlugin()` factory reducing boilerplate in decoration extensions |
| ~~ItemAnnotation~~ | `item-annotation.ts` | ~~Plugin + Decoration~~ | ~~Emoji annotations on list items (deferred — needs unified gutter design)~~ |
| ~~DragHandle~~ | `drag-handle.ts` | ~~Plugin + DOM~~ | ~~Block drag handles (deferred — needs unified gutter design)~~ |

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

## Per-Tab EditorState Cache

A single Tiptap editor instance is shared across all tabs. To preserve undo/redo history, selection, and decoration state across tab switches, the full ProseMirror `EditorState` is cached in memory per tab.

**Save/restore flow:**

1. On tab switch away: `editor.state` saved to `cachedEditorStatesRef` (keyed by tab ID)
2. On tab switch back: if cached state exists, `editor.view.updateState(cachedState)` restores it — undo/redo, cursor position, and all plugin states come back intact
3. On fresh load (no cache): `loadRawMarkdownIntoEditor()` parses markdown and clears history via `EditorState.create()` to prevent stale undo entries

**Cache invalidation:**

- External file changes (auto-reload or manual reload from disk)
- Source→WYSIWYG view mode switch
- After successful restore (one-time use, deleted from cache)
- App restart (in-memory only, not persisted to localStorage)

**What's preserved:** undo/redo stack, cursor/selection position, comment decorations, search highlights, AI suggestion state, all plugin states.

**What's NOT preserved across app restart:** undo/redo history, selection. Content and tab order are restored from Zustand persist, but the editor starts with fresh plugin state.

## Plugin State Patterns

### CommentMark (`CommentMarkPluginKey`)

- Decorations rebuilt when comments change (dispatched from `useCommentOperations`)
- Tracks anchor positions through document edits via ProseMirror mapping
- **Position sync:** On every `docChanged` transaction, remapped positions are synced back to the Zustand store and debounce-saved to disk (2s). This ensures comment positions survive tab switches and app restarts.
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
- **EditorState cache** (in-memory ref, not a store): Per-tab `Map<string, EditorState>` in `Editor.tsx` — preserves undo/redo, selection, and plugin states across tab switches
- **SQLite document index**: Tags, mentions, tasks, goals, headings, FTS5 content — persisted in `index.db`, updated incrementally by watcher. Replaces the removed `tag-store` and `mention-store` Zustand stores.
- **external-change-store** (non-persisted): Pending external file changes with hunks, old/new content, status (`pending` → `deferred`)
- **comment-store**: Comments per document, replies, delegation status, activity log

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/editor/extensions/` | All custom Tiptap extensions |
| `src/lib/markdown.ts` | Markdown ↔ ProseMirror conversion |
| `src/lib/dom-search.ts` | Shared DOM text search utility (DOCX, plain text viewers) |
| `src/components/editor/extensions/ai-suggestion.ts` | `setSuggestion()` / `hasActiveSuggestion()` for inline diff display |
| `src/lib/pm-replace.ts` | `extractReplacementText()` and `resolveAnchorRange()` |
| `src/styles/editor.css` | Editor-specific styles (ProseMirror overrides, `.hljs-*` code block highlighting) |
| `src/components/editor/viewers/CodeEditor.tsx` | Editable CodeMirror 6 code file editor (non-Tiptap) |
| `src/components/editor/codemirror-theme.ts` | CodeMirror themes: `notesageExtensions` (markdown), `notesageCodeExtensions` (code files) |
| `src/lib/codemirror-languages.ts` | Extension → language mapping, lazy loader, `isCodeFile()`, `getLanguageName()` |
