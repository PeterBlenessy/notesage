---
name: Two-way PRD ↔ tasks file references
description: Every PRD must link to its tasks file and every tasks file must link back to the PRD — maintain bidirectional references always
type: feedback
originSessionId: b15f47f2-e328-49ce-8c07-319397f56739
aw_applies: yes
aw_applies_to: [aw-slice]
---
Always maintain a **two-way reference** between a PRD and its task breakdown file:

- The tasks file links back to the PRD (e.g., in the header `| PRD | [name](../prds/…)` row).
- The PRD links forward to the tasks file (e.g., a `Tasks` / `Implementation` row in the header table or a dedicated section).

**Why:** The user wants navigation to flow in both directions — from a PRD to its implementation plan, and from any task to the motivating PRD. One-way links force readers to hunt for the other side; two-way links make the relationship obvious.

**How to apply:**
- When creating a new tasks file via `/plan-tasks`, ensure the generated header includes the PRD link AND edit the PRD to add a tasks-file link if missing.
- When creating a new PRD via `/prd`, reserve a row/section for the tasks file link to be filled in once tasks are planned.
- When auditing existing PRDs/tasks, add missing reverse links as you go.
- When closing out a task breakdown (finalize step), verify both directions still resolve.
