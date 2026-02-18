# Release v0.8.0

**Date:** 2026-02-18
**Previous version:** 0.7.0

## Changes

### Features
- PDF export via embedded Typst 0.14 typesetting engine
- Three export templates: Clean (sans-serif, Inter), Academic (serif, Source Serif 4), Report (title page + ToC)
- Page size options: A4, Letter, A5
- Table of contents and page numbers toggles
- Export triggers: Cmd+Shift+E keyboard shortcut, toolbar button, sidebar context menu ("Export as PDF" on .md files)
- Native save dialog for PDF output
- Export settings persistence between sessions (template, page size, ToC, page numbers)
- Bundled OFL-licensed fonts: Inter, Source Serif 4, JetBrains Mono (~2.7MB)
- Markdown-to-Typst converter via comrak GFM parser (headings, lists, tables, code blocks, blockquotes, images, links, task lists, horizontal rules, formatting)

### Improvements
- Consolidated documentation: merged phase-1-spec.md and future-phases.md into product-description.md
- Slimmed CLAUDE.md by removing duplicated content

### Tests
- 18 integration tests covering all template/page-size combinations, edge cases (empty doc, unicode, large tables, long code blocks, special characters), and PDF structure validation

## Architecture

New Rust export module (`src-tauri/src/export/`):
- `markdown_to_typst.rs` — Markdown to Typst markup conversion via comrak
- `templates.rs` — Template loading and parameterization
- `typst_world.rs` — Custom Typst `World` trait implementation with bundled fonts
- `integration_tests.rs` — Comprehensive test suite

New Tauri commands:
- `export_pdf` — Compile markdown to PDF bytes
- `save_binary_file` — Write binary data to disk

New frontend:
- `ExportDialog.tsx` — Export options dialog (template, page size, ToC, page numbers)
- `useExportOperations.ts` — Export flow orchestration hook

## Files Changed
- 26 files changed across 4 commits
