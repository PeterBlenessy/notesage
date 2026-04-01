---
page:
  header:
    left: "{title}"
---

# Tasks: WYSIWYG Typography Phase 2 — Page Constructs

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **PRD** | [wysiwyg-typography](../prds/2026-03-30-wysiwyg-typography.md) (Phase 2 section) |
| **Total** | 12 tasks: 3S, 6M, 3L |
| **Suggested order** | Data model (#1) → Frontmatter I/O (#2-#3) → Editor decorations (#4-#5) → Edit UI (#6-#7) → Variable rendering (#8) → Export pipelines (#9-#11) → Tests (#12) |

**Risks:**

- ProseMirror decorations for header/footer zones must not interfere with the existing page break gap decorations in `page-breaks.ts`
- Frontmatter round-trip must preserve unknown keys (users may have custom frontmatter fields)
- Typst page header/footer uses `context` blocks for page counters — syntax is delicate
- DOCX headers/footers use a separate XML part (`word/header1.xml`) — the `docx-rs` crate's support for headers/footers needs verification

**Open questions:**

- Should header/footer editing be available outside paged view (e.g., via a document settings panel)? The PRD says "When not in paged view: accessible via document settings" — this could be a simple dialog rather than inline editing.
- Should the `{pages}` variable (total page count) work in the editor preview? In paged view we know the page count, but it changes as the user types. Recommendation: show `{pages}` as a literal placeholder in the editor, resolve it only at export time.

---

## Phase 2 — Page Constructs

### #1 — Define DocumentPageSettings data model and types ✅

**Description:** Create the `DocumentPageSettings` and `PageHeaderFooter` TypeScript interfaces matching the PRD spec. Add a `PAGE_SETTINGS_DEFAULTS` constant with empty header/footer content. Add a Rust mirror struct with serde for export IPC. Define the supported variables (`{page}`, `{pages}`, `{title}`, `{date}`) as a constant array with display labels.

**Complexity:** S **Category:** both **Dependencies:** None **Files:**

- `src/lib/page-settings.ts` — new: TypeScript types, defaults, variable definitions
- `src-tauri/src/export/page_settings.rs` — new: Rust structs with serde

---

### #2 — Read/write page settings from YAML frontmatter ✅

**Description:** Extend `parseFrontmatter()` in `frontmatter.ts` to extract the `page` key into a `DocumentPageSettings` object. Add `updatePageSettings(markdown, settings)` that writes the `page` key back into the frontmatter YAML without disturbing other keys. When `page` is absent, return `PAGE_SETTINGS_DEFAULTS`. Add a `usePageSettings(editor)` hook that reads the current document's frontmatter, parses page settings, and exposes `settings` + `updateSettings()`.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/frontmatter.ts` — extract `page` key from parsed frontmatter
- `src/lib/page-settings.ts` — add `parsePageSettings(frontmatter)` and `serializePageSettings(settings)` helpers
- `src/hooks/usePageSettings.ts` — new: hook that reads/writes page settings via frontmatter

---

### #3 — Persist page settings on save and restore on load ✅

**Description:** When saving a document, if page settings have been modified (non-default), inject the `page` key into the frontmatter before writing to disk. When loading, parse the `page` key and make it available to the editor. Gate behind the existing `parseFrontmatter` / serialization pipeline in `markdown.ts` — no new save paths.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/lib/markdown.ts` — integrate page settings into the serialize pipeline
- `src/hooks/usePageSettings.ts` — trigger save on settings change (debounced)

---

### #4 — Render header/footer zones as ProseMirror decorations in paged view ✅

**Description:** Extend the `page-breaks.ts` extension to render header and footer widget decorations at the top and bottom of each page gap. Each zone is a `<div>` with three columns (left, center, right) showing the current header/footer content with variable placeholders resolved where possible. Zones are only rendered when `pageBreaks` setting is not `"continuous"`. The decorations read page settings from the `usePageSettings` hook via a plugin meta dispatch.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #2 **Files:**

- `src/components/editor/extensions/page-breaks.ts` — add header/footer widget decorations alongside existing page break gaps
- `src/styles/editor.css` — header/footer zone styling (translucent background, three-column layout, muted text)

---

### #5 — Style header/footer zones for light/dark mode ✅

**Description:** Add CSS for the header/footer decoration zones: translucent background, subtle top/bottom borders, three-column flex layout (left | center | right), muted text color, smooth hover transition to slightly more opaque. "Click to edit" placeholder text when empty. Ensure the zones are visually distinct from document content but non-intrusive. Must work in both light and dark mode using CSS variables.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4 **Files:**

- `src/styles/editor.css` — header/footer zone CSS (`.page-header-zone`, `.page-footer-zone`)

---

### #6 — Build inline header/footer edit UI ✅

**Description:** When a header/footer zone decoration is clicked, replace it with an editable three-column input row. Each column is a small text input (or contenteditable span). Show a "Different first page" checkbox toggle and a variable insertion dropdown button (`{page}`, `{pages}`, `{title}`, `{date}`). Clicking the variable inserts it at the cursor position in the active column input. Changes write back to the page settings via `usePageSettings.updateSettings()`. Clicking outside or pressing Escape closes edit mode.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #2, #4 **Files:**

- `src/components/editor/PageHeaderFooterEditor.tsx` — new: React component rendered inside the decoration widget
- `src/components/editor/extensions/page-breaks.ts` — click handler to toggle edit mode on header/footer zones

---

### #7 — Support "Different first page" toggle ✅

**Description:** When `differentFirstPage` is true, the first page's header/footer decorations use `firstPage.left/center/right` instead of the main values. The edit UI shows a toggle checkbox; when enabled, additional inputs appear for the first page content. When disabled, `firstPage` is set to `undefined` and the first page uses the same header/footer as all other pages.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #6 **Files:**

- `src/components/editor/PageHeaderFooterEditor.tsx` — toggle UI + first page inputs
- `src/components/editor/extensions/page-breaks.ts` — conditional decoration content for first page

---

### #8 — Resolve variables in header/footer display ✅

**Description:** Implement variable resolution for header/footer content: `{page}` → current page number (from the page break decoration's page counter), `{pages}` → total page count (known after full layout), `{title}` → document title from frontmatter or filename, `{date}` → current date formatted as locale string. In the editor, `{pages}` shows as a literal `{pages}` placeholder (total count changes as user types). In exports, all variables are fully resolved.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #4 **Files:**

- `src/lib/page-settings.ts` — add `resolveVariables(template, context)` function
- `src/components/editor/extensions/page-breaks.ts` — pass page number context to header/footer decorations

---

### #9 — Add header/footer to PDF (Typst) export ✅

**Description:** When `DocumentPageSettings` is provided to `export_pdf`, generate Typst `#set page(header: ..., footer: ...)` rules with three-column layout using `grid` or `align`. Resolve variables: `{page}` → `counter(page).display()`, `{pages}` → `context counter(page).final().first()`, `{title}` → literal title string, `{date}` → `datetime.today().display()`. Handle `differentFirstPage` via Typst's `set page(header: context { ... })` conditional on page counter.

**Complexity:** M **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/export/templates.rs` — add header/footer generation to `generate_typst_styles()`
- `src-tauri/src/commands/export.rs` — pass page settings to the Typst generator

---

### #10 — Add header/footer to DOCX export ✅

**Description:** When `DocumentPageSettings` is provided to `export_docx`, create Word header and footer XML sections. Use `docx-rs` header/footer API to add three-column paragraphs (left-aligned, centered, right-aligned via tab stops). Resolve `{page}` → Word `PAGE` field, `{pages}` → `NUMPAGES` field, `{title}` → literal text, `{date}` → `DATE` field. Handle `differentFirstPage` via the Word `titlePg` section property.

**Complexity:** M **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/export/markdown_to_docx.rs` — add header/footer generation to the DOCX converter
- `src-tauri/src/commands/export.rs` — pass page settings to DOCX converter

---

### #11 — Add header/footer to HTML export ✅

**Description:** When `DocumentPageSettings` is provided to `render_html`, generate a CSS `@page` rule with `@top-left`, `@top-center`, `@top-right`, `@bottom-left`, `@bottom-center`, `@bottom-right` content strings. Resolve variables: `{page}` → `counter(page)`, `{pages}` → `counter(pages)`, `{title}` and `{date}` → literal strings. Add `@page :first` rules when `differentFirstPage` is true. Note: `@page` margin boxes have limited browser support — also render visible `<header>/<footer>` elements as fallback for screen viewing.

**Complexity:** S **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/export/markdown_to_html.rs` — add header/footer CSS generation
- `src-tauri/src/export/html_styles.rs` — base header/footer CSS rules

---

### #12 — Write tests for page constructs ✅

**Description:** Add tests covering:

1. Page settings frontmatter parsing: `page` key extraction, round-trip (parse → serialize → parse), missing key returns defaults, unknown keys preserved
2. Variable resolution: each variable resolves correctly, unknown variables pass through
3. Rust: page settings deserialization, Typst header/footer generation, DOCX field insertion
4. Markdown round-trip: frontmatter with `page` key survives parse → serialize cycle

**Complexity:** L **Category:** both **Dependencies:** Depends on #1, #2, #3, #9, #10, #11 **Files:**

- `src/lib/__tests__/page-settings.test.ts` — new: frontmatter parsing, variable resolution
- `src/lib/__tests__/frontmatter.test.ts` — extend with `page` key tests
- `src-tauri/src/export/page_settings.rs` — `#[cfg(test)]` module
- `src-tauri/src/export/templates.rs` — tests for header/footer Typst generation