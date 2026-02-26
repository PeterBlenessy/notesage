# PRD: Editor Typography Settings

**Date:** 2026-02-26 **Version:** 0.16.4 **Status:** Complete

## Summary

Configurable editor typography (font family, font size, line height, paragraph spacing) accessible from the toolbar. Settings persist to disk for iCloud sync support.

## Motivation

Users have different reading/writing preferences. A writer may prefer serif at 18px with generous spacing, while a developer may prefer monospace at 14px. Typography settings should be easily accessible (not buried in settings) and sync across devices.

## Requirements

### Functional

- **Font family**: Choose from 14 curated presets across sans-serif, serif, and monospace categories, each previewed in its own typeface
- **Font size**: Adjustable from 12px to 24px (default: 16px)
- **Line height**: Adjustable from 1.2 to 2.2 (default: 1.7)
- **Paragraph spacing**: Adjustable from 0.25em to 1.5em (default: 0.75em)
- Typography popover in the toolbar (not settings dialog) for quick access
- Reset to defaults button
- Settings persist to `~/Notesage/.notesage/editor-styles.json`
- Settings load on app startup

### Non-functional

- No Rust changes required (reuse existing `read_file`/`write_file` commands)
- CSS custom properties for all typography values (no hardcoded values in editor.css)
- Follow existing margin CSS variable pattern in Editor.tsx

## Design

### Typography Popover

- Triggered by a `Type` icon button in the toolbar (after image insert, before spacer)
- Contains:
  - Font family: Dropdown select with 14 presets in 3 categories (Sans-serif, Serif, Monospace), each rendered in its own typeface
  - Font size: Slider with numeric display (12-24px)
  - Line height: Slider with numeric display (1.2-2.2)
  - Paragraph spacing: Slider with numeric display (0.25-1.5em)
  - Reset button at the bottom

### CSS Custom Properties

| Property | Default | CSS Variable |
| --- | --- | --- |
| Font family | system | `--editor-font-family` |
| Font size | 16px | `--editor-font-size` |
| Line height | 1.7 | `--editor-line-height` |
| Paragraph spacing | 0.75em | `--editor-paragraph-spacing` |

### Storage

- File: `~/Notesage/.notesage/editor-styles.json`
- Format: `{ fontFamily: string, fontSize: number, lineHeight: number, paragraphSpacing: number }`
- Store: `editor-styles-store` (Zustand, disk-persisted via `read_file`/`write_file`)

## Implementation

### Files

| File | Change |
| --- | --- |
| `src/stores/editor-styles-store.ts` | **New** — disk-persisted typography store |
| `src/styles/editor.css` | CSS vars for font-size, line-height, paragraph-spacing, font-family |
| `src/components/editor/Editor.tsx` | Apply typography CSS variables from store |
| `src/components/editor/Toolbar.tsx` | Typography popover button and UI |
| `src/App.tsx` | Load editor styles on startup |

### Future

- **System font enumeration**: Use a Rust crate like `font-kit` via a Tauri command to list all installed system fonts, enabling a full font picker instead of the curated preset list. Requires mapping OS font names to CSS `font-family` values and verifying WebView rendering compatibility.
- Project-level typography overrides (global -> project -> document cascade)
- Document-level typography via frontmatter
- Custom font loading (user-provided fonts / Google Fonts)

## Quality Gates

- [x] Typography changes apply immediately in the editor
- [x] Settings persist across app restarts
- [x] Reset button restores all defaults
- [x] Works in both light and dark mode
- [x] Popover follows design system (shadcn/ui components, consistent spacing)
- [x] No regressions in existing editor functionality