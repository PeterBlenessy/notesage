# PRD: Keyboard Shortcuts Reference Dialog

**Date:** 2026-02-28 **Status:** In Progress **Parent:** Phase 6.5 — Chat UX & Agent Polish

## Problem

Notesage has many keyboard shortcuts documented in `docs/keyboard-shortcuts.md`, but users have no way to discover or reference them from within the app. Users must leave the app to read documentation, breaking their workflow.

## Goals

1. Provide an in-app keyboard shortcuts reference accessible via `Cmd+7`
2. Add a clickable Command icon in the status bar as an alternative entry point
3. Group shortcuts by category with polished `<kbd>` styling
4. Match the documented shortcuts in `docs/keyboard-shortcuts.md`

## Non-Goals

- No shortcut customization or rebinding
- No shortcut search/filter within the dialog
- No platform-specific key display (macOS only for now)

## User Stories

1. As a user, I want to press `Cmd+7` to see all available shortcuts so I can learn the app faster
2. As a user, I want to click a Command icon in the status bar to open the shortcuts reference
3. As a user, I want shortcuts grouped by category so I can find what I need quickly

## Technical Approach

### New Component: `KeyboardShortcutsDialog.tsx`

A read-only shadcn `Dialog` with:

- Two-column rows: action label left, `<kbd>` key combo right
- Categories: File Operations, Editor, Find, Navigation, Settings
- `ScrollArea` for content overflow (\~70vh max height)
- \~480px max width
- `<kbd>` elements styled with `bg-muted border border-border` and monospace font

### Keyboard Shortcut: `Cmd+7`

Add handler in `useKeyboardShortcuts.ts` with new `onShortcutsOpen` callback.

### Status Bar Icon

Add a `Command` (lucide) icon button at the far right of the status bar right zone with tooltip "Keyboard shortcuts (⌘7)".

### Prop Threading

`App.tsx` → `EditorArea` → `Editor` → `StatusBar` via `onShortcutsOpen` prop.

## Keyboard Shortcuts

| Action | Shortcut | Description |
| --- | --- | --- |
| Keyboard shortcuts | `Cmd+7` | Show keyboard shortcuts reference |

## UI/UX

- Dialog matches app design system (neutral palette, no chromatic colors)
- `<kbd>` elements: small rounded box, `bg-muted`, `border border-border`, monospace font
- Each modifier/key in its own `<kbd>` with gap between them
- Categories: uppercase, text-xs, tracking-wider, muted color
- Works in both light and dark mode
- Escape closes the dialog

## Data Model

No new data model. Shortcut definitions are static constants in the component.

## Dependencies

- shadcn/ui: `Dialog`, `ScrollArea` (already installed)
- lucide-react: `Command` icon (already available)

## Quality Gates

- [x] `Cmd+7` opens the dialog from anywhere in the app

- [x] Escape closes the dialog

- [x] Command icon in status bar opens the same dialog

- [x] All shortcuts from `docs/keyboard-shortcuts.md` are represented

- [x] `<kbd>` elements look polished with subtle border/background

- [x] Dialog scrollable if content exceeds viewport

- [x] Works in both light and dark mode

- [ ] Command icon visible regardless of file type

## Out of Scope

- Shortcut customization
- Search/filter within the dialog
- Windows/Linux key display
- Animated transitions beyond shadcn defaults