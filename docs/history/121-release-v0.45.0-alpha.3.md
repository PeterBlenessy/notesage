# Release v0.45.0-alpha.3

**Date:** 2026-05-22
**Previous version:** 0.45.0-alpha.2
**Channel:** Alpha

Auto-cut by `aw-alpha-cut` after Tier-A/B PRs landed. The auto-dump under "Under the hood" lists the merged PRs verbatim.

Before promoting this alpha to stable, edit this file:
  - Move anything user-visible from "Under the hood" into "## Changes" under `### Features`, `### Improvements`, or `### Fixes` — and rewrite each bullet in user-facing prose (drop PR titles, version triples, internal jargon).
  - Leave "## Changes" as `_No user-visible changes._` for infra-only releases.
  - See `feedback_user_facing_release_notes.md` and `scripts/generate-changelog.ts` linter rules.

## Changes

_No user-visible changes._

## Under the hood

- Corrected the alpha.2 release notes to remove placeholder text and add honest user-facing prose. (#320)
- Documented the agentic-workflow release half in `docs/agentic-workflow.md` and fixed a Mermaid syntax error. (#319)
- Split `docs/agentic-workflow.md` into an operational reference and a companion rationale file (`docs/agentic-workflow-rationale.md`) to keep session context lean. (#321)
