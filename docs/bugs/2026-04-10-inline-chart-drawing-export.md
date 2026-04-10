# Bug: Inline charts and drawings not included in PDF/DOCX/PPTX exports

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Severity** | Medium |
| **Status** | Open |
| **Affects** | PDF export (Typst), DOCX export (docx-rs), PPTX export (ppt-rs), HTML export |
| **Related** | [Inline Attachments PRD](../prds/2026-04-09-inline-attachments.md) |

## Problem

Charts and drawings stored as inline fenced code blocks (`` ```chart `` / `` ```excalidraw ``) are not rendered in any export format. The exported files show either placeholder text like `[Chart: Title]` or nothing at all. The Rust export pipeline (comrak-based) sees the fenced code blocks but has no way to render them as images — it can't execute JavaScript (recharts / Excalidraw).

Legacy sidecar-format charts/drawings continue to export correctly because they reference pre-rendered SVG files on disk.

## Root cause

The chart/drawing rendering is JavaScript-only:
- **Charts**: rendered by recharts (React) in the browser DOM
- **Drawings**: rendered by Excalidraw's `exportToSvg` in the browser

The Rust export backend parses markdown via comrak and encounters `NodeValue::CodeBlock` with `info == "chart"` or `info == "excalidraw"`. It has the JSON data but no JavaScript runtime to render it into SVG.

## Failed approaches

### 1. SVG file cache (`.notesage/cache/`)

Frontend writes rendered SVGs to `.notesage/cache/chart-{hash}.svg` keyed by SHA-256 of the JSON. Rust exporter looks up the cache file during export.

**Why it failed:**
- Hash mismatch between frontend (hashing `chartJson` attribute) and Rust (hashing `cb.literal` from comrak) — different whitespace, newlines
- Path resolution issues with iCloud projects (symlinks, `/private/` prefix normalization)
- Typst virtual filesystem (`NotesageWorld`) needs files explicitly registered — absolute disk paths don't work with `#image()`
- Timing dependency — cache must exist before export
- Added 500ms delay to every chart render for cache writes, degrading tab switching performance

### 2. Frontend markdown preprocessing (`prepareMarkdownForExport`)

Before calling export, frontend replaces `` ```chart `` blocks in the serialized markdown with `![Chart](data:image/svg+xml;base64,...)` images captured from the DOM.

**Why it failed:**
- The fenced block text in the serialized markdown must exactly match the pretty-printed JSON for the string replacement to work — fragile
- Data URIs not natively supported by Typst's `#image()` — need decoding and virtual file registration
- Added complexity to the export path (new return types, base64 crate dependency, Typst Converter struct changes)
- Still showed placeholder text in exported PDFs despite the preprocessing

## Design constraints

1. **Rust backend cannot run JavaScript** — no recharts, no Excalidraw `exportToSvg`
2. **Typst uses a virtual filesystem** — images must be registered via `world.add_file()`, not read from disk paths
3. **Charts are interactive React components** — their SVG only exists in the browser DOM after rendering
4. **Multiple export formats** — solution must work for PDF (Typst), DOCX (docx-rs), PPTX (ppt-rs), and HTML (comrak)
5. **No performance regression** — tab switching and editing must remain instant

## Possible approaches to explore

### A. Tauri command that captures SVGs before export

A dedicated Tauri command or frontend hook that:
1. Iterates all chart/drawing nodes in the current document
2. Captures rendered SVGs from the DOM (synchronously, at export time)
3. Passes them as a `HashMap<index, svg_bytes>` parameter to the export command
4. Rust exporter uses positional index to match code blocks to SVG data

Avoids: hash matching, filesystem caching, timing issues.
Risk: Positional matching between frontend node order and comrak AST walk order must be reliable.

### B. Frontend renders to PNG and embeds in markdown

Before export, convert each chart SVG to a PNG via Canvas API (already done for download-as-PNG), encode as base64, and embed as standard markdown images. All exporters already handle PNG images.

Avoids: SVG handling complexity, Typst virtual filesystem.
Risk: Image quality (rasterization), large markdown strings, data URI support in each exporter.

### C. Rust-native chart rendering

Implement a basic SVG chart renderer in Rust (bar, line, pie at minimum). Parse the chart JSON and generate SVG bytes directly, without JavaScript.

Avoids: All frontend-backend coordination issues.
Risk: Large implementation effort, feature parity with recharts (10 chart types), maintaining two rendering paths.

### D. Hybrid: export command receives SVG map

Add an `embedded_images: Option<Vec<(String, Vec<u8>)>>` parameter to each export command. Frontend collects SVGs at export time and passes them directly. Rust exporter receives pre-rendered images — no filesystem, no hashing.

The key insight from approach A: **collect at export time, pass directly, match by position**.

## Scope

- Affects all 10 chart types and all drawing types
- Affects all 4 export formats (PDF, DOCX, PPTX, HTML)
- Legacy sidecar format is unaffected (continues to work)
- Editor rendering is unaffected (inline charts/drawings display correctly)
