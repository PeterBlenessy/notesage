---
name: explain-destructive-git-before-running-it
description: "State what and why before reset, mid-flow branch switches, or chained git commands — don't ask for blind approval"
type: feedback
aw_applies: "yes"
aw_applies_to: [all]
---

Before multi-step or destructive git operations — `reset --hard`, a branch
switch mid-flow, chained commands — explain the plan in one sentence first.

**Why:** during a CI fix the agent committed to a protected branch, could not
push, then tried to clean up with a silent `checkout` plus `reset --hard`. The
operator denied it because nothing explained why the branch had a commit on it
or what was about to happen.

**How to apply:** one sentence naming the action and the reason before the
command — "dropping the local-only commit that can't be pushed, resetting to
match origin" — not just the command itself.
