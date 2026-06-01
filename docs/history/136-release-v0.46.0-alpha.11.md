# Release v0.46.0-alpha.11

**Date:** 2026-05-31
**Previous version:** 0.46.0-alpha.10
**Channel:** Alpha

Auto-cut by `aw-alpha-cut` after Tier-A/B PRs landed. The auto-dump under "Under the hood" lists the merged PRs verbatim.

Before promoting this alpha to stable, edit this file:
  - Move anything user-visible from "Under the hood" into "## Changes" under `### Features`, `### Improvements`, or `### Fixes` — and rewrite each bullet in user-facing prose (drop PR titles, version triples, internal jargon).
  - Leave "## Changes" as `_No user-visible changes._` for infra-only releases.
  - See `feedback_user_facing_release_notes.md` and `scripts/generate-changelog.ts` linter rules.

## Changes

_No user-visible changes._

## Under the hood

Auto-generated dump of merged Tier-A/B PRs. Rewrite as prose grouped by area before stable promotion.

- feat(transcription): meeting recording with background transcription (#398)
- Fix Claude Code agent auto-install by routing through npm (#399)
- Route OpenAI Codex agent install through npm (#400)
- Route Copilot CLI + LSP through npm and remove the GitHub-binary installer (#401)
- Add opt-in smoke test for the managed agent install flow (#402)
