# Release v0.60.1

**Date:** 2026-09-16
**Previous version:** 0.60.0

The app stops doing your AI setup's homework while you are waiting for your
document to open.

## Changes

### Improvements

- Notesage opens your document sooner. It used to spend the first couple of
  seconds reading through every skill and agent you have — work that only
  matters once you start an AI session — while you were waiting for the
  window. That reading now happens quietly afterwards, or the moment you open
  the command bar, whichever comes first. It also stops reading them a second
  time on launches where nothing about them has changed.

## Under the hood

The v0.59.0 baseline entry recorded two anomalies rather than smoothing them
over. Both turned out to be the same story, and both are fixed here.

- **`startupReady` gates no rendering.** Nothing in `src/components` or
  `App.tsx` consumes it — only `useActionScanner`, `useMcpOperations` and
  `useAppLifecycle`. So `startup ready: 3,636ms` was never user wait; the user
  had their document at `[perf:doc-switch] 1,198ms`. The remaining time was
  background work *contending* with first paint for CPU and IPC, which is a
  different problem with a different fix.
- **`phase2-extract` at 18× against 5× the skills** was not extraction at all.
  It called `scanSkills` and `scanAgents` over all 57 skills and 18 directories
  unconditionally, compared the counts (`57 → 57`, `1 → 1`), and almost always
  skipped the re-extract — 895ms per launch to establish that nothing had
  moved. It rescanned because it had nothing else to go on:
  `extract_bundled_skills` returned the directory path, and
  `write_bundled_file` always overwrote, so neither side knew whether the
  bundle had changed. `write_bundled_file` now compares before writing and the
  command returns `{dir, changed, removed}`; phase 2 skips the rescan when both
  are zero. An app update, a skill dropped from the bundle, or a failed
  extraction still rescan. The executable bit counts as a change even when the
  bytes match, so making the write conditional does not stop repairing a script
  left non-executable by an interrupted run.
- **Discovery is no longer eager.** Every `useSkillStore` consumer is an AI
  session (`useAIContext`, `useCopilotChat`, `useDirectApiChat`,
  `chat-expansion`, `tool-executor`) or a surface opened deliberately
  (Settings, the wizards, `SkillMode`) — none is on the render path. The
  pipeline lifted out of the effect into a memoized
  `ensureSkillsDiscovered()`, scheduled via `requestIdleCallback` with a 2s
  cap. The command-bar summon in `useCommandBarBusWiring` pulls it forward,
  because `useAIContext` composes its system message from render-time selector
  values — awaiting at send time would not refresh them. Concurrent callers
  share one pass; later passes chain rather than overlap.
- **`[perf:tree] refresh` reported all zeros**, which is how the other two went
  unnoticed for a release. A targeted refresh matching no section logged
  `{sections: 0, totalFiles: 0, ms: 0}`, indistinguishable from a fast one, and
  `refreshNotesTree` returned `void`, so every Quick Note it listed counted as
  zero files. It returns its count now and the log carries
  `mode: 'targeted' | 'full'`.

## Files Changed

- 10 files across 2 commits (#1043, and this release).
