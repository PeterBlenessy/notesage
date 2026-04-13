# Release v0.32.0

**Date:** 2026-04-12
**Previous version:** 0.31.0

## Changes

### Features
- Per-document typography via `style:` YAML frontmatter — font, size, weight, lineHeight, color, alignment for body, headings, code, blockquote. Editor applies document styles on open, persists via "Save to Document" toolbar action
- Table of Contents Tiptap extension — `/toc` slash command inserts live-updating clickable outline of H1-H3 headings, round-trips as `<!-- toc -->` in markdown
- Slash command search now matches word starts and collapsed titles (e.g., `/toc` matches "Table of Contents")
- Slash command menu scrollable with max height and flips upward near bottom of page

### Fixes
- **Critical: Vite reload loop** — Tailwind v4 scanned the entire project for class names by default; any `.md` file change triggered a full page reload. Fixed with `source(none)` directive and Vite watcher ignore list
- **Critical: Editor typing performance** — restored individual Zustand selectors in Editor.tsx (destructured store subscriptions caused full re-renders on every keystroke). Debounced `getMarkdownFromEditor` to 150ms. File watcher tree refresh now targets affected directory only (was refreshing all 10 sections / 682 files taking ~2s)
- PDF viewer ReadableStream error suppressed (WKWebView compatibility)
- File watcher skips binary file extensions (PDF, DOCX, PPTX, etc.) to prevent UTF-8 read errors
- Stabilized `useActiveProject` hook — uses filePath selector instead of subscribing to full tabs array

### Reverted
- Browser-based PDF export (WKWebView `window.print()`) — reverted to Typst pipeline. WebKit cannot repeat headers/footers on printed pages (`position: running()`, `@page` margin boxes, `position: fixed` repeating, `<thead>` repeating all unsupported in Safari)

### Documentation
- Updated research doc with WebKit CSS Paged Media test results and corrected recommendation
- Updated PRD to focus on Typst improvements (system fonts, chart PNGs, style mapping) instead of browser-based export
- Updated task breakdown — 6 tasks complete, 5 remaining

## Files Changed
- ~50 files changed across frontend, backend, and documentation
- Typst pipeline restored (markdown_to_typst.rs, typst_world.rs, templates, bundled fonts)
- New: `src/components/editor/extensions/toc.ts`, `src/lib/frontmatter.ts` (DocumentStyle types)
- Modified: `src/hooks/useEditor.ts`, `src/hooks/useFileWatcher.ts`, `src/components/editor/Editor.tsx`, `src/styles/globals.css`, `vite.config.ts`
