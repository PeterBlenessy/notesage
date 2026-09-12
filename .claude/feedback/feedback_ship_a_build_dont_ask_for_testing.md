---
name: ship-the-build-rather-than-asking-for-testing
description: "Platform work complete but unverified on device: merge it and cut a build — don't park a PR and report that it needs an on-device pass"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-iterate, aw-review]
---

When platform work is complete but unverified on a device, **cut the build**.
Do not leave the PR parked and report that it "needs an on-device pass" — that
hands the operator a task the agent owns.

**Why:** a beta distribution channel exists precisely to get unverified builds
onto the operator's device. Reporting "needs testing" without shipping stops
the loop one step short of its purpose. The operator has had to say so more
than once.

**How to apply:** get the work merged, cut the build, and say what to look at.
A draft PR is not a resting place for finished work awaiting device
verification.
