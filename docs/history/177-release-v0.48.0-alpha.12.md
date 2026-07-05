# Release v0.48.0-alpha.12

**Date:** 2026-07-05
**Previous version:** 0.48.0-alpha.11
**Channel:** Alpha

Auto-cut by `aw-alpha-cut`. Sections below are auto-classified from merged PRs; refine the prose before promoting to stable.

## Changes

_No user-visible changes._

## Under the hood

Auto-generated from merged PRs + commits since `v0.48.0-alpha.11`. Alpha builds list commit-level detail for technical users.

- Deep review batch 1: runtime bug fixes (races, boundaries, chat rendering, cancel gaps) (#512)
- Deep review batch 2: dead-code removal, doc drift, listener-lifecycle fixes (#513)
- Deep review batch 3: Rust backend hardening (#514)
- Deep review batch 4: runtime validation at trust boundaries (#515)
- Deep review batch 5a: wire five half-implemented features (#516)
- Deep review batch 5b: rewire git branch diff review via the Quiet sidebar (#518)
- Deep review batch 5c: typewriter scrolling, Copilot progress segments, sandbox activity panel (#519)
- test: reference PR #516 in the deflake comment (CI trigger)
- fix(settings): guard SandboxActivitySettings against non-array IPC results
- test: deflake keyboard-nav tests in cmd-bar mode pickers
- feat: typewriter scrolling, Copilot progress segments, sandbox activity panel
- feat(git): rewire branch diff review via the Quiet sidebar
- feat: wire five half-implemented features end-to-end
- fix: runtime validation at trust boundaries
- fix(backend): harden proxy, downloads, process cleanup, and shared SSRF guard
- chore: delete orphaned legacy sidebar subtree
- fix: listener-lifecycle guards and render hot-path polish
- chore: remove dead code confirmed by the deep review
- docs: fix drift found by the 2026-07-03 deep review
- fix(proxy): remove dead network-domain-always emit; lock Allow Always persistence with tests
- fix(ai): cancel gating, completion supersede guard, reactive deps, ACP session-id gating
- fix(chat): stable keys, batched autoscroll, memo hygiene, error boundaries
- fix(editor): close instant-load pipeline races
