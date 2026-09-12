---
name: one-artifact-stream-risky-work-goes-behind-a-flag
description: "Never propose a separate prerelease channel — unproven work goes behind an experimental flag, off by default"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-triage, aw-refine]
---

Do not suggest cutting a prerelease channel, or "proving this on an alpha
first". The project ships ONE artifact stream. Risky or unproven work goes
behind an experimental feature flag, off by default, promoted when it earns it.

**Why:** the second channel was deliberately removed. Two streams meant a
bespoke update path beside the stock one, a channel selector, two changelogs,
and build-channel inference that silently drove a telemetry default — a lot of
machinery to answer a question a flag answers better.

**How to apply:** put the risky path behind a flag and ship it dark in the one
stream. See the single-binary PRD under `docs/prds/` for the rationale.
