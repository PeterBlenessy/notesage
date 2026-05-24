---
name: No commit while iterating
description: Don't commit until the user confirms we're done — stop making piecemeal commits during active testing/feedback cycles
type: feedback
aw_applies: no
---

Do NOT commit changes while the user is still testing and giving feedback. Wait until the user explicitly says we're done or asks to commit.

**Why:** The user was frustrated by rapid piecemeal commits during an active feedback cycle where issues were still being found and fixed. Each commit felt premature because the next screenshot revealed more problems.

**How to apply:** During iterative UI/UX work where the user is testing in real-time, accumulate all fixes and only commit when the user confirms the feature is ready. Ask "want me to commit?" or wait for "commit this".
