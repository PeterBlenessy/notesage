# WYSIWYG Export Fidelity

**Date:** 2026-04-12 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [wysiwyg-export-font-fidelity](../prds/2026-04-11-wysiwyg-export-font-fidelity.md) | Needs rewrite |
| Tasks | [wysiwyg-export-font-fidelity-tasks](../tasks/2026-04-11-wysiwyg-export-font-fidelity-tasks.md) | Needs rewrite |

Notesage is a WYSIWYG editor, but exported PDFs look different from the editor. Fonts, colors, highlights, code themes, and layout differ because the editor uses WebKit while PDF export uses Typst. This research investigates how the industry solves this and what our options are.

---

## Executive Summary

We attempted the browser-based PDF export approach (WKWebView) and reverted to Typst after discovering fundamental WebKit limitations. The key findings:

**Browser-based export (attempted 2026-04-12, reverted):** We successfully rendered charts, drawings, and mermaid diagrams in a Tauri WebviewWindow via `window.print()` with correct colors and fonts. However, **WebKit has no mechanism for repeating headers/footers on every printed page** — `position: running()`, `@page` margin boxes, `position: fixed` repeating, and `<thead>` repeating are all broken or unsupported in Safari/WKWebView. This is a deal-breaker for professional document export. Additionally, the print dialog is a user-facing black box with no programmatic control, output is non-deterministic, and the template system was lost entirely.

**Typst pipeline (restored):** Provides deterministic output, running headers/footers, templates, automated byte generation, and TOC support. The fidelity gap is real but addressable by: (1) feeding browser-captured PNGs of charts/drawings/mermaid into Typst, (2) loading system fonts into Typst's fontdb, and (3) mapping document `style:` frontmatter to Typst parameters.

**What we shipped from this investigation:**
- Per-document typography via `style:` YAML frontmatter (parse, apply in editor, "Save to Document" button)
- TOC Tiptap extension (`/toc` slash command, live-updating, clickable)
- svg-to-png utility for DOCX/PPTX embedded images
- Performance fixes: debounced editor serialization, targeted file tree refresh, Zustand selector optimization
- Slash command search improvements (word-start matching, scrollable menu, flip positioning)
- PDF viewer ReadableStream fix, file watcher binary file skip

---

## 1. How Other Editors Do It

### Obsidian (Electron)

Obsidian renders markdown to HTML in a webview, then uses **Electron's `printToPDF` API** to generate PDFs. CSS `@media print` rules control print-specific styling.

**Key insight:** Electron's Chromium (not Safari's WebKit) supports `@page` margin boxes since Chrome 131 — this is why Obsidian can do page numbers and headers. **Tauri on macOS uses WKWebView (Safari), which does NOT support these features.**

### Typora (Electron)

Same approach as Obsidian — Chromium `printToPDF`. Has the same advantage of Chrome's superior CSS Paged Media support.

### iA Writer (native macOS)

Uses HTML+CSS templates for PDF export via macOS's native WebKit print pipeline. **Does NOT have running headers/footers** — confirms the WebKit limitation.

### Bear (native macOS)

Exports via macOS native print system (WebKit). Simple output without headers/footers.

### Craft (native macOS)

Likely uses a custom rendering pipeline — their PDF output has features (headers, footers, page numbers) that WebKit alone cannot produce.

---

## 2. WebKit CSS Paged Media Limitations (Tested 2026-04-12)

These features are **NOT supported** in Safari/WKWebView:

| Feature | Status in Safari | Works in Chrome |
| --- | --- | --- |
| `position: running()` + `content: element()` | Not implemented | Not implemented (needs Prince/WeasyPrint) |
| `@page` margin boxes (`@top-center`, etc.) | Not implemented | Chrome 131+ |
| `position: fixed` repeating on every page | Only renders on first page (bug since 2006) | Works |
| `<thead>` repeating on every page | Broken since 2009 (WebKit bug #34218) | Works |
| `@page { size }` | Works | Works |
| `break-before: page` | Works | Works |
| `break-inside: avoid` | Works | Works |

**Conclusion:** Any Tauri app on macOS that needs repeating headers/footers in PDF export **cannot rely on WebKit's print pipeline**. A typesetting engine (Typst, LaTeX, WeasyPrint) or Chromium-based solution is required.

---

## 3. Browser-Based Export — What Worked and What Didn't

### What worked

- Charts (Recharts) rendered with correct colors after CSS variable resolution (oklch→hex via Canvas getImageData)
- Excalidraw drawings rendered correctly (self-contained SVGs)
- Mermaid diagrams rendered correctly
- Editor fonts carried through (same WebKit engine)
- `print-color-adjust: exact` preserved background colors in print
- Recharts responsive container sizing fixed (copy offsetWidth/offsetHeight from live DOM)
- `break-inside: avoid` prevented charts/tables from splitting across pages

### What didn't work

- **No repeating headers/footers** — attempted: reuse editor's Print Layout decorations with `break-before: page`, inline all CSS styles to override editor styles. Failed because the editor's page break positions are calculated for the editor's viewport dimensions, not the print page dimensions. WebKit re-paginates content differently.
- **Non-deterministic output** — user must interact with the macOS print dialog manually
- **No programmatic save** — can't save PDF bytes directly; depends on "Save as PDF" in the dialog
- **Print window management** — no callback for when the print dialog closes; window stays open
- **Template system lost** — no Clean/Academic/Report templates possible with pure CSS

---

## 4. Recommended Path Forward

### Keep Typst as the PDF engine

Typst provides everything WebKit cannot: deterministic output, running headers/footers, templates, automated byte generation, and professional typesetting.

### Fix the fidelity gaps in Typst

| Gap | Solution |
| --- | --- |
| Charts/drawings/mermaid missing | Frontend Canvas capture → PNG bytes → embed in Typst (same approach already working for DOCX/PPTX via `collectEmbeddedImages`) |
| System fonts not available | Load system fonts into Typst's fontdb at startup (macOS font directories: `/System/Library/Fonts`, `~/Library/Fonts`) |
| Document `style:` not applied | Map `DocumentStyle` frontmatter to Typst template parameters (font-family, font-size, line-height, etc.) |
| Editor highlight colors missing | Map highlight mark colors to Typst `highlight()` function |
| Text colors missing | Map text color marks to Typst `text(fill: ...)` |

### Per-document styling (already implemented)

The `style:` YAML frontmatter system is working in the editor. Next step: feed these values into the Typst export pipeline via `typography.rs`.

---

## Comparison (Updated After Testing)

| Criterion | WKWebView (tested) | Typst + improvements | 
| --- | --- | --- |
| Font fidelity | Perfect | Good — needs system font loading |
| Color fidelity | Perfect | Needs color mark export |
| Charts/drawings | Perfect (native browser) | Good — PNG capture from frontend |
| Headers/footers | **Impossible** in Safari | Full support |
| Page numbers | **Not possible** in Safari | Full support |
| TOC in export | Not possible with CSS alone | Native `#outline()` |
| Templates | Not possible | Full template system |
| Deterministic output | No (user dialog) | Yes (bytes returned) |
| Programmatic save | No | Yes |
| Cross-platform | macOS only | Cross-platform |

## Open Questions

- How much of a fidelity gap remains after loading system fonts + embedding chart PNGs in Typst?
- Should chart/drawing PNGs be captured at 2x or 3x DPI for print quality?
- Can Typst load fonts lazily (on first use) to avoid slow startup with large font directories?
- Should `style:` frontmatter map 1:1 to Typst parameters, or should we keep an abstraction layer?

## Sources

- [WebKit bug #34218 — THEAD doesn't repeat when printed](https://bugs.webkit.org/show_bug.cgi?id=34218)
- [Safari position:fixed print bug — Apple Discussions](https://discussions.apple.com/thread/250930920)
- [Chrome 131: @page margin box support](https://developer.chrome.com/blog/print-margins)
- [MDN browser-compat-data #23178 — Safari @page margins](https://github.com/mdn/browser-compat-data/issues/23178)
- [Apple WKWebView createPDF documentation](https://developer.apple.com/documentation/webkit/wkwebview/createpdf(configuration:completionhandler:))
- [Typst font loading — system fonts](https://forum.typst.app/t/how-to-reference-custom-fonts/2687)
