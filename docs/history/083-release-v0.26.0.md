# Release v0.26.0

**Date:** 2026-03-29
**Previous version:** 0.25.0

## Changes

### Features
- Add inline charts — six chart types (bar, line, area, pie, donut, horizontal bar) with visual editor, sidecar storage, and PDF export
- Add drawing canvas foundation — Excalidraw integration, node extension, sidecar storage, markdown round-trip, PDF export
- Add Excalidraw editor overlay, slash command, and toolbar button
- Add callout blocks with Obsidian-compatible syntax (`> [!note]`, `> [!tip]`, `> [!warning]`, `> [!important]`)

### Fixes
- Fix Excalidraw mobile layout and apply neutral greyscale theme
- Fix external changes not detected and SQLite index locking
- Remove remaining frontend indexFile call from saveFile

### Improvements
- Polish drawing canvas — Excalidraw CSS import, theme-adaptive SVG previews
- Add drawing tests, round-trip fixtures, and fix Excalidraw rendering

## Files Changed
- 66 files changed across 9 commits
