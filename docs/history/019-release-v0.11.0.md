# Release v0.11.0

**Date:** 2026-02-20
**Previous version:** 0.10.0

## Changes

### Features
- Implement Phase 5.5 — Notesage Library & iCloud Sync
  - `~/Notesage` as default library folder for projects and Quick Notes
  - Selective iCloud sync per project via Settings > Sync tab
  - iCloud sync toggle in per-project settings (sidebar cog icon)
  - Quick Notes sync to iCloud with file merge across local and cloud
  - Project migration between local and iCloud (atomic rename with copy fallback)
  - Cloud badge icon on synced files and folders in sidebar
  - New `sync-store` with disk-based persistence (`sync-settings.json`)
  - `migrate_to_icloud`, `migrate_from_icloud`, `migrate_quick_notes` Tauri commands
  - `formatDisplayPath()` for user-friendly path labels (iCloud Drive/Notesage, ~/Notesage)
  - New Project dialog defaults to ~/Notesage with optional iCloud sync checkbox
  - Project folder rename on disk when display name changes in Project Settings

### Improvements
- Redesign Sync settings with "configure then apply" pattern (pending state, Apply/Discard buttons)
- Replace intrusive AlertDialog confirmations with inline migration preview and path flow visualization
- Show all workspace projects in Sync settings, not just library projects
- Pin settings dialog to fixed top position to prevent layout jumps
- Add ghost checkmark on hover for persona and sync project cards
- Fix filesystem watcher self-write false positives (TTL-based HashMap instead of single-use HashSet)

### Docs
- Add PRD for Phase 5.5 — Notesage Library & iCloud Sync
- Update PRD to reflect implementation decisions and mark as complete

## Files Changed
- 31 files changed across 12 commits
