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
3. **Check task dependencies** — read the `Dependencies` field of each task. Tasks with unmet dependencies cannot run until their prerequisites complete.
4. **Group by file overlap**: disjoint files → parallel sub-agents with `isolation: "worktree"`; overlapping files → one sequential sub-agent per group (one worktree, one merge) to avoid merge conflicts.
5. **Flag blockers or ambiguities** before writing any code
6. **For 3+ tasks**: create a TaskCreate list to track progress

### 1. Write tests first

Before implementing, write tests that define the expected behavior:

| Task type | Test approach |
|-----------|--------------|
| Bug fixes | Write a failing test that reproduces the bug — red first, then fix to green |
| New utilities, hooks, stores | Define expected behavior as Vitest tests, then implement |
| New Tauri commands | Write Rust `#[test]` for the command logic, then implement |
| Refactors | Ensure existing behavior is covered by tests before changing code |
| UI components | Skip this step — write component tests after implementation (step 2) |

If the task doesn't change testable behavior (e.g., docs-only, config changes), skip this step.

### 2. Implement

For each task:

1. **Start a background sub-agent** with explicit context:
   - The task description and acceptance criteria from the breakdown file
   - The parent PRD (if one exists) for motivation and constraints
   - The files to create or modify (from the task's `Files` field)
   - `CLAUDE.md` for project conventions
   - The relevant feature doc (see CLAUDE.md's docs tables)
   - Any tests written in step 1 (the implementation must make them pass)
2. Use `isolation: "worktree"` for parallel tasks to avoid conflicts
3. The sub-agent implements the task following project conventions
4. **For UI components**: the same sub-agent writes component tests after implementation (before returning) to cover the new behavior
5. **If a sub-agent fails or returns partial work**: do NOT merge. Report the failure to the user with the agent's last output and wait for direction.

### 3. Merge worktrees

For tasks that ran in worktree isolation:

1. **Review the worktree diff** (`git -C <worktree-path> diff main...HEAD`) to confirm the changes are correct
2. **Merge the branch** from the main checkout: `git merge <branch-name> --no-ff`
3. **Resolve conflicts** if multiple worktrees modified adjacent code
4. **Remove the worktree** once merged: `git worktree remove <worktree-path>`
5. Repeat for each completed worktree before proceeding to tests

### 4. Test gate

1. **Frontend**: `/test-frontend` — typecheck + unit + markdown round-trip
2. **Coverage regression**: `/test-coverage` for changed files
3. **Performance**: `/test-perf` if the task touched startup, editor rendering, decorations, stores, or Tauri IPC hot paths (see that skill for baseline update rules)
4. **Rust**: `/test-rust` if Rust files changed
5. **If any fail**: fix and re-run. Do not proceed until green.
6. **Automatable acceptance criteria**: run commands to verify (file exists, output matches, config correct) — don't defer what a script can confirm
7. **Run `/review-code`** to catch convention violations
8. **If the task touches UI components**: run `/review-ui` for design system compliance

### 5. Manual test checkpoint

Pause only for tests requiring human judgment (visual appearance, UX feel, cross-process behavior, accessibility with a real screen reader). If everything is automatable, report results and proceed.

1. **If manual tests are needed**: report what to test and wait for user confirmation
2. **If user reports issues**: fix and re-run the test gate from step 4
3. Do NOT proceed to finalize until any required manual tests are confirmed

### 6. Finalize

Before the task counts as done:

1. **Update docs** for anything affected by the change. Map changed code to the relevant doc using the tables in `CLAUDE.md` (general docs + feature-specific docs).
2. **Mark done** in BOTH files:
   - Task breakdown: add ` ✅` at the end of the task heading (e.g., `### #35 — Title ✅`)
   - PRD: if the task completes a PRD checkbox, mark it too

### 7. Propose commit & wait for approval

1. **Show the user** the staged files and proposed commit message
2. **Do NOT commit** until the user explicitly approves ("go ahead", "commit it", etc.). "Looks good" on a diff is not approval for committing.
3. **On approval**: commit with the proposed message
4. **Run tests post-commit** to verify pre-commit hooks didn't break anything
5. **If post-commit tests fail**: fix and create a NEW commit (never --amend)

### 8. Report & wait

Report completion with a summary. Wait for user go-ahead before the next task.

## Guidelines

- **Never commit without explicit user approval** — propose the commit, wait for "go ahead". This applies even when all tests pass and no manual checkpoint was needed.
- **Tests are part of the implementation, not a follow-up** — every behavior change includes tests
- **One task = one commit** unless tasks are tightly coupled
- **Preserve existing behavior** — don't break other features
- If a task reveals issues beyond its scope, flag them — don't scope-creep
