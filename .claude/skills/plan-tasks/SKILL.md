---
name: plan-tasks
description: Break a PRD or feature into numbered implementation tasks
user-invocable: true
argument-hint: "<prd-or-feature>"
---

# Task Breakdown

Break a PRD or feature description into concrete, ordered implementation tasks.

## Process

1. **Read the source material:**
   - If a PRD path is given, read it
   - If a feature name is given, look for a matching PRD in `docs/prds/`
   - Read `docs/architecture.md` and `CLAUDE.md` for project conventions

2. **Identify work items** by decomposing the feature into atomic, implementable tasks.

3. **Output a numbered task list** with each task containing:

   | Field | Description |
   |-------|-------------|
   | **#** | Sequential number |
   | **Title** | Short imperative description (e.g., "Add git_status Tauri command") |
   | **Description** | What to implement, acceptance criteria |
   | **Complexity** | S (< 30 min), M (30 min - 2 hrs), L (2+ hrs) |
   | **Category** | `backend` (Rust/Tauri), `frontend` (React/TS), or `both` |
   | **Dependencies** | Task numbers that must complete first (e.g., "Depends on #1, #2") |
   | **Files** | Key files to create or modify |

4. **Order tasks** so dependencies come first. Group by layer when possible:
   - Backend (Tauri commands, Rust types) first
   - State management (Zustand stores) second
   - UI components last

5. **Include a header table** immediately after the `# ...` title:

   ```markdown
   |  |  |
   | --- | --- |
   | **Date** | YYYY-MM-DD |
   | **Status** | Not started |
   | **PRD** | [slug](../prds/YYYY-MM-DD-slug.md) |
   | **Total** | 12 tasks: 4S, 5M, 3L |
   | **Suggested order** | Backend (#1-#4) → State (#5-#6) → UI (#7-#12) |
   ```

   Follow the table with any risks or open questions.

6. **Save the task list** to `docs/tasks/YYYY-MM-DD-<slug>-tasks.md` where:
   - Date is today's date
   - Slug matches the PRD slug (e.g., PRD `docs/prds/2026-03-11-model-metadata-enrichment.md` → tasks file `docs/tasks/2026-03-11-model-metadata-enrichment-tasks.md`)
   - If no PRD exists, derive the slug from the feature name in lowercase-kebab-case

7. **Update the source research doc** if this task breakdown traces back to a research file in `docs/research/`:
   - Find the research file (check the PRD's header for a research reference, or match by topic)
   - Add or update a Tasks row in the research doc's pipeline table:

     ```markdown
     | Stage | Link | Status |
     | --- | --- | --- |
     | PRD | [slug](../prds/YYYY-MM-DD-slug.md) | Complete |
     | Tasks | [slug-tasks](../tasks/YYYY-MM-DD-slug-tasks.md) | Not started |
     ```

   - Valid statuses: `Not started`, `In Progress`, `Complete`, `Partial`, `Abandoned`, `Not planned`
   - If no research doc exists for this feature, skip this step

8. **Present a brief summary** to the user with the file path and task count.

## Guidelines

- Tasks should be small enough to complete in one sitting
- Each task should be independently testable
- Include "write tests" as explicit tasks where applicable
- Flag tasks that touch shared infrastructure or have high blast radius
- Reference existing patterns — don't reinvent (e.g., "Follow the pattern in `commands/file.rs`")
