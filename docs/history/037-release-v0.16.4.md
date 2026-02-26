# Release v0.16.4

**Date:** 2026-02-26
**Previous version:** 0.16.3

## Changes

### Features
- Editor typography settings: configurable font family, font size, line height, and paragraph spacing via toolbar popover
- 14 curated font presets across sans-serif (System/SF Pro, Helvetica Neue, Avenir Next, Inter), serif (Source Serif 4, Georgia, Palatino, Baskerville, Charter, Times New Roman), and monospace (JetBrains Mono, SF Mono, Menlo, Courier New)
- Font dropdown renders each option in its own typeface for live preview
- Typography settings persisted to disk (`~/Notesage/.notesage/editor-styles.json`) for iCloud sync
- Reset to defaults button in typography popover

### Improvements
- Replaced hardcoded editor CSS values with CSS custom properties (`--editor-font-family`, `--editor-font-size`, `--editor-line-height`, `--editor-paragraph-spacing`)
- Typography changes apply immediately without restart

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Version bump 0.16.3 → 0.16.4 |
| `src/stores/editor-styles-store.ts` | **New** — disk-persisted typography store with 14 font presets |
| `src/styles/editor.css` | CSS custom properties for font-family, font-size, line-height, paragraph-spacing |
| `src/components/editor/Editor.tsx` | Apply typography CSS variables from store |
| `src/components/editor/Toolbar.tsx` | Typography popover with font dropdown, sliders, reset |
| `src/App.tsx` | Load editor styles on startup |
| `docs/prds/2026-02-26-editor-typography.md` | **New** — PRD for editor typography settings |
