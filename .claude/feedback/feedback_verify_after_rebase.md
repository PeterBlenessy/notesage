---
name: re-verify-after-a-rebase-that-touched-the-same-files
description: "A rebase can silently accept code that reverts or guards the fix — re-run the verification that proved it before pushing"
type: feedback
aw_applies: "yes"
aw_applies_to: [aw-iterate, aw-ci-repair]
---

After a rebase that touches the same files, re-run the verification that proved
the fix worked BEFORE pushing.

**Why:** a rebase resolved a conflict by accepting an early-return guard from
the other side, which completely disabled the control the branch had just
fixed. Nothing flagged it, because it was valid code from the other head.

**How to apply:** after `git rebase --continue`, re-run the specific test or
manual check that demonstrated the fix. Do not push until it passes again.
