---
name: land-prs-one-at-a-time-under-strict-status-checks
description: "With strict status checks, arm auto-merge on ONE PR at a time — rebasing every behind branch re-runs the whole suite per merge"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-iterate]
---

Never eagerly update every PR that is BEHIND. When the default branch requires
branches to be up to date before merging, each merge pushes all the others
behind, and rebasing them all makes every PR re-run the full suite once per
OTHER PR that lands.

**Why:** four PRs were armed at once with a monitor that rebased anything
behind. One of them was rebased and re-run five times — three runs cancelled
mid-flight by the concurrency group — purely because others landed ahead of it.
At a full suite per run that is hours of compute for no signal.

**How to apply:** arm auto-merge on ONE PR, let it land, then arm the next.
Update a branch when it is the one about to merge, not because it drifted.
