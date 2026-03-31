# Release v0.27.0

**Date:** 2026-03-31
**Previous version:** 0.26.0

## Changes

### Features
- Add PPTX viewer — slide-by-slide PowerPoint viewing with text, images, shapes, tables, charts (via recharts), gradient fills, groups, speaker notes, SmartArt fallbacks, cross-slide search, zoom, and fit modes
- Add PPTX export — markdown to presentation slides via ppt-rs with built-in and user-uploaded templates
- Add DOCX export — markdown to Word documents with templates, tables, and images
- Add HTML preview & export — markdown to styled HTML with full feature parity, theme-reactive iframe, clipboard copy
- Add chat message resend & edit — one-click resend or edit-and-resend any user message with branching
- Add ACP agent automatic recovery — detect agent hangs, reconnect, and graceful quit
- Upgrade DOCX viewer — docx-preview with zoom, page breaks, and PDF-like toolbar

### Improvements
- Add rich link preview cards — OG metadata fetch, card UI, paste detection, PDF export
- Add dynamic table enhancements — column types, aggregation footer, sorting, filtering, sparklines
- Update docs — feature docs, PRDs, research, and task breakdowns
- Add PRDs and task breakdowns for DOCX export, PPTX viewer, and chat message resend/edit
- Add research: document format enhancements — DOCX, PPTX, templates, HTML, code highlighting

## Files Changed
- 16 commits since v0.26.0
- Key new files: pptx-parser.ts, pptx-types.ts, PptxViewer.tsx, plus DOCX/HTML/PPTX export modules
