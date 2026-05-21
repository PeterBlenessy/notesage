# Release v0.45.0-alpha.2

**Date:** 2026-05-21
**Previous version:** 0.45.0-alpha.1
**Channel:** Alpha

Infrastructure-only release. No user-visible changes vs. alpha.1 — same features, same behaviour. Cut to land the CI plumbing that makes future auto-cuts actually work and to clear two routine dependency patches.

## Changes

### Improvements

- **Infrastructure-only release.** No user-visible changes vs. alpha.1 — same features, same behaviour. This alpha ships the CI plumbing that makes future auto-cuts actually work, plus two routine dependency patches.

## Under the hood

### Auto-cut machinery actually fires end-to-end

`aw-alpha-cut.yml` had two latent bugs that surfaced the first time we tried to fire it. The `cut` job ran `pnpm install` without setting up Node or pnpm and exited 127 (#315). After that was fixed it tried to `git push origin main` directly and was rejected by branch protection because the runner's local commit couldn't satisfy the 4 required status checks (#317). Restructured into two jobs in the same file: `cut` pushes to a `release/v${NEXT_VERSION}` branch and opens an auto-merge PR (going through the same gate as every other PR); `tag-after-merge` fires on the merged PR's close event, tags the merge commit on main, and pushes the tag — which triggers `release.yml` to build the artifacts. The two-job split lets the cut job exit in seconds rather than holding a runner for the entire CI duration.

This alpha is also the first one that rode the new pipeline.

### Real-E2E save-test diagnostic

`editor.test.ts › should save file to disk with Cmd+S` had two distinct failure modes (focus didn't land on ProseMirror; ⌘S didn't flush in 1 s) that both presented as `expected file to contain "SAVE_TEST_<ts>"`. Replaced the fixed 1 s sleep with two staged `waitUntil` guards that fail with precise diagnostics — focus race vs. save-handler-not-firing (#316). Happy path also got faster (no fixed sleep).

### Dependency bumps

- `openssl` 0.10.79 → 0.10.80 (Rust transitive, security patch) — #314.
- `ws` 8.19.0 → 8.20.1 inside the `bundled-skills/download-webpage` Node script — `npm audit fix` (#313).

Both are mechanical bumps, no behaviour change.
