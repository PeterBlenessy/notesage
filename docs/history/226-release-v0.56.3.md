# Release v0.56.3

**Date:** 2026-09-06
**Previous version:** 0.56.2

One fix, for the worst kind of bug: the app started and then would not open.

## Changes

### Fixes

- **The app could start up and never show its window.** It happened after
  setting up a Local Agent, and once it started it happened every launch —
  there was nothing to click, so there was no way to fix it from inside the
  app either. If this is you, install this version over the old one; you do
  not need to reset anything first.

## Under the hood

- #946: `setupStateFor` returned a fresh `{ stage: 'idle' }` for a setup flow
  tagged with the other engine, and `useLocalAgentSetup` calls it inside a
  Zustand selector — so `useSyncExternalStore`'s snapshot never equalled
  itself. React reports that as "The result of getSnapshot should be cached to
  avoid an infinite loop" and then escalates to error #185. One shared frozen
  constant; two tests keyed on reference identity, since identity is the whole
  fix and `toEqual` passes against the bug.
- The trigger is a persisted `localAgentSetup.engine` that differs from
  `localAgentSetupEngine` — a completed pi setup, then a relaunch, reads as
  `"pi" !== null`. Every other path returns the stored object by reference and
  was stable all along, which is why no clean install and no test saw it.
- Found by rebuilding the production bundle with React's development build and
  mirroring the webview console into the app log: the warning names the failure
  mode, the JS stack names the hook. Recipe worth keeping for the next
  minified-only crash.

## Files Changed

- 2 files changed across 1 commit (+50 / −2)
