---
name: fix-every-instance-of-a-class-not-the-convenient-one
description: "Asked to fix a CLASS of problem, inventory ALL instances and fix them — never silently downgrade a known one to re-run-and-hope"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-tdd, aw-iterate]
---

When asked to fix a CLASS of problem — flaky tests, a category of bug, a family
of warnings — and more than one instance is known, inventory the full set
first, plan for all of them, and fix all of them.

**Why:** told explicitly not to "bet on being lucky with the next test run",
the agent root-caused one flaky test and said it would "re-run the other if it
hits" — the exact behaviour just forbidden. The operator called it extremely
sloppy.

**How to apply:** the moment work starts on one instance, ask whether others of
the same class are known. If so they all go in the plan. Never downgrade a
known issue to "re-run / hope / later" silently — either fix it or surface it
explicitly as a gap for the operator to rule on. "Done" excludes any known gap
quietly deferred.
