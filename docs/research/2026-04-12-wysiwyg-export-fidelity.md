# WYSIWYG Export Fidelity

**Date:** 2026-04-12 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [wysiwyg-export-font-fidelity](../prds/2026-04-11-wysiwyg-export-font-fidelity.md) | Draft |
| Tasks | [wysiwyg-export-font-fidelity-tasks](../tasks/2026-04-11-wysiwyg-export-font-fidelity-tasks.md) | Not started (12 tasks) |

Notesage is a WYSIWYG editor, but exported PDFs look nothing like the editor. Fonts, colors, highlights, code themes, and layout all differ. This research investigates how the industry solves this and what our options are.

---

## Executive Summary

There are two fundamentally different approaches to PDF export in desktop editors:

**Approach A: Browser-based (WebKit/Chromium print-to-PDF**)Used by: Obsidian, iA Writer, Bear, Typora, CKEditor, Notion (web). The editor renders HTML+CSS in a WebView, and the same rendering engine produces the PDF via `@media print` CSS rules. **This gives near-perfect WYSIWYG fidelity by definition** — the same engine renders both screen and print.

**Approach B: Typesetting engine (Typst, LaTeX, WeasyPrint**)Used by: Academic tools, Quarto, our current Notesage pipeline. Markdown is converted to a typesetting language, which produces the PDF with its own text engine. **WYSIWYG fidelity requires painstaking synchronization** between the browser's rendering and the typesetting engine's rendering — different font metrics, different layout algorithms, different color models.

**Our current approach (B) is the root cause of the fidelity gap.** We convert markdown → Typst markup → PDF. Typst uses its own font book (3 bundled families), its own layout engine, and its own styling. The editor uses WebKit with CSS. These are two completely different rendering worlds.

**The recommended path is a hybrid:** Use WKWebView's native `createPDF()` API for WYSIWYG export (pixel-perfect), and keep Typst as an optional "typeset" export for users who want professional publishing features (TOC, academic templates, page numbers). This gives us perfect fidelity for the common case and professional output for the advanced case.

---

## 1. How Other Editors Do It

### Obsidian (Electron)

Obsidian renders markdown to HTML in a webview, then uses **Electron's** `printToPDF` **API** to generate PDFs. CSS `@media print` rules control print-specific styling. The "Better Export PDF" community plugin enhances this with headers/footers/bookmarks.

**Key insight:** The same rendering engine (Chromium) that shows the editor also produces the PDF. Fonts, colors, and layout match automatically.

### Typora (Electron)

Typora uses the same approach — renders to HTML/CSS in an Electron webview, then prints to PDF. It also supports exporting via Pandoc for formats like DOCX and LaTeX.

### iA Writer (native macOS)

iA Writer uses **HTML+CSS templates** for PDF export. Templates are web pages (HTML, CSS, JavaScript) that receive the markdown-converted-to-HTML content. PDF rendering uses macOS's native WebKit print pipeline. Users can create custom templates with `@media print` CSS.

**Key insight:** Even a native macOS app uses WebKit for PDF rendering, not a custom typesetting engine.

### Bear (native macOS)

Bear exports to PDF via macOS's native print system, which uses WebKit rendering. The editor's styles map directly to the PDF output.

### Craft (native macOS)

Craft exports to PDF with high fidelity. As a native Swift app, it likely uses `WKWebView.createPDF()` or `NSPrintOperation`.

### Notion (web)

Notion uses browser print (`window.print()` / `File → Print → Save as PDF`). The browser's rendering engine produces the PDF. Third-party tools exist to improve the output.

### CKEditor / Froala (web editors)

These WYSIWYG editors collect the editor's HTML content and CSS, then send it to an HTML-to-PDF service (CKEditor uses a commercial converter). They acknowledge that perfect matching between editor and PDF is difficult but achievable with configuration.

---

## 2. Rendering Engine Options for Notesage

### Option A: WKWebView `createPDF()` (Browser-based)

**How it works:**

1. Render the document as HTML+CSS in a hidden or offscreen WKWebView
2. Apply `@media print` CSS for page layout, margins, headers/footers
3. Call `WKWebView.createPDF(configuration:completionHandler:)` — available since macOS 11
4. Receive PDF bytes directly

**Tauri integration:**

- The `createPDF` method already exists in wry's WKWebView bindings (`wry-0.54.2/src/wkwebview/ios/WKWebView.rs`)
- Tauri's `with_webview` API provides access to the native WKWebView via `objc2_web_kit::WKWebView`
- Can load HTML into a dedicated offscreen webview, apply print CSS, and call `createPDF`

| Attribute | Details |
| --- | --- |
| **Fidelity** | Near-perfect — same WebKit engine renders both editor and PDF |
| **Fonts** | Uses all system fonts + any web fonts loaded in the page — no bundling needed |
| **Colors/highlights** | Exact match — CSS variables resolve identically |
| **Code themes** | Exact match — same syntax highlighting CSS |
| **Charts/drawings** | Rendered by the browser — Recharts, Excalidraw, mermaid all work natively |
| **Dependencies** | None — WKWebView is macOS built-in |
| **Performance** | Fast — WebKit PDF rendering is optimized |
| **Limitations** | macOS only (need WebView2 equivalent on Windows); limited control over PDF structure (no tagged PDF, limited bookmark control) |

### Option B: Typst (Current approach)

**How it works:**

1. Convert markdown to Typst markup via comrak AST walk
2. Apply template styles (font, size, spacing)
3. Compile Typst to PDF with bundled fonts

| Attribute | Details |
| --- | --- |
| **Fidelity** | Poor — different rendering engine, different fonts, different layout |
| **Fonts** | Only 3 bundled families; system fonts require explicit loading into fontdb |
| **Colors/highlights** | Not implemented — Typst markup doesn't carry color info from the editor |
| **Code themes** | Different — Typst uses its own syntax highlighting |
| **Charts/drawings** | Requires SVG preprocessing, font substitution, color resolution (all the work done this session) |
| **Dependencies** | typst, typst-pdf crates (\~large compile-time deps) |
| **Performance** | Fast compilation |
| **Strengths** | Professional typesetting features: TOC, academic templates, page numbers, header/footer, precise typography control |

### Option C: WeasyPrint / headless browser (Python/external process)

Not viable for a Tauri desktop app — requires Python runtime or spawning a browser process.

### Option D: Hybrid (recommended)

Combine A and B:

- **Default export ("Export as PDF"):** Use WKWebView `createPDF()` for WYSIWYG fidelity
- **Advanced export ("Typeset PDF"):** Keep Typst for users who want academic/report templates with TOC, page numbers, and professional layout

This respects both use cases: most users want their document to look like the editor; power users want typesetting features.

---

## 3. WKWebView `createPDF()` — Technical Feasibility

### API availability

```swift
// Available since macOS 11 (Big Sur), iOS 14
@available(macOS 11.0, *)
func createPDF(
    configuration: WKPDFConfiguration?,
    completionHandler: @escaping (Result<Data, Error>) -> Void
)
```

`WKPDFConfiguration` allows specifying a `rect` to capture (default: full page).

### Tauri/wry access

The binding already exists in wry 0.54:

```
wry-0.54.2/src/wkwebview/ios/WKWebView.rs:
    pub unsafe fn createPDFWithConfiguration_completionHandler(...)
```

From Tauri, accessible via:

```rust
#[cfg(target_os = "macos")]
webview.with_webview(|wv| unsafe {
    let view: &objc2_web_kit::WKWebView = &*wv.inner().cast();
    // Call createPDF here
});
```

### Implementation approach

1. Create a dedicated offscreen `WKWebView` (not the main editor webview)
2. Generate the full HTML document (using our existing `render_html` command — it already produces standalone HTML with embedded CSS)
3. Load the HTML into the offscreen webview
4. Wait for load completion
5. Call `createPDF` with appropriate configuration
6. Return PDF bytes to the frontend via Tauri command

### What we get for free

- All system fonts (SF Pro, Georgia, Charter, etc.) — WebKit knows them all
- All web fonts loaded via `@font-face` in our CSS — Excalidraw's Virgil, chart fonts
- CSS variables resolve correctly — `var(--color-border)` just works
- Text colors, highlights, code syntax themes — all from the same CSS
- Charts and drawings — if we embed SVGs inline in the HTML, WebKit renders them with full CSS/font support
- Dark mode support — apply the correct CSS class before rendering

### What requires work

- `@media print` CSS: page margins, page breaks, header/footer positioning
- Charts/drawings: our `render_html` already handles embedded SVGs in HTML output
- TOC generation: CSS-based (can use CSS counters or JavaScript in the webview)
- Page numbers: `@page { @bottom-center { content: counter(page); } }` — standard CSS Paged Media

---

## 4. What About DOCX and PPTX?

The WYSIWYG question is primarily about PDF. DOCX and PPTX have different expectations:

**DOCX:** Users expect the document to be editable in Word, not pixel-identical to the editor. Font names matter (so Word uses the right font), but layout differences are expected. Our current approach (comrak → docx-rs) is appropriate.

**PPTX:** Slides have their own layout conventions. Charts and drawings as images are fine. Our current approach (comrak → ppt-rs) is appropriate.

**HTML:** Already WYSIWYG by nature — it's the same rendering engine. Our `render_html` is the correct approach.

---

## Comparison

| Criterion | WKWebView `createPDF` | Typst (current) | Hybrid (recommended) |
| --- | --- | --- | --- |
| Font fidelity | Perfect — system + web fonts | Poor — 3 bundled families | Perfect for default; good for typeset |
| Color fidelity | Perfect — same CSS | Missing — colors not exported | Perfect for default |
| Layout fidelity | Near-perfect | Different engine | Near-perfect for default |
| Code highlighting | Exact match | Different theme | Exact match for default |
| Charts/drawings | Native browser rendering | Requires SVG preprocessing | Native for default |
| TOC support | CSS-based (limited) | Native Typst `#outline()` | Both available |
| Header/footer | CSS Paged Media | Native Typst | Both available |
| Academic templates | Not applicable | Full Typst template system | Typst path for advanced |
| Platform support | macOS only (for now) | Cross-platform | macOS default, Typst fallback |
| New dependencies | None | Already in use | None new |
| Implementation effort | Medium (new Tauri command, print CSS) | Large (fix all font/color/layout gaps) | Medium |
| Maintenance | Low — WebKit handles everything | High — must sync two rendering worlds | Low |

## Recommendation

**Phase 1: WKWebView PDF export (default**)Replace the default PDF export with WKWebView `createPDF()`. This immediately solves fonts, colors, highlights, code themes, charts, and drawings — all in one shot. No font bundling, no color mapping, no SVG preprocessing needed.

The existing `render_html` Tauri command already produces a full standalone HTML document with embedded CSS. Load that HTML into an offscreen WKWebView, call `createPDF`, done.

**Phase 2: Print CSS polish**Add `@media print` CSS rules for page margins, page breaks (avoid breaking inside code blocks, tables, charts), and optionally headers/footers/page numbers using CSS Paged Media.

**Phase 3: Keep Typst as "Typeset PDF**"Rename the current Typst export to "Typeset PDF" or move it to an advanced option. Users who want academic formatting, custom templates, and professional typesetting can still use it. Fix the font loading (load system fonts into Typst) as a quality improvement, but don't chase pixel-perfect fidelity — that's what the WebKit path is for.

## Open Questions

- Does `WKPDFConfiguration` support setting page size (A4 vs Letter)? Need to verify.
- Can we add page numbers via CSS `@page` rules in WKWebView? Safari has limited CSS Paged Media support.
- Should we create a new offscreen webview per export, or reuse one? Performance vs resource tradeoff.
- How do we handle the Typst-specific features (TOC, templates) in the WebKit path? Some may not be achievable with CSS alone.
- Windows equivalent: WebView2 has `PrintToPdfAsync` — similar approach possible but needs separate implementation.

## Sources

- [Obsidian Better Export PDF — rendering pipeline](https://deepwiki.com/l1xnan/obsidian-better-export-pdf/5.4-templates-and-styling)
- [iA Writer Templates — HTML/CSS-based](https://github.com/iainc/iA-Writer-Templates)
- [Apple WKWebView createPDF documentation](https://developer.apple.com/documentation/webkit/wkwebview/createpdf\(configuration:completionhandler:\))
- [Tauri wry issue #707 — print webview to PDF](https://github.com/tauri-apps/wry/issues/707)
- [Tauri issue #12284 — programmatic PDF generation](https://github.com/tauri-apps/tauri/issues/12284)
- [resvg unsupported features — font-face not supported](https://github.com/linebender/resvg/blob/main/docs/unsupported.md)
- [resvg issue #541 — embedded fonts via @font-face blocked](https://github.com/linebender/resvg/issues/541)
- [Typst font loading — system fonts, font-path, embedded fonts](https://forum.typst.app/t/how-to-reference-custom-fonts/2687)
- [CKEditor PDF export approach](https://ckeditor.com/blog/How-to-print-WYSIWYG-editor-content-to-PDF-Export-to-PDF-feature-released/)
- [Typora export documentation](https://support.typora.io/Export/)