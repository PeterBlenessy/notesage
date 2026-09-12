---
name: prds-are-snapshots-update-the-living-docs
description: "PRDs and history files are point-in-time records — when the design evolves, update the living docs instead of rewriting them"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-refine, aw-retrospect]
---

PRDs are point-in-time decision records. They correctly describe what was
decided when written. When the design later evolves, do NOT edit the old PRD —
update the living documents instead.

**Why:** PRDs are the audit trail for why a decision was made and what was
weighed at the time. Editing them after the fact destroys that context and
makes "why did we do it this way?" unanswerable later.

**How to apply:** living docs — the architecture, design-system, feature and
command references, `CLAUDE.md`, and code comments describing current behaviour
— get updated. Anything under `prds/`, `history/`, or a shipped `tasks/` file is
a snapshot and is left alone. If a comment cites a PRD line for a rule that has
changed, update the COMMENT to describe current behaviour.
