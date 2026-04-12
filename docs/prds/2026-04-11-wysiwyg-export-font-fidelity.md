# PRD: WYSIWYG Export Fidelity — Browser-Based PDF, Per-Document Styling

|  |  |
| --- | --- |
| **Date** | 2026-04-11 (updated 2026-04-12) |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Exported PDFs look identical to the editor — true WYSIWYG with self-contained document styling |
| **Research** | [wysiwyg-export-fidelity](../research/2026-04-12-wysiwyg-export-fidelity.md) |

## Problem

Notesage is a WYSIWYG editor, but PDF export uses Typst — a completely different rendering engine from the editor's WebKit. This creates a permanent fidelity gap: different fonts, missing colors, wrong code themes, missing highlights, different layout. Every fix is a workaround (SVG preprocessing, font bundling, color mapping) that adds complexity without achieving parity.

The root cause isn't missing features in Typst — it's that **two different rendering engines can never produce identical output**. The industry solution (Obsidian, Typora, iA Writer, Bear, Craft) is simple: use the same rendering engine for both editing and export.

### What we're removing

The Typst PDF pipeline consists of:

- **~2,300 lines** of Rust code: `markdown_to_typst.rs` (1,319), `typst_world.rs` (234), `templates.rs` (776)
- **5 crate dependencies**: `typst`, `typst-pdf`, `typst-syntax`, `typst-library`, `typst-utils`
- **2 SVG preprocessing deps**: `usvg`, `resvg` (added to work around Typst's SVG text limitations)
- **1 font database dep**: `fontdb`
- **2.7MB bundled fonts**: Inter, Source Serif 4, JetBrains Mono (only needed because Typst can't access system fonts)
- **3 Typst template files**: `clean.typ`, `academic.typ`, `report.typ`
- **~200 lines** of SVG color resolution and text-to-paths preprocessing in `useExportOperations.ts`

All of this exists to bridge two rendering worlds. With browser-based PDF export, none of it is needed.

### What we're adding

One Tauri command that calls `WKWebView.createPDF()` on the HTML we already generate. The browser handles fonts, colors, charts, drawings, mermaid, code highlighting — everything. Plus per-document styling in YAML frontmatter for self-contained, distributable documents.

## Goals

1. **Pixel-perfect WYSIWYG PDF** — the exported PDF looks identical to the editor, because the same WebKit engine renders both
2. **Zero font configuration** — all system fonts, all web fonts (Excalidraw Virgil, etc.) work automatically
3. **Full styling preservation** — text colors, highlights, code themes, chart colors, drawing styles all export correctly
4. **Simplified codebase** — remove ~2,300 lines of Rust, 8 crate dependencies, and 2.7MB of bundled fonts
5. **Page layout control** — page size (A4/Letter/A5), margins, page breaks, optional headers/footers via CSS `@media print`
6. **Editor-visible TOC** — table of contents rendered in the editor as a WYSIWYG element, not generated at export time
7. **Self-contained documents** — per-document typography embedded in YAML frontmatter, so `.md` files carry their own styling and look the same everywhere

## Non-Goals

- **Windows/Linux PDF export** — macOS first via WKWebView; other platforms will use their respective WebView APIs (WebView2 `PrintToPdfAsync` on Windows) in a future phase
- **LaTeX/academic publishing features** — users who need LaTeX should use dedicated tools; Notesage is a writing app, not a typesetting system
- **PDF/A compliance** — archival PDF format is out of scope
- **Tagged/accessible PDF** — WKWebView's PDF output includes basic structure; full accessibility is future work
- **External CSS stylesheet reference** — `styleSheet: path/to/style.css` in frontmatter for power users; future feature
- **Style presets/themes** — "Academic", "Report", "Book" bundles that users can apply; future feature built on the `style:` frontmatter

## User Stories

1. As a user who set my editor to "System (SF Pro)" body with "Charter" headings, I want my exported PDF to use SF Pro and Charter — not a serif fallback.
2. As a user with text colors and highlights in my document, I want those to appear in the PDF.
3. As a user with inline charts, I want the chart colors and labels in the PDF to match the editor.
4. As a user with Excalidraw drawings, I want the handwritten font to look the same in the PDF.
5. As a user, I want to add a table of contents and see it in the editor before exporting.
6. As a user, I want to choose page size (A4/Letter) and have proper margins in my PDF.
7. As a user, I want to set typography for a specific document (e.g., Georgia body, centered uppercase H2s) and have that styling travel with the `.md` file when I share it or sync via iCloud.
8. As a user, I want to click "Save as document style" in the typography toolbar to embed my current settings into the frontmatter.

## Technical Approach

### New PDF export: WKWebView `createPDF()`

**Pipeline:**

```
User clicks Export PDF
  → Frontend serializes editor to markdown
  → Frontend calls render_html Tauri command (already exists)
  → Rust returns standalone HTML with embedded CSS
  → Frontend injects @media print CSS overrides (page size, margins)
  → New Tauri command loads HTML into offscreen WKWebView
  → Calls WKWebView.createPDF(configuration:completionHandler:)
  → Returns PDF bytes
  → Frontend shows save dialog, writes to disk
```

**Key detail:** The `render_html` command already exists and produces a complete, self-contained HTML document with all styling. We're reusing it. The only new Rust code is the `createPDF` bridge.

**WKWebView API (macOS 11+):**

The `createPDF` method already exists in wry's WKWebView bindings (`wry-0.54.2/src/wkwebview/ios/WKWebView.rs`). From Tauri, accessible via:

```rust
#[tauri::command]
async fn export_pdf_webkit(
    app: AppHandle,
    html: String,
    page_width: f64,   // points (A4 = 595.28)
    page_height: f64,  // points (A4 = 841.89)
) -> Result<Vec<u8>, String> {
    // Create offscreen WKWebView
    // Load HTML
    // Wait for load
    // Call createPDF
    // Return bytes
}
```

### Charts, drawings, and mermaid in HTML export

With the WebKit approach, the HTML preview already shows charts/drawings/mermaid correctly — the browser renders them natively. No SVG preprocessing, no color resolution, no text-to-paths needed.

For the `render_html` Rust command: embedded SVGs are inlined in the HTML. WebKit renders them with full CSS/font support.

### `@media print` CSS

Add print-specific CSS:

```css
@media print {
  @page {
    size: A4;  /* injected dynamically based on user selection */
    margin: 1in;
  }

  pre, table, .chart-block, .drawing-block, .mermaid-block, blockquote {
    break-inside: avoid;
  }

  h1, h2, h3, h4 { page-break-after: avoid; }

  p { orphans: 3; widows: 3; }
}
```

### Per-document style in frontmatter

Documents carry their own typography in YAML frontmatter — self-contained and distributable.

**Format:**

```yaml
---
title: Annual Report
style:
  page:
    size: A4
    margin: 2.5cm
  body:
    font: Georgia
    size: 10.5pt
    lineHeight: 1.45
    color: "#1a1a1a"
    textAlign: justify
  h1:
    font: Georgia
    size: 26pt
    weight: normal
    align: center
    pageBreakBefore: right
  h2:
    font: Georgia
    size: 12pt
    weight: normal
    textTransform: uppercase
    letterSpacing: 2pt
    align: center
  h3:
    font: Georgia
    size: 11pt
    weight: normal
    style: italic
  code:
    font: JetBrains Mono
    size: 9pt
  blockquote:
    style: italic
    color: "#333"
---
```

**How it works:**

1. When a document with a `style:` frontmatter block is opened, the editor applies those typography settings (overriding global presets for this document)
2. When exporting, the style block is converted to CSS and injected into the HTML before `createPDF` renders it
3. If no `style:` block exists, the editor's global typography presets apply (current behavior)

**CSS conversion mapping:**

| YAML field | CSS property |
| --- | --- |
| `font` | `font-family` |
| `size` | `font-size` |
| `weight` | `font-weight` |
| `lineHeight` | `line-height` |
| `color` | `color` |
| `textAlign` / `align` | `text-align` |
| `letterSpacing` | `letter-spacing` |
| `textTransform` | `text-transform` |
| `style` | `font-style` |
| `pageBreakBefore` | `page-break-before` |
| `margin` | `margin` (on `@page`) |

**Editor integration:**

- Typography toolbar reads from the document's `style:` frontmatter when present
- Changes via the toolbar write back to frontmatter
- "Save as document style" saves current global presets into frontmatter
- "Reset to global style" removes the `style:` block

### Table of Contents as editor feature

Instead of export-time generation, add a TOC as a **Tiptap extension** (`/toc` slash command):

- Renders as a live, clickable outline in the editor
- Updates automatically when headings change
- Exports as HTML — WebKit renders it in the PDF
- True WYSIWYG — the user sees the TOC before exporting

### What to remove

| Item | Files | Lines | Deps |
| --- | --- | --- | --- |
| Typst converter | `markdown_to_typst.rs` | 1,319 | — |
| Typst world | `typst_world.rs` | 234 | — |
| Typst templates | `templates.rs` (Typst parts) | ~400 | — |
| Typst template files | `src-tauri/templates/*.typ` | — | — |
| Bundled fonts | `src-tauri/fonts/` | — | 2.7MB |
| SVG text preprocessing | `preprocess_svg_text()` in `export.rs` | ~30 | — |
| SVG rasterization | `svg_to_png()` in `export.rs` | ~20 | — |
| Font resolution | `typography.rs` (most of it) | ~100 | — |
| Chart color resolution | `resolveChartColors()`, `oklchToHex()` in `useExportOperations.ts` | ~100 | — |
| Crate deps | — | — | `typst`, `typst-pdf`, `typst-syntax`, `typst-library`, `typst-utils`, `usvg`, `resvg`, `fontdb` |
| `export_pdf` command | Current Typst-based command | ~50 | — |

**Keep:**

- `render_html` command and `markdown_to_html.rs` — needed for the WebKit pipeline
- `html_styles.rs` — CSS for the HTML output
- `markdown_to_docx.rs` — DOCX export is separate
- `markdown_to_pptx.rs` — PPTX export is separate
- `export_docx`, `export_pptx` commands
- `ExportDialog.tsx` — simplified

### DOCX and PPTX

These formats have different expectations — editable documents, not pixel-identical PDFs.

**Preferred approach:** Capture charts/drawings as PNG on the **frontend** (browser Canvas) instead of Rust-side SVG rasterization. This removes `usvg`, `resvg`, and `fontdb` entirely:

```typescript
async function svgToPng(svgString: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  await new Promise((resolve) => { img.onload = resolve; img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  return new Uint8Array(await (await new Promise<Blob>((r) => canvas.toBlob(r!, "image/png"))).arrayBuffer());
}
```

## UI/UX

### Export Dialog changes

**Remove for PDF:**
- Template picker (Clean/Academic/Report) — no longer applicable
- "Include TOC" checkbox — TOC is now an editor feature

**Keep for PDF:**
- Page size (A4/Letter/A5)
- "Include page numbers" checkbox (via CSS `@page`)

**Keep for DOCX/PPTX:**
- All current options unchanged

### Export flow

1. User presses Cmd+Shift+E or clicks Export button
2. Export dialog appears with format tabs (PDF | Word | PowerPoint)
3. PDF tab shows: page size dropdown, page numbers checkbox
4. User clicks Export
5. Brief "Generating PDF..." loading state
6. Native save dialog appears
7. PDF saved to disk

## Dependencies

**New:**
- None — WKWebView is macOS built-in; Tauri's `with_webview` already provides access

**Removed:**
- `typst` (0.14.2), `typst-pdf`, `typst-syntax`, `typst-library`, `typst-utils`
- `usvg` (0.45), `resvg` (0.45), `fontdb` (0.23)

## Quality Gates

### Functional

- [ ] PDF export with default font (System/SF Pro) shows SF Pro text — not a serif fallback
- [ ] PDF export preserves text colors (colored headings, inline text color)
- [ ] PDF export preserves text highlights (all 6 highlight colors)
- [ ] PDF export preserves code block syntax highlighting with the editor's muted chromatic theme
- [ ] PDF export shows inline charts with correct colors and axis labels
- [ ] PDF export shows Excalidraw drawings with Virgil handwritten font
- [ ] PDF export shows mermaid diagrams
- [ ] PDF export respects page size selection (A4/Letter/A5)
- [ ] PDF export has proper margins (~1 inch)
- [ ] PDF export avoids breaking inside code blocks, tables, and charts
- [ ] Page numbers appear when the option is checked
- [ ] Document with `style:` frontmatter renders with those styles in the editor
- [ ] Document with `style:` frontmatter exports PDF with those styles
- [ ] "Save as document style" writes current typography to frontmatter
- [ ] "Reset to global style" removes `style:` block from frontmatter
- [ ] Document without `style:` block uses global typography presets (no regression)
- [ ] DOCX export continues to work (no regression)
- [ ] PPTX export continues to work (no regression)
- [ ] HTML preview continues to work (no regression)
- [ ] `pnpm test` — all tests pass
- [ ] `cargo test` — all remaining tests pass (Typst tests removed)
- [ ] `pnpm typecheck` — clean

### Design

- [ ] Export dialog is simplified for PDF (no template picker)
- [ ] Loading state during PDF generation is smooth
- [ ] Exported PDF is visually indistinguishable from the editor at a glance

### Performance

- [ ] PDF export completes in < 3 seconds for a 10-page document
- [ ] No increase in app binary size (net decrease from removing Typst + fonts)

## Out of Scope

- **Windows/Linux PDF export** — future phase using WebView2/WebKitGTK equivalents
- **PDF bookmarks** — WKWebView's createPDF doesn't generate bookmarks; future enhancement
- **Custom page headers/footers** — re-implement via CSS `@page` in a follow-up if needed
- **DOCX font fidelity** — DOCX uses system font names; minor improvements separately
- **External CSS stylesheet reference** — `styleSheet: path/to/style.css` in frontmatter; future feature
- **Style presets/themes** — "Academic", "Report", "Book" bundles; future feature built on `style:` frontmatter
