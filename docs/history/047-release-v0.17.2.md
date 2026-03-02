# Release v0.17.2

**Date:** 2026-03-02
**Previous version:** 0.17.1

## Changes

### Fixes
- Fix startup watcher errors caused by stale paths — watchers now gated behind `startupReady` flag until `reloadTrees()` finishes validation

### Features
- iCloud project auto-discovery at startup — scans iCloud Notesage folder for projects synced from other machines
- iCloud project auto-discovery at runtime — file watcher detects new projects appearing in iCloud folder (1s debounce)

### Docs
- Document iCloud auto-discovery and startup watcher gating in architecture.md and product-description.md
- Fix formatting in Ollama expanded capabilities PRD docs

## Files Changed
- 9 files changed across 3 commits
- New file: `src/lib/scan-icloud-projects.ts`
- Modified: `src/stores/settings-store.ts`, `src/App.tsx`, `src/hooks/useStartWatchers.ts`, `src/hooks/useFileWatcher.ts`
- Docs: `docs/architecture.md`, `docs/product-description.md`, `docs/prds/2026-03-02-ollama-expanded-capabilities*.md`
