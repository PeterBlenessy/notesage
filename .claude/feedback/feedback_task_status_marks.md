---
name: Mark tasks 🚧 on start, ✅ on done
description: In tasks files, mark a task 🚧 when work is kicked off (by me or a sub-agent), flip to ✅ when the work lands — both via git apply --cached to bypass the formatter.
type: feedback
originSessionId: ee599a9a-e3d1-4f11-9453-8a3f996a0018
aw_applies: yes
aw_applies_to: [aw-tdd, aw-slice]
---
When implementing tasks from a tasks file, the task heading must carry an explicit status mark at both endpoints:

- `🚧` at the heading when work starts (personally picking it up OR launching a sub-agent in a worktree for it)
- Flip `🚧` → `✅` when the work lands on main

**Why:** The user frequently has to remind me to flip tasks to ✅ at the end. Marking 🚧 at the start creates a visible "unfinished" signal — the pair (🚧 start, ✅ end) is less likely to be missed than a single end-only mark. Previously only ✅ was formalised; the 🚧 half is a new expectation from 2026-04-23.

**How to apply:**

- In the tasks file (`docs/tasks/*.md`), on the `### #N — Title` heading.
- Both marks go in via `git apply --cached` — this repo has a hidden markdown formatter that strips emoji on Edit/sed writes to the working tree (already documented elsewhere).
- For a multi-task batch, add all 🚧 marks in one patch before launching the parallel agents; add all ✅ marks in one patch after all merges land.
- For sequential tasks, flip each individually as it transitions.
- Do NOT touch the tasks file from inside the worktree — the parent owns task-status marks.
