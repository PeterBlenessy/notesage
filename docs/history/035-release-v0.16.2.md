# Release v0.16.2

**Date:** 2026-02-25 **Previous version:** 0.16.1

## Changes

### Features

- Curated changelog: build-time generator parses docs/history/ into structured JSON
- UpdateDialog shows grouped changes (features, fixes, improvements) instead of raw commit log
- Settings > About > Changelog button opens full scrollable version history
- CI uploads changelog.json as a GitHub release asset alongside latest.json

### Fixes

- Fix changelog loading hang: load bundled changelog first (instant), remote fetch with 3s timeout as secondary

## Files Changed

- 32 files changed across 6 commits
