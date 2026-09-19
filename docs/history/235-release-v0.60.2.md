# Release v0.60.2

**Date:** 2026-09-17
**Previous version:** 0.60.1

A second pass at the startup work in v0.60.1, after measuring it rather than
reasoning about it.

> **Corrected 2026-09-19.** The Improvements bullet below claimed this makes
> the app open sooner. A controlled A/B on one machine disproved it: startup
> is unchanged. What the change actually does is stop the skill scan costing
> 3.6× more than it needs to. See "What this release actually did" at the
> bottom, and the 2026-09-19 entry in `docs/performance-baseline.md`.

## Changes

### Improvements

- Reading through your skills and agents now waits until the app has finished
  starting, instead of competing with it. The work costs a fraction of what it
  did — less battery and less heat on launch.

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

## What this release actually did — corrected 2026-09-19

The claim above was that deferring the scan makes startup faster. It does not.
An A/B on one machine, both arms minutes apart via
`localStorage['notesage.perf.skillGate']`, settled it:

| | arm `startup` (shipped) | arm `idle` (v0.60.1) |
| --- | --- | --- |
| `startup ready` | 1,775 ms | **1,634 ms** |
| `skill-scan` | 137 ms | 505 ms, then 139 ms |

The concurrent arm finished startup **141 ms sooner** — noise in either
direction, but no reading of it says deferring helped.

What it did do is visible in one launch without any cross-run comparison at
all. The idle arm scanned twice (an artifact of the experiment's effect
dependency, not of the shipped path, which arm `startup` shows scanning once):
**505 ms while startup was running, 139 ms after it finished — same process,
same 57 skills, seconds apart.** Contention is real and it is ~3.6×, and that
single pair is better evidence than every cross-release comparison in this
document, because nothing else differed.

So the honest case for this release is CPU, not latency: the same work for a
third of the cost, against roughly a second's delay before skills are ready —
which `ensureSkillsDiscovered()` erases for anything that actually reads one.
Worth keeping. Not for the reason originally given.
