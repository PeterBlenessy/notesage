# Release v0.54.4

**Date:** 2026-08-27
**Previous version:** 0.54.3

You can run both local agents side by side, Cancel stops a share that is
already saving, and saved articles keep their pictures.

## Changes

### Fixes

- **Adding a second local agent does something.** With one local agent already
  set up, choosing the other opened its setup window with every step already
  ticked — so nothing was downloaded, nothing was configured, and the second
  agent could never be added at all. Both can now be set up and used side by
  side, in either order.
- **Cancel now cancels.** Sharing an article starts a chain of work that can
  run for the better part of a minute: fetching the page, rendering it, then
  writing the note. Tapping Cancel closed the window but did not stop any of
  it, so a share you had explicitly cancelled still turned up in your library.
  Cancel now stops the save, and stays available while one is running rather
  than leaving you with a window you cannot dismiss.
- **Saved articles keep their pictures.** Captured articles were arriving with
  most or all of their images missing — often just the author's portrait and
  nothing else. Notesage was reading the page too early, before it had finished
  loading, and never scrolled far enough for the rest of the pictures to load
  at all. How many you got depended on how fast the page happened to be that
  day, which is why the same article could save differently twice.
- **Saving a link or a video no longer freezes the share window.** The simplest
  saves were doing their filing work on the same thread that draws the window,
  so a slow moment from iCloud showed up as a share sheet that stopped
  responding.

### Improvements

- The share window no longer risks overwriting a note you already had when you
  save the same article many times over.

## Under the hood

Three of these are one defect each, found by reading the code rather than by
reproducing them, after two were reported from a real share.

- **The local-agent setup state was one record for two engines.** `stage`
  persisted as `ready` from whichever engine was installed first, and the
  second read it as its own. The dialog's staleness guard asked
  `connections.some(isLocalAgentPreset)` — *is there* a *Local Agent* — which
  is true while the first exists, so it declined to reset. Second time this
  shape has bitten: remove-then-re-add hit it first and was patched by
  resetting on removal, which fixed one path through the ambiguity rather than
  the ambiguity. The flow now carries the engine it belongs to, and
  `useLocalAgentSetup` reads through a scoping helper so consumers are scoped
  by default rather than by remembering. (#789)

- **`callAsyncJavaScript` treats its script as a function body.** Both page
  renderers passed `new Promise(...)` as a bare expression statement, so it was
  evaluated and discarded; the call resolved `success(nil)`, the string cast
  failed, and the completion took its "script failed" branch — which captures
  the DOM immediately, before the page has assembled itself. The
  DOM-quiescence settle both files are largely *about* had therefore never run
  once since it shipped. Nothing errored, which is why it survived. Verified
  against the API directly: without `return` → `success(nil)`; with it → the
  value. Measured end to end through the real extractor, images reaching the
  saved document went 1 → 3 on the reported Medium article and 2 → 3 on the
  second. (#787)

- **Lazy images never loaded** because the offscreen webview never scrolls.
  The renderer now forces images eager and walks the document once, bounded at
  1800 ms inside the existing 5 s ceiling.

- **`writeOffMain` covered one writer.** The link note, the X metadata note and
  the video note all ran coordinated iCloud writes on the thread the share
  sheet draws on — the same freeze three earlier rounds fixed for articles,
  still live on the simplest paths. (#779)

- `dedupedURL` returned the original — occupied — URL when it exhausted its 999
  attempts, and the caller then wrote it with `.forReplacing`.

Guards for all of it live in `pipeline_contract.rs` and the local-ai store
tests, and each was mutation-tested. Two were hollow on the first attempt and
were tightened: one matched an argument label rather than the guard it named,
the other matched the scroll-back-to-top rather than the walk.

Also added, not user-visible: a check that the App Store listing copy fits
Apple's field limits, which immediately found two keywords being bought twice
(#786); and CI now type-checks the iOS report webview and chrome overlay, which
no job had been reading.

## Known

- **Updating a local agent has not been exercised.** Goose has no version
  ceiling and is ten releases behind upstream, so the update button should take
  it — untested. pi and its bridge stay exactly pinned: the bridge is
  duck-typed against pi's pre-1.0 extension surface, and if it stops
  registering, pi runs writes with no permission prompt. That failure is silent
  and reads as health, so the pin holds until the smoke test can catch it.
- Our pi extensions do type-check cleanly against the current pi (0.84.3), so
  the signature surface has not moved — that covers hook names and signatures,
  not the RPC protocol, config format or CLI flags.
- The performance gate remains red on benchmarks already red in v0.53.1 — see
  `docs/performance-baseline.md`. Not a regression; cause still undetermined.

## Files Changed

- 4 commits: the local-agent setup state machine, both page renderers, the two
  share extensions' write paths and deduper, plus their contract guards.
