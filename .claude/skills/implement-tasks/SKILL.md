---
name: implement-tasks
description: Implement tasks from a task breakdown file with parallel sub-agents, test gates, and doc updates
user-invocable: true
argument-hint: "<task-file> [task-numbers]"
---

# Implement Tasks

Execute tasks from a task breakdown file with quality gates, parallel execution where safe, and systematic documentation updates.

## Process

### 0. Pre-flight

1. **Read the task breakdown file** specified by the user
2. **Identify the tasks** to implement (user specifies task numbers, e.g., "#35 - #38")
3. **Check task dependencies** — read the `Dependencies` field of each task. Tasks with unmet dependencies cannot run until their prerequisites complete, regardless of file overlap.
4. **Analyze file overlap** among dependency-free tasks:
   - If tasks touch **disjoint files**: run in parallel using background sub-agents with `isolation: "worktree"`
   - If tasks touch **overlapping files**: run sequentially, or group overlapping tasks together
5. **Flag blockers or ambiguities** before writing any code

### 1. Implement

For each task (parallel or sequential depending on pre-flight):

1. **Start a background sub-agent** with explicit context:
   - The task description and acceptance criteria from the breakdown file
   - The files to create or modify (from the task's `Files` field)
   - `CLAUDE.md` for project conventions
   - The relevant feature doc (e.g., `docs/features/editor.md` for editor tasks — see the docs table in step 5)
2. Use `isolation: "worktree"` for parallel tasks to avoid conflicts
3. The sub-agent implements the task following project conventions

### 2. Merge worktrees

For tasks that ran in worktree isolation:

1. **Review the worktree diff** to confirm the changes are correct
2. **Merge the worktree branch** into the working branch
3. **Resolve any conflicts** if multiple worktrees modified adjacent code
4. Repeat for each completed worktree before proceeding to tests

### 3. Test gate

When implementation is merged:

1. **Run automatic tests** (`/test`)
2. **If tests fail**: fix and re-run. Do not proceed until green.
3. **Run `/review-code`** for M and L complexity tasks to catch convention violations
4. **If task touches UI components**: run `/review-ui` for design system compliance

### 4. Manual test checkpoint

1. **Report to user**: what was changed, what to test manually
2. **Wait for user confirmation** that manual testing passes
3. Do NOT proceed to marking done until the user confirms
4. **If user reports issues**: fix and re-run the test gate from step 3

### 5. Mark done

1. **Task breakdown file**: add ` ✅` at the end of the task heading (e.g., `### #35 — Title ✅`)
2. **PRD file**: if the task completes a PRD checkbox, mark it too

### 6. Update docs

Update relevant documentation to reflect the changes:

| Changed | Update |
|---------|--------|
| Tauri commands | `docs/tauri-commands.md` |
| UI components / design | `docs/design-system.md` |
| Editor / extensions | `docs/features/editor.md`, `docs/features/editor-architecture.md` |
| AI providers / agents | `docs/features/ai-providers.md` |
| AI workflows / chat | `docs/features/ai-workflows.md` |
| Workspace / files / git | `docs/features/workspace.md` |
| Document formats | `docs/features/document-formats.md` |
| Keyboard shortcuts | `docs/keyboard-shortcuts.md` |
| Architecture / stores | `docs/architecture.md` |

Only update docs that are actually affected by the changes.

### 7. Commit

1. **Stage** the implementation files, task breakdown, and updated docs
2. **Commit** with a descriptive message
3. **Run tests post-commit** to verify pre-commit hooks didn't break anything
4. If post-commit tests fail, fix and create a new commit

### 8. Report & wait

1. **Report completion** to the user with a summary of what was done
2. **Wait for user go-ahead** before starting the next task
3. User may clear context, ask follow-up questions, or request changes

## Guidelines

- **Never commit without user confirmation** that manual testing passes
- **Never skip the test gate** — all automatic tests must be green
- **One task = one commit** unless tasks are tightly coupled
- **Preserve existing behavior** — don't break other features
- Follow the task done format: `### #N — Title ✅` (no checkbox lines)
- If a task reveals issues beyond its scope, flag them — don't scope-creep
