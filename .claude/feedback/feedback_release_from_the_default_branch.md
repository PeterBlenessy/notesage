---
name: cut-every-release-from-the-default-branch
description: "Every build ships from the default branch with everything merged first — never from an integration branch of open PRs"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-iterate]
---

Cut releases from the default branch, and merge everything into it first. Never
build a release from an integration branch that merges open PRs.

**Why:** four beta builds once went to testers from a branch merging five open
PRs. By the end, no commit on the default branch corresponded to what anyone
was running — shipping it would have silently REMOVED features testers already
had. Each release also made the next integration branch taller and its
conflicts worse. Build tags kept it traceable, but traceable to a throwaway
branch is not reproducible.

**How to apply:** merge first, then release from the default branch. If that
means landing several PRs first, land them (one at a time — see
`feedback_land_prs_one_at_a_time`).
