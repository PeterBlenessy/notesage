# Release v0.22.10

**Date:** 2026-03-23
**Previous version:** 0.22.9

## Changes

### Fixes
- Open actions comment click now navigates to the document and scrolls to the comment, instead of opening the JSON sidecar file
- Comments with "done" status (agent replied, awaiting user review) now appear in the default actions filter
- Orphaned comment cleanup: comment sidecar files are deleted when the referenced document no longer exists
- Stale comment cleanup: individual comments are removed when their anchor text is no longer found in the document

## Files Changed
- 3 files changed across 1 commit
