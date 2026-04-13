# PRD: Export Fidelity — Typst Improvements + Per-Document Styling

|  |  |
| --- | --- |
| **Date** | 2026-04-11 (updated 2026-04-12) |
| **Status** | Draft (revised after browser-based export attempt) |
| **Priority** | High |
| **Impact** | Exported PDFs include charts/drawings with correct fonts and colors, and respect per-document styling |
| **Research** | [wysiwyg-export-fidelity](../research/2026-04-12-wysiwyg-export-fidelity.md) |

## Problem

PDF export via Typst is missing charts, drawings, and mermaid diagrams entirely. Font choices from the editor don't carry through because Typst only has 3 bundled font families. Per-document typography settings have no effect on exports.

### What we tried and reverted

We attempted replacing Typst with browser-based PDF export (WKWebView `window.print()`). While charts/drawings rendered correctly, **WebKit has no mechanism for repeating headers/footers on every printed page** (Safari doesn't support `@page` margin boxes, `position: running()`, or `position: fixed` repeating). The print dialog is also non-deterministic and provides no programmatic control. We reverted to Typst.

### What we keep from that investigation

- **Per-document `style:` frontmatter** (implemented) — parse, apply in editor, "Save to Document" button
- **TOC Tiptap extension** (implemented) — `/toc` slash command, live-updating
- **svg-to-png utility** (implemented) — frontend Canvas capture for DOCX/PPTX
- **Performance fixes** (implemented) — debounced serialization, targeted tree refresh, Zustand selectors

### What still needs to be done

1. Feed chart/drawing/mermaid PNGs into the Typst pipeline (same approach already working for DOCX/PPTX)
2. Load system fonts into Typst's fontdb so editor font choices carry through
3. Map `style:` frontmatter to Typst template parameters
4. Export text colors and highlights via Typst markup

## Goals

1. **Charts, drawings, mermaid in PDF** — embedded as PNG images captured from the browser
2. **System font support** — Typst loads fonts from macOS font directories so editor font choices work
3. **Per-document styling in export** — `style:` frontmatter mapped to Typst parameters
4. **Color export** — text colors and highlights preserved in Typst output
5. **Keep existing strengths** — templates, headers/footers, page numbers, deterministic output, TOC

## Non-Goals

- Browser-based PDF export (attempted and reverted — WebKit limitations are a deal-breaker)
- Pixel-perfect match between editor and PDF (different engines; aim for "visually faithful")
- Custom CSS stylesheets in frontmatter (future feature)
- Style preset themes (future feature built on `style:` frontmatter)

## User Stories

1. As a user with inline charts in my document, I want them to appear in the exported PDF
2. As a user who chose "Georgia" as my body font, I want the PDF to use Georgia — not a fallback
3. As a user who embedded typography in my document's frontmatter, I want the PDF to respect those settings
4. As a user with Excalidraw drawings, I want them to appear in the PDF with correct fonts
5. As a user with text colors and highlights, I want those to appear in the PDF

## Technical Approach

### 1. Chart/drawing/mermaid PNG capture (frontend → Typst)

The `collectEmbeddedImages()` utility already captures DOM elements as PNGs for DOCX/PPTX. Extend this to also run for PDF export:

```
User clicks Export PDF
  → Frontend calls collectEmbeddedImages() — captures chart/drawing/mermaid SVGs as PNGs via Canvas
  → Frontend sends markdown + PNG bytes to export_pdf Tauri command
  → Rust inserts PNGs at chart/drawing/mermaid code block positions in the Typst markup
  → Typst compiles to PDF with embedded images
```

### 2. System font loading

Load macOS system fonts into Typst's fontdb at startup or on first export:

- `/System/Library/Fonts/` — system fonts (SF Pro, Helvetica, etc.)
- `/Library/Fonts/` — system-wide additional fonts
- `~/Library/Fonts/` — user fonts

The existing `shared_fontdb()` function in `export.rs` already loads bundled fonts. Extend it to also scan system font directories.

### 3. Document style → Typst parameters

Map `DocumentStyle` from frontmatter to Typst's `#set text()`, `#set par()`, and `#show heading` rules:

| Frontmatter | Typst |
| --- | --- |
| `body.font: Georgia` | `#set text(font: "Georgia")` |
| `body.size: 10.5pt` | `#set text(size: 10.5pt)` |
| `body.lineHeight: 1.45` | `#set par(leading: 0.45 * 10.5pt)` |
| `h1.font: Helvetica` | `#show heading.where(level: 1): set text(font: "Helvetica")` |
| `h1.size: 26pt` | `#show heading.where(level: 1): set text(size: 26pt)` |

### 4. Color export

Map editor text color and highlight marks to Typst:

- Text color: `#text(fill: rgb("#xx"))[]`
- Highlight: `#highlight(fill: rgb("#xx"))[]`

## Dependencies

No new dependencies. Uses existing Typst pipeline + existing `collectEmbeddedImages` utility.

## Quality Gates

### Functional

- [ ] PDF export includes inline charts as images
- [ ] PDF export includes Excalidraw drawings as images
- [ ] PDF export includes mermaid diagrams as images
- [ ] PDF uses the editor's body font when it's a system font (e.g., Georgia, Helvetica)
- [ ] PDF uses the editor's heading font
- [ ] Document with `style:` frontmatter exports with those styles
- [ ] Text colors preserved in PDF
- [ ] Text highlights preserved in PDF
- [ ] Existing features unchanged: templates, TOC, page numbers, headers/footers
- [ ] DOCX export unchanged (no regression)
- [ ] PPTX export unchanged (no regression)
- [ ] `pnpm test` passes
- [ ] `cargo test` passes

### Already Completed

- [x] Per-document `style:` frontmatter parsing and editor application
- [x] "Save to Document" / "Reset" toolbar actions
- [x] TOC Tiptap extension
- [x] svg-to-png utility for DOCX/PPTX
- [x] Performance: debounced serialization, targeted tree refresh, Zustand selectors
- [x] Slash command improvements (search, scroll, flip)
- [x] PDF viewer ReadableStream fix
- [x] File watcher binary file skip

## Out of Scope

- Browser-based PDF export (investigated and reverted)
- Windows/Linux font loading (macOS first)
- External CSS stylesheet reference in frontmatter
- Style preset themes
