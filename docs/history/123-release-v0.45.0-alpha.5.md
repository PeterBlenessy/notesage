# Release v0.45.0-alpha.5

**Date:** 2026-05-24
**Previous version:** 0.45.0-alpha.4
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

- fix(editor): restore warm-click perf in Quiet Composer (Tiptap 3.23.6 + EditorState cache re-key) (#346)
- fix(epub): guard paginator expand() against null this.document on viewer swap (#344)
- feat(.claude): AW feedback integration — Phases 1-6 complete (closes #336) (#337)
- chore: remove Classic Layout — Quiet Composer is the only UI shell (#333)
