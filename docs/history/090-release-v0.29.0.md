# Release v0.29.0

**Date:** 2026-04-05
**Previous version:** 0.28.4

## Changes

### Features
- System tray with menu bar icon (italic "N" template image, adapts to light/dark)
- Tray menu: New Note, New Quick Note, Open Actions (badge count), Recent files, Show/Quit
- Click tray icon to toggle main window visibility
- Close-to-tray: hide window on close instead of quitting (opt-in setting)
- Desktop notifications for agent task completion and errors (via tauri-plugin-notification)
- Quick Capture floating window (Cmd+Shift+Space global shortcut) with destination picker
- Start at login via tauri-plugin-autostart (macOS LaunchAgent)
- Settings UI: System Tray + Notification sections in General tab
- Badge count synced from activity store, recent files from editor store
- Image attachments for multi-modal AI chat (paste, drag-drop, file picker, editor context menu)
- Hidden file/folder visibility toggle in Settings > Advanced
- Insert-chart bundled skill for AI agent chart generation

### Fixes
- Fix Gemma 3 4B vision support — enable supports_vision and add mmproj
- Fix Quick Capture white flash — create window hidden, show after render
- Fix multi-series chart rendering and improve insert-chart skill docs
- Fix cargo check on Linux — sidecar placeholder, RunEvent::Opened guard
- Fix markdown formatting in docs (escaped entities, list spacing)
- Replace window.confirm() with AlertDialog for destructive actions

### Improvements
- Show combined model + mmproj size in Local AI settings
- Improve sidebar empty state cards with descriptive text and proper buttons
- Add ARIA tree view roles, keyboard accessibility, and aria-hidden attributes
- Add empty states, discoverability, visual polish, and error handling (20 tasks)
- UI/UX polish pass complete (20/20 tasks)
- Audit v3 complete (39/40 tasks, 70+ new tests)

## Files Changed
- 23+ files changed across 18 commits
- New: tray.rs, QuickCapture.tsx, useTrayEvents.ts, useTraySync.ts, notifications.ts
- New plugins: tauri-plugin-notification, tauri-plugin-autostart, tauri-plugin-global-shortcut
- New Tauri features: tray-icon, image-png
