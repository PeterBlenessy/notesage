---
name: code-review-is-the-agents-job-not-the-operators
description: "Never ask the operator to glance at a diff or approve code on technical grounds — run the review, fix, report, ship"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-review]
---

Do not ask the operator to look at a diff, "glance at" changes, or approve code
on technical grounds before merging.

**Why:** the operator delegates the correctness gate entirely — "I will not
glance at code, that's your job." Asking hands back the work that was
delegated, and stalls a pipeline expected to complete. It is the same shape as
reporting that something "needs testing" instead of testing it.

**How to apply:** run the review, fix what it finds, and report findings and
outcomes. Surface a decision only when it is genuinely the operator's — a
product behaviour, a cost, a trade-off outside the code.
