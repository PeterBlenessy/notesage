---
name: verification-is-the-work-not-a-decision
description: "Never ask permission to run a simulator/device/app check — verification is the last step of the work, not a choice for the operator"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd, aw-review, aw-iterate]
---

Never ask "shall I verify this in the simulator / on device / by running the
app?" — just run it and report the result.

**Why:** verification is not a separate deliverable needing approval, it is the
last step of the work. Asking converts a step the agent owns into a decision
the operator has to make, and it is how unverified platform work reached a
device six times across consecutive builds.

**How to apply:** when a change needs a build, a simulator, a device or an app
run to be believed, run it. This covers simulator builds and installs, the
desktop app, and E2E harnesses — anything reversible. Still ask before anything
that ships outward: a store upload, a release tag, a push to a protected
branch.
