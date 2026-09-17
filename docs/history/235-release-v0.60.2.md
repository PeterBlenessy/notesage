# Release v0.60.2

**Date:** 2026-09-17
**Previous version:** 0.60.1

A second pass at the startup work in v0.60.1, after measuring it rather than
reasoning about it.

## Changes

### Improvements

- Notesage opens your document sooner still. Reading through your skills and
  agents now waits until the app has finished starting, instead of starting as
  soon as it found a spare moment — which, during startup, turned out to be
  almost immediately.

## Under the hood

v0.60.1 deferred skill discovery to `requestIdleCallback` so it would stop
competing with first paint. The v0.60.1 baseline measurement caught it not
working:

```
[startup] Validating 2 explorer folders, 14 projects
[skills] Starting skill/agent discovery pipeline      <- immediately
[perf:startup] trees validated            ms: 370
[perf:doc-switch] Doc visible             totalMs: 422
[skills] Discovered 57 skills             skill-scan: 484
```

The scan began before the file trees were validated and was still running when
the document became visible — the exact overlap deferring it was meant to
remove. An IPC-heavy startup spends most of its time awaiting, so the first
idle gap arrives within a few hundred milliseconds. `requestIdleCallback`
answers "is the main thread free right now", and the question was "has startup
finished". The first pass now waits for `startupReady` and then goes idle.
`useAppLifecycle`'s watchdog sets `startupReady` even when startup times out,
so this cannot strand discovery, and `ensureSkillsDiscovered()` still runs on
demand for anything that reads a skill.

- **Perf logs reach `notesage.log`.** 25 call sites used raw
  `console.log('[perf:x]', …)`, which goes to the Web Inspector and nowhere
  else — reading a startup profile meant expanding collapsed objects by hand.
  Every `perf:skills` and `perf:tree` site was invisible to the log file, which
  are the two categories most often needed. `log.perf()` keeps console output
  identical and also forwards at `info`, landing in the log whenever debug
  logging is on. The `PERF` registry had been in `logger.ts` unused all along.
- **`flush()` could throw into its caller.** `invoke` throws *synchronously*
  when there is no Tauri IPC, walking past the `.catch`. Because `enqueue`
  flushes on a 20-entry threshold, the exception landed on whichever caller
  crossed entry 20 — it surfaced as the discovery pipeline rejecting, three
  frames from any mention of logging. Latent before; adding perf entries to a
  hot path filled the buffer during startup and exposed it.
- Two logger mocks hand-listed the module's exports and failed opaquely when
  one was added. They spread the real module now.
- `docs/performance-baseline.md` gains the v0.60.1 entry, recording what the
  numbers do *not* show: `phase2-extract` is confirmed (`rescanned: false`,
  895 → 10 ms, ~500 ms saved once sized against this run's hardware), but
  `skill-scan` fell 2,052 → 484 ms on code nothing touched, so
  `startup ready 3,636 → 1,423` is a true measurement and a misleading
  attribution.

## Files Changed

- 10 files across 1 commit (#1045, and this release).
