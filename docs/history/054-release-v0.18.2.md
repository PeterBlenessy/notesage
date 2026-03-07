# Release v0.18.2

**Date:** 2026-03-07
**Previous version:** 0.18.1

## Changes

### Features
- Add `download-webpage` bundled skill — fetch web pages by URL, extract article content, download images locally, save as clean markdown with YAML frontmatter

### Fixes
- Fix chat panel broken state when last conversation is deleted (auto-create recovery)
- Fix debug guard logic for bundled file extraction (was inverted — skipped unchanged files instead of changed ones)

### Improvements
- Extract shared `write_bundled_file()` helper to deduplicate bundled skill/agent extraction logic
- Parallelize image downloads in download-webpage skill (Promise.all instead of sequential)
- Single-pass markdown image URL replacement instead of per-image string rebuild

## Files Changed
- 8 files changed across 1 commit
