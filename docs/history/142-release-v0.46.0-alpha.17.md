# Release v0.46.0-alpha.17

**Date:** 2026-06-08
**Previous version:** 0.46.0-alpha.16
**Channel:** Alpha

> ⚠️ **Broken build — does not launch.** Inherits the alpha.16 startup crash. Fixed in alpha.19; the auto-updater no longer serves it. See #432.

Meeting recordings are now fully driven from the agent orb, plus focus-mode and tooltip fixes.

## Changes

### Features
- **Recording controls in the agent orb** (#427): stop, pause, and resume a meeting recording inline, with a pause-aware timer and a clock-style seconds animation distinct from the agent-activity pulse.
- **Richer transcript items** (#427): click a finished transcript to open it, reveal it in Finder, or move it to a project; each shows **start – stop · length**.

### Fixes
- Stop the StatusTray mic tooltip from auto-opening when the popover opens (#428).
- Focus mode (⌘.) now **fully hides the sidebar** instead of just dimming it (#428).
- Fix transcript frontmatter rendering `[object Object]` for the `segments` array (#427).

## Under the hood
- AgentOrb recording panel: stop/pause/resume controls + pause-aware duration from written samples (#427)
- Seconds-ray ring animation that builds up one ray per second (#427)
- Transcript card: open / Reveal in Finder / Move to project actions + start–stop · length info row (#427)
- Rename recording bundles from "Meeting <timestamp>" to "Recording <timestamp>" (#427)
- `pause_recording` / `resume_recording` Tauri commands; capture pause discards samples without tearing down the cpal stream (#427)
- StatusTray popover: prevent default autofocus so the mic tooltip doesn't fire on open (#428)
- Focus-mode CSS: collapse the sidebar's grid track so the document reclaims the space (#428)

## Known issues
- **Crashes on launch** — inherits the alpha.16 telemetry-plugin runtime panic. Fixed in alpha.19 (#432).
