---
name: Never commit without user confirmation
description: Always wait for explicit user approval before committing — show what changed and ask first
type: feedback
aw_applies: no
---

NEVER commit without the user saying to commit. After making changes, summarize what was changed and ask the user to verify/test before committing. The user wants to manually confirm things work before anything is committed.

**Why:** The user has been burned multiple times by premature commits that contained bugs (missed INSERT OR REPLACE, sidecar naming, lib/ check breaking prod). Rushing to commit means shipping broken code.
**How to apply:** After code changes, say "here's what changed — please test and let me know when to commit." Never auto-commit, never commit in the same message as the code change.
