# Release v0.31.0

**Date:** 2026-04-10
**Previous version:** 0.30.3

## Changes

### Features

- **Inline attachments** — Charts and drawings are now embedded as fenced code blocks (`` ```chart `` / `` ```excalidraw ``) directly in the markdown file. Files are fully portable — copy a `.md` and all charts/drawings render without sidecar files or project registration.
  - `chartJson` / `drawingJson` attributes on Tiptap extensions with fenced code block serializers
  - `ChartNodeView` reads inline JSON synchronously — no async IPC loading, no project root needed
  - `DrawingPreview` / `DrawingEditor` read/write via ProseMirror transactions
  - Auto-migration: existing sidecar charts/drawings convert to inline format on open
  - Legacy sidecar format (`.notesage/charts/`, `.notesage/drawings/`) still supported as fallback
  - 12 new parser tests, 2 round-trip test fixtures
  - `insert-chart` skill updated to write fenced code blocks (no filesystem operations needed)
  - Known limitation: export of inline charts/drawings to PDF/DOCX/PPTX not yet implemented (tracked in `docs/bugs/2026-04-10-inline-chart-drawing-export.md`)

- **Chart feature expansion** — 4 new chart types (scatter, radial bar, composed, horizontal bar), multi-series data editing, chart annotations, reference lines, data labels, tick formatting, and editor UX improvements

- **Auto-grow chat textarea** — Chat input grows up to 30% of panel height as content is typed

### Improvements

- Suppress React 19 `flushSync` dev-mode warning from Tiptap's `ReactNodeViewRenderer` (upstream issue tiptap#3764)
- Deprecation notices on `chart-storage.ts` and `drawing-storage.ts` sidecar modules

### Dependencies

- Bump vite (security update via Dependabot)

## Files Changed

- 21 files changed across 5 commits (inline attachments, chart expansion, chat UX, dependency update)
