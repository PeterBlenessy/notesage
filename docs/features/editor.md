# Editor

Tiptap-powered rich text editor with full markdown round-tripping.

## Supported Content

- Headings (H1-H6), paragraphs
- Bold, italic, underline, strikethrough, code (inline)
- Bullet lists, ordered lists, task lists (checkboxes)
- Blockquotes, horizontal rules
- Code blocks with syntax highlighting (lowlight)
- Links (rendered inline, clickable — internal document links and external URLs), images (via URL prompt)
- Tables (insert, add/remove rows/columns, merge/split cells, toggle headers)
- Text color (8-color palette) and background highlights (6-color palette)
- Text alignment (left, center, right)

## Editing Features

- Top toolbar with formatting controls: heading level picker, undo/redo, bold, italic, underline, strikethrough, code, text color, highlight, bullet list, ordered list, task list, indent/outdent, blockquote, code block, horizontal rule, alignment (left/center/right), table, image, typography settings (searchable font picker with 14 presets + all installed system fonts, font size, line height, paragraph spacing), dictation
- Bubble menu on text selection with AI actions (Improve, Summarize, Expand) — toggleable in settings
- Floating table toolbar appears when cursor is inside a table — add/remove rows and columns, merge/split cells, toggle header row, delete table
- ~~Block drag handles~~ — deferred, needs unified left-gutter design
- ~~Item annotations~~ — deferred, needs unified left-gutter design
- Slash commands (`/` at start of line) for inserting headings, lists, code blocks, blockquotes, tables, horizontal rules, images
- Multi-tab editing with dirty indicator, auto-save on blur/tab switch (debounced 1s)
- Per-tab undo/redo history preserved across tab switches (in-memory EditorState cache)
- Open tabs restored on app restart (persisted file paths, re-opened from disk; undo history starts fresh)

## File Management

- Sidebar file tree with expand/collapse, file icons by extension, right-click context menu (new file, new folder, rename, delete)
- File operations via Tauri commands: open folder (native dialog), open/save/create/rename/delete files
- Hidden files/folders ignored by default

## Markdown Round-Tripping

- Open .md file → parse to ProseMirror → edit in rich text → serialize back to clean markdown
- Lossless: markdown in must equal markdown out (modulo whitespace normalization)
- Test fixtures in `tests/fixtures/*.md` covering all syntax

## Desktop Packaging

- macOS primary (arm64 + x86_64), window 1200x800 default, min 800x600
- Native title bar, resizable
- Light/dark mode following system preference (Cmd+T to toggle), with optional soft contrast mode for reduced eye strain

## Find in Document

In-document search across all supported file types, with replace for editable documents.

**Find (Cmd+F):**

- Floating find bar anchored to the top of the content area
- Case-insensitive text matching across the entire document
- Match count display (e.g., "3 of 12") with prev/next navigation (Enter / Shift+Enter or arrow buttons)
- Current match highlighted distinctly; all other matches highlighted with neutral grey decorations
- Document scrolls to bring the current match into view
- Selected text pre-fills the search input when the find bar opens
- Find state clears on tab switch
- Escape closes find bar from anywhere (global keyboard listener)

**Replace (Cmd+Shift+H):**

- Opens find bar with replace row expanded
- Replace current match or Replace All in one click
- Replace row can be toggled open/closed independently
- Only available for editable documents (markdown)

**Per-viewer implementations:**

- **Markdown WYSIWYG:** Custom `SearchHighlight` ProseMirror decoration plugin with find + replace
- **Markdown source mode:** Delegates to CodeMirror's native search panel
- **PDF:** Uses pdfjs-dist text layer search with `highlightTextLayerMatches` utility
- **EPUB:** Uses foliate-js `view.search()` async generator for CFI collection, `view.select()` for native text selection highlighting
- **DOCX:** DOM-based search via shared `dom-search.ts` utility (walk text nodes, wrap matches in `<mark>` elements)
- **Plain text:** Same DOM-based search via `dom-search.ts` operating on `<pre>` element

## Internal Document Linking

Link to other documents in your workspace using standard markdown link syntax.

**Creating internal links:**

- Use the link button in the toolbar (or type markdown link syntax directly)
- The link popover supports both document search and external URL entry
- Type a filename to search across all open projects and explorer folders
- Selecting a search result inserts a relative path link with the file name as display text
- External URLs (starting with `http`, `mailto`, etc.) behave as before

**Clicking internal links:**

- Clicking a link in the editor navigates to the target: internal file links open as tabs, external URLs open in the system browser
- Relative paths (e.g., `./readme.md`, `../docs/file.md`) are resolved from the active file's directory
- Absolute paths (starting with `/`) are opened directly
- If resolution fails, workspace roots are searched as a fallback
- Toast error shown if the file cannot be found

**Visual distinction:**

- Internal document links display with a dashed underline to distinguish them from external URLs
- External links use a solid underline on hover

**Key files:**

| File | Purpose |
| --- | --- |
| `src/lib/link-utils.ts` | Shared link detection, search, and navigation utilities |
| `src/components/editor/extensions/link-click.ts` | ProseMirror click handler for link navigation |
| `src/components/editor/toolbar/LinkButton.tsx` | Link popover with document search |

## Inline Tag Badges & Search

Hashtag-based tagging system with visual badges, autocomplete, and cross-file search.

**Tag badges:**

- `#tagName` patterns render as styled inline badges (pill shape) in the editor
- Tags inside code blocks and inline code are excluded
- Clicking a tag badge opens the command palette with all occurrences of that tag across the workspace
- Each occurrence shows file name, line number, and a content snippet
- Selecting an occurrence opens the file and scrolls to the exact tag position

**Tag autocomplete:**

- Typing `#` triggers a suggestion popup listing known tags from the workspace
- Case-insensitive substring filtering as user types
- Keyboard navigation (arrow keys, Enter to select, Escape to dismiss)
- Suppressed inside code blocks and existing tag decorations

**Tag search (Cmd+3 or type `#` in palette):**

- Opens the command palette in tag search mode (prefix `#` pre-filled)
- Type a tag name → shows matching tags across all files
- Select a tag to drill into occurrences; select an occurrence to jump directly to it

**Mention search (Cmd+2 or type `@` in palette):**

- Opens the command palette in mention search mode (prefix `@` pre-filled)
- Same two-level list→drilldown pattern as tag search

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/editor/Editor.tsx` | Main editor wrapper |
| `src/components/editor/EditorContent.tsx` | Tiptap content area |
| `src/components/editor/Toolbar.tsx` | Floating format toolbar |
| `src/components/editor/SlashCommand.tsx` | Slash command menu |
| `src/components/editor/BubbleMenu.tsx` | Selection bubble menu |
| `src/components/editor/TableToolbar.tsx` | Floating table editing toolbar |
| ~~`src/components/editor/AnnotationPicker.tsx`~~ | ~~Item annotation emoji picker (deferred)~~ |
| `src/components/editor/FindBar.tsx` | Find and replace bar |
| `src/components/editor/StatusBar.tsx` | Editor status bar |
| `src/components/editor/extensions/` | Custom Tiptap extensions |
| `src/hooks/useEditor.ts` | Tiptap editor instance hook |
| `src/lib/markdown.ts` | Markdown ↔ ProseMirror conversion |
| `src/stores/editor-store.ts` | Open tabs, active file |

## Future Enhancements

- ProseMirror decorations for inline suggestions (green insert, red delete)
- Context-aware suggestions (understand document structure)
