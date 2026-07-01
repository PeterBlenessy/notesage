---
name: Mark PRD tasks done too
description: When completing tasks, mark them done in BOTH the task breakdown file AND the PRD — headings and checkboxes
type: feedback
aw_applies: yes
aw_applies_to: [aw-tdd]
---

When completing implementation tasks, mark them as done in BOTH files:
1. `docs/tasks/*.md` — the task breakdown (heading with ✅)
2. `docs/prds/*.md` — the PRD (heading with ✅ AND check off quality gate checkboxes `[ ]` → `[x]`)

**Why:** User explicitly corrected this — marking only the task file is incomplete. The PRD is the source of truth for what's been accomplished.

**How to apply:** After completing each task, update both files before committing. Check off all applicable quality gate checkboxes in the PRD too.
