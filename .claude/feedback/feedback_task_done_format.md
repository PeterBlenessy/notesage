---
name: Task completion marker format
description: Use checkmark emoji in task title to mark done, never use checkbox syntax
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd, aw-slice]
---

When marking tasks as done in task breakdown docs, add a checkmark emoji to the title heading — never use `- [ ] Done` checkbox syntax.

**Format:**
- Not done: `### #1 — Remove unused npm dependencies`
- Done: `### #1 — Remove unused npm dependencies ✅`

**Why:** User prefers the visual checkmark in the heading row itself rather than a separate checkbox line. It's more scannable and doesn't add clutter between the heading and description.

**How to apply:** When completing a task, edit the `### #N — Title` line to append ` ✅`. When generating new task docs, do not include any `- [ ] Done` lines.
