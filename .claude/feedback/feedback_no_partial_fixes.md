---
name: No partial fixes for complex issues
description: Don't rush partial fixes after identifying an issue as architecturally complex — do proper analysis first
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd]
---

Don't flip-flop between "this needs a PRD" and immediately coding a quick fix. If the analysis shows multiple interconnected issues (sandbox scope, agent reuse, auto-approve logic), commit to the proper planning path.

**Why:** User called this out — partial fixes miss edge cases and create a false sense of progress. The quick fix for task agent reuse didn't address cwd source, auto-approve, or explorer folders.

**How to apply:** When you identify 3+ interrelated issues in an area, create a PRD or task breakdown. Don't code until the plan is reviewed.
