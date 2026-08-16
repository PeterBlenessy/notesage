# Release v0.48.0-alpha.30

**Date:** 2026-08-12
**Previous version:** 0.48.0-alpha.29
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

_No user-visible changes._

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.29`. Alpha builds list commit-level detail for technical users.

- iOS: fix gallery markdown thumbnails — full-size headings shoved right by editor padding (#644)
- iOS: thumbnail queue cancellation + pacing — no more frozen back-out (#645)
- iOS: accept images, videos and audio in the share sheet (#646)
- feat(mobile): share images, videos and audio into the library
- fix(mobile): abort in-flight thumbnail jobs at every stage checkpoint
- fix(mobile): free the UI thread from thumbnail generation — cancel on back-out, pace the queue
- fix(mobile): gallery markdown thumbnails rendered at full editor size, shoved right
