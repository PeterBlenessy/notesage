# HTML Preview & Export — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **PRD** | [html-preview](../prds/2026-03-30-html-preview.md) |
| **Total** | 13 tasks: 4S, 6M, 3L |
| **Suggested order** | Backend (#1-#5) → State (#6) → UI (#7-#11) → Integration (#12) → Tests (#13) |

**Risks:**

- Callout/sparkline/link-preview/drawing pre-processing mirrors `markdown_to_typst.rs` — significant logic to port (mitigate: extract shared helpers where possible)
- comrak's `syntect` feature must be enabled for code highlighting — verify it's already in `Cargo.toml` features
- Clipboard `text/html` MIME type requires Tauri clipboard API or `navigator.clipboard.write()` with `ClipboardItem` — verify browser support in WKWebView

---

### #1 — Add `markdown_to_html` module with comrak rendering ✅

**Description:** Create `src-tauri/src/export/markdown_to_html.rs` with a function that takes markdown and returns an HTML body fragment. Enable comrak GFM extensions (tables, task lists, strikethrough, autolinks, footnotes, front matter delimiter). Strip YAML frontmatter before parsing. Enable syntect-based syntax highlighting for code blocks.

**Acceptance criteria:**

- Standard GFM markdown renders to correct HTML
- Frontmatter is stripped and not rendered
- Code blocks have syntax-highlighted `<span>` elements with inline styles
- Function signature: `pub fn markdown_to_html(markdown: &str, theme: &str, project_root: Option<&str>) -> String`

**Complexity:** M **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/export/markdown_to_html.rs` (new)
- `src-tauri/src/export/mod.rs` (add module)
- `src-tauri/Cargo.toml` (verify `syntect` feature on comrak)

---

### #2 — Pre-process Notesage callout blocks for HTML ✅

**Description:** Before comrak parsing, extract `> [!type]\n> Content` callout blocks and replace them with placeholder markers. After comrak renders the HTML, replace placeholders with styled `<div class="callout callout-{type}">` elements containing an SVG icon and the callout content. Support all four types: note, tip, warning, important.

Follow the same pre-processing pattern used in `markdown_to_typst.rs`.

**Acceptance criteria:**

- All four callout types render with correct icon, border color, and background
- Nested content within callouts renders correctly (bold, links, code)
- Callout blocks don't break surrounding markdown parsing

**Complexity:** M **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/export/markdown_to_html.rs`

---

### #3 — Pre-process sparklines, link previews, and drawings for HTML ✅

**Description:** Extend the pre-processor to handle:

- `{{spark:1,2,3}}` patterns → inline `<svg>` polyline charts (\~60x20px) with muted stroke
- `> [!link](url)` link preview blocks → styled `<a>` card with title and URL (no OG fetch at export time — render a clean link card)
- `<div data-drawing-id="path" ...>` drawing blocks → `<img>` with base64-encoded SVG from `.svg` sidecar files (resolved via `project_root`)
- `<!-- type:number,summary:sum -->` table metadata → store for post-processing, strip comments from header cells

Also handle text color spans (`<span style="color:...">`) and highlight marks (`<mark>`) — these should pass through comrak's rendering or be applied as post-processing.

**Acceptance criteria:**

- Sparklines render as inline SVGs with correct polyline paths
- Drawing blocks embed SVG content as base64 data URIs
- Table metadata comments are stripped from rendered output
- Link preview blocks render as styled cards (not raw blockquotes)

**Complexity:** L **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/export/markdown_to_html.rs`

---

### #4 — Compute table aggregation footers in HTML output ✅

**Description:** After HTML rendering, parse table metadata collected during pre-processing. For tables with `summary:` metadata, compute aggregation values (sum, avg, count, min, max) from table body cell values and append `<tfoot>` rows to the table HTML.

Follow the same computation logic as `markdown_to_typst.rs` table handling.

**Acceptance criteria:**

- Tables with `summary:sum` get a footer row with correct sums
- All aggregation types work (sum, avg, count, min, max)
- Number parsing handles currency symbols, percentages, commas
- Tables without metadata render normally (no footer)

**Complexity:** M **Category:** backend **Dependencies:** Depends on #3 **Files:**

- `src-tauri/src/export/markdown_to_html.rs`

---

### #5 — Add embedded CSS and `render_html` Tauri command ✅

**Description:** Create `src-tauri/src/export/html_styles.rs` with embedded CSS for light and dark themes. CSS should include: typography (system font stack), content layout (720px max-width, centered), callout styles, table styles with footer, sparkline stroke colors, code block backgrounds, task list checkbox styles, print styles, and CSP meta tag.

Add `render_html` Tauri command in `src-tauri/src/commands/export.rs` that calls `markdown_to_html`, wraps the body in a full HTML document template with embedded styles, and returns the complete HTML string. When `include_styles` is false (clipboard mode), return only the body content with essential inline styles.

Register the command in `lib.rs`.

**Acceptance criteria:**

- `render_html` returns a valid, self-contained HTML document
- Light and dark themes produce visually distinct, correct output
- HTML opens correctly in Safari, Chrome, and Firefox
- No external dependencies in the output (no CDN links, no external fonts)
- CSP meta tag is present
- Clipboard mode returns body-only fragment
- Command registered in `generate_handler![]`

**Complexity:** L **Category:** backend **Dependencies:** Depends on #1, #2, #3, #4 **Files:**

- `src-tauri/src/export/html_styles.rs` (new)
- `src-tauri/src/export/mod.rs` (add module)
- `src-tauri/src/commands/export.rs` (add command)
- `src-tauri/src/lib.rs` (register command)

---

### #6 — Extend `ViewMode` type and editor store ✅

**Description:** Add `"html-preview"` to the `ViewMode` type union in `src/lib/file-utils.ts`. Update `toggleViewMode` in `editor-store.ts` to cycle through three modes or keep the existing toggle behavior (WYSIWYG ↔ Source) and add `setViewMode` for explicit mode switching.

**Acceptance criteria:**

- `ViewMode` type includes `"html-preview"`
- `setViewMode(tabId, "html-preview")` works correctly
- Tab state persists the view mode across tab switches
- No regressions in existing WYSIWYG ↔ Source toggling

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/file-utils.ts`
- `src/stores/editor-store.ts`

---

### #7 — Create `HtmlViewer.tsx` component ✅

**Description:** Create a new viewer component following the pattern of `PdfViewer.tsx` / `EpubViewer.tsx`. Renders HTML in a sandboxed `<iframe>` with `sandbox="allow-same-origin"` and `srcdoc` attribute. Calls the `render_html` Tauri command on mount and when the document content or theme changes.

Include a toolbar above the iframe with:

- "Copy HTML" button — copies styled HTML to clipboard using `navigator.clipboard.write()` with `text/html` MIME type, with `text/plain` (raw markdown) fallback
- "Export HTML" button — native save dialog via Tauri, writes the HTML string to the chosen path
- Theme indicator (light/dark)

**Acceptance criteria:**

- HTML renders correctly in the sandboxed iframe
- Theme changes trigger re-render
- Toolbar buttons are styled consistently with other viewer toolbars
- Loading state shown while `render_html` executes

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #5, #6 **Files:**

- `src/components/editor/viewers/HtmlViewer.tsx` (new)

---

### #8 — Route `html-preview` view mode in Editor.tsx ✅

**Description:** Update `Editor.tsx` to check the active tab's `viewMode` and render `HtmlViewer` when it's `"html-preview"`. Follow the same pattern used for routing to `SourceModeEditor`, `EpubViewer`, `PdfViewer`, etc.

**Acceptance criteria:**

- Setting `viewMode` to `"html-preview"` shows the HTML viewer
- Switching back to `"wysiwyg"` or `"source"` restores the editor
- No flash or content loss during transitions

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- `src/components/editor/Editor.tsx`

---

### #9 — Add HTML preview toggle to toolbar and keyboard shortcut ✅

**Description:** Add a preview toggle button to the editor toolbar (e.g., an Eye icon) that switches to `html-preview` view mode. Add Cmd+Shift+P keyboard shortcut for the toggle. Add "Preview as HTML" to the command palette actions.

The toggle should work as: click once → `html-preview`, click again → back to previous mode (`wysiwyg` or `source`). Only available for `.md` files.

**Acceptance criteria:**

- Toolbar button toggles HTML preview mode
- Cmd+Shift+P shortcut works
- Command palette includes the action
- Button has appropriate active/inactive styling
- Only enabled for markdown files

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #8 **Files:**

- `src/components/editor/Toolbar.tsx`
- `src/components/CommandPalette.tsx`
- `src/hooks/useEditor.ts` (or wherever keyboard shortcuts are registered)

---

### #10 — Add Find in Document support for HTML preview ✅

**Description:** Wire up Cmd+F find-in-document support for the HTML viewer using the shared `dom-search.ts` utility, operating on the iframe's `contentDocument`. Follow the pattern used by `DocxViewer` and `PlainTextViewer`.

**Acceptance criteria:**

- Cmd+F opens the find bar in HTML preview mode
- Search highlights matches in the iframe content
- Match count and prev/next navigation work
- Escape closes the find bar

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- `src/components/editor/viewers/HtmlViewer.tsx`
- `src/components/editor/FindBar.tsx` (may need minor updates for iframe support)

---

### #11 — Add sidebar context menu items for HTML ✅

**Description:** Extend the sidebar file context menu for `.md` files with:

- "Preview as HTML" — opens the file in a tab with `html-preview` view mode active
- "Export as HTML" — renders markdown and saves directly via native dialog (no preview needed, reads file from disk via `read_file`, calls `render_html`, then saves)

Follow the pattern of the existing "Export as PDF" context menu item.

**Acceptance criteria:**

- Both menu items appear only for `.md` files
- "Preview as HTML" opens the file and sets view mode
- "Export as HTML" saves without opening a tab (or uses existing tab content if open)
- Error handling with toast notifications

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #5, #8 **Files:**

- `src/components/sidebar/FileTreeItem.tsx`
- `src/hooks/useFileOperations.ts` (add `exportHtml` helper)

---

### #12 — Update documentation ✅

**Description:** Update the relevant docs to reflect the new HTML preview & export feature:

- `docs/features/document-formats.md` — add HTML Preview & Export section
- `docs/keyboard-shortcuts.md` — add Cmd+Shift+P shortcut
- `docs/tauri-commands.md` — document `render_html` command

**Acceptance criteria:**

- All three docs updated with accurate information
- Key files table in document-formats.md includes new files

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #5, #7, #9 **Files:**

- `docs/features/document-formats.md`
- `docs/keyboard-shortcuts.md`
- `docs/tauri-commands.md`

---

### #13 — Write tests ✅

**Description:** Add tests for the HTML preview feature:

**Rust unit tests** (in `markdown_to_html.rs` or `src-tauri/src/export/integration_tests.rs`):

- Standard GFM features render correctly (headings, lists, tables, code blocks, task lists)
- Callout blocks render with correct classes and structure
- Sparkline patterns produce valid SVG elements
- Table metadata is stripped and footers computed correctly
- YAML frontmatter is stripped
- XSS prevention: raw HTML in markdown is escaped
- Light and dark theme CSS applied correctly
- Drawing blocks with missing SVG files degrade gracefully

**Frontend unit tests:**

- `HtmlViewer` component renders iframe with `srcdoc`
- Copy HTML puts `text/html` on clipboard
- View mode switching works correctly

**Acceptance criteria:**

- All Rust tests pass (`cargo test`)
- All frontend tests pass (`pnpm test`)
- Existing markdown round-trip tests still pass

**Complexity:** M **Category:** both **Dependencies:** Depends on #5, #7 **Files:**

- `src-tauri/src/export/markdown_to_html.rs` (inline `#[cfg(test)]` module)
- `src/components/editor/viewers/HtmlViewer.test.tsx` (new)