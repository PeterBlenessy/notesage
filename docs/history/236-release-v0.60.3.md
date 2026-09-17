# Release v0.60.3

**Date:** 2026-09-17
**Previous version:** 0.60.2

Nothing changes on screen. This one exists so the next set of measurements can
be trusted.

## Changes

### Improvements

- Internal measurement only — no change to how the app behaves.

## Under the hood

Three instruments, all shipped so they can be read from the log file rather
than guessed at. Nothing here is user-visible; the release exists because the
previous three each produced a measurement that turned out to mean something
other than what it said.

**Two metrics now report what their names claim.**

- `[perf:startup] trees validated` reported `explorerFolders.length +
  projects.length` under the name `totalFiles` — **16**, on a launch with
  ~3,254 files — and both numbers it summed were already logged beside it as
  `folders` and `projects`. It counts files now. The reason it was wrong is
  worth keeping: there were **three** copies of `countFiles`, and the metric
  that was wrong never called any of them. On the same launch, `index init`
  counted 1,438 files in one project correctly using `useAppLifecycle`'s
  private copy, while `trees validated` twenty lines away summed two array
  lengths. One shared `countFiles` in `file-utils` now, with the tests it never
  had.
- `[perf:tree] refresh` gains `targetPath`. `mode` already established that
  these are path-scoped refreshes matching no section, so `ms: 0` is correct —
  but a correct no-op and a refresh that silently failed to find its target
  both log `sections: 0`, and five fire on every launch.

**CSP violations now say which stylesheet.** Three fire at launch and have sat
in `docs/performance-baseline.md` since v0.59.0 unidentified, because the
browser's message is the same string whichever stylesheet was blocked and
names neither the source nor the injector. They cannot be reproduced in
development — `tauri dev` serves over Vite with no CSP header at all, the same
gap that hid #444 — so the shipped build has to report them. A
`securitypolicyviolation` listener registered before first paint logs the
blocked URI, the source file and line, a capped sample, and the runtime policy.

That last field is the point: the configured policy allows `style-src 'self'
'unsafe-inline'`, but Tauri rewrites it with a nonce, and per the CSP spec a
nonce makes `'unsafe-inline'` inert. Any stylesheet arriving without the nonce
is refused whatever `tauri.conf.json` appears to permit. The class was already
documented in `commands/html_preview.rs`; the instances were not.

**The startup gate can now be A/B'd on one machine.** Whether waiting for
`startupReady` helps startup itself is still unanswered after three releases of
trying, because every comparison spanned two releases on a laptop whose load
moved more than the change did — between v0.60.1 and v0.60.2 `trees validated`
rose 43% and `doc visible` 57% on code nothing had touched. More releases will
not fix that. Setting
`localStorage['notesage.perf.skillGate'] = 'idle'` takes the v0.60.1 arm
(schedule on idle, do not wait for startup); removing the key restores the
default. The arm is reported on `phase1-ready` as `gate`, so a log always
records which behaviour produced it.

## Files Changed

- 8 files across 2 commits (#1047, #1048, and this release).
