---
name: run-the-pre-flight-checklist-at-the-moment-of-action
description: "Consolidated checklists to run BEFORE committing, changing CI, releasing, arming auto-merge, or destructive git"
type: feedback
aw_applies: "yes"
aw_applies_to: [all]
---

Rules stored as separate entries are not consulted when pressure is on. These
run at the moment of action.

**Before pushing a commit:** is the target branch correct (not a protected
one)? Did the full suite run and pass locally? Did anything get greped for
tests asserting the behaviour just changed? Is the operator aware — no stealth
commits during active iteration?

**Before changing CI:** does the workflow still parse? Does the change make a
check more permissive than the real build?

**Before releasing:** is everything merged to the default branch? Do the notes
match what actually shipped? Has the operator confirmed the cut?

**Before arming auto-merge:** is this the only PR armed?

**Before destructive git:** has the plan been stated in one sentence?

**Before declaring done:** acceptance criteria met, tests and typecheck green,
self-reviewed, and NO known gap quietly deferred. If any is unmet, say what is
left rather than "done".
