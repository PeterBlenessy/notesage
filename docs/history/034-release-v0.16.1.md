# Release v0.16.1

**Date:** 2026-02-25 **Previous version:** 0.16.0

## Changes

### Fixes

- Fix Copilot LSP auth: try multiple field names for device code, extract from URI as fallback, emit error event on failure
- Fix auto-update restart: add "downloaded" state with "Restart Now" button using tauri-plugin-process relaunch()
- Fix cross-device images: copy local images to project-relative images/ folder for portability
- Fix ghost text jumpiness: add copilotMaxCompletionChars setting (default 80) to truncate displayed completions

## Files Changed

- 6 files changed across 1 commit
