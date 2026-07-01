# Release v0.47.0-alpha.2

**Date:** 2026-06-16
**Previous version:** 0.47.0-alpha.1
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

### Features
- feat(cmd-bar): session lifecycle & concurrent multitasking (#469)

## Under the hood

Auto-generated from merged PRs + commits since `v0.47.0-alpha.1`. Alpha builds list commit-level detail for technical users.

- Bump rollup from 4.57.1 to 4.59.0 in the npm_and_yarn group across 1 directory (#1)
- Fix Copilot LSP sign-in: handle server→client signIn request for device code (#2)
- Refactor Copilot LSP sign-in flow to handle three-phase auth (#3)
- Add configurable debug logging and fix Copilot LSP issues (#4)
- Bump @mozilla/readability from 0.5.0 to 0.6.0 in /bundled-skills/download-webpage/scripts in the npm_and_yarn group across 1 directory (#5)
- Add hardcoded values audit research (#6)
- Bump quinn-proto from 0.11.13 to 0.11.14 in /src-tauri in the cargo group across 1 directory (#7)
- Add 6 PRDs for local AI agentic features and productivity enhancements (#8)
- Add PRD for always-on memory agent (ported from Google Cloud Platform) (#9)
- Add CLI/ACP vs Agent SDK analysis document (#10)
- Add App Store launch readiness research document (#11)
- Add sandbox-runtime comparison research with identified gaps (#12)
- Claude/analyze notesage competitors pe7w6 (#13)
- Bump picomatch from 4.0.3 to 4.0.4 in the npm_and_yarn group across 1 directory (#14)
- Add Skills-to-Tools Glue Layer PRD and Research (#15)
- Bump @xmldom/xmldom from 0.8.11 to 0.8.12 in the npm_and_yarn group across 1 directory (#16)
- docs(cmd-bar): record post-review hardening pass + defer #11 to issue #468
- perf(cmd-bar): single-pass run-state derivations in orb + history rows (review perf)
- fix(cmd-bar): per-conversation ACP stream cleanup + targeted cancel (review #3,#13)
- refactor(cmd-bar): per-conversation tool-permission map + shared approval UI (review #4,#6,#7,#8,#9)
- fix(cmd-bar): route streaming writes to the owning conversation (review #1,#2,#5)
- test(cmd-bar): cross-cutting integration pass + mark feature complete (task #16)
- fix(cmd-bar): preserve the typed draft when closing via the X button
- feat(cmd-bar): desktop notifications for backgrounded sessions (task #15)
- feat(cmd-bar): orb shows unwatched sessions + needs-you pulse + panel list (tasks #12, #13, #14)
- feat(cmd-bar): inline permission card in history rows (task #10)
- feat(cmd-bar): history row status badges + switcher (tasks #9, #11)
- feat(cmd-bar): per-conversation permission ownership + foreground-aware auto-deny (tasks #6, #7)
- feat(cmd-bar): concurrency cap + FIFO queue (task #5)
- feat(cmd-bar): maxConcurrentSessions + permission-notify settings (task #8)
- feat(cmd-bar): session run-state owner + per-conversation loading (task #4)
- feat(cmd-bar): per-conversation streaming writes (task #3)
- feat(cmd-bar): ACP agent registry, per-conversation (task #2)
- feat(cmd-bar): session run-state store (task #1)
- docs: PRD + tasks for command-bar session lifecycle & concurrent multitasking
