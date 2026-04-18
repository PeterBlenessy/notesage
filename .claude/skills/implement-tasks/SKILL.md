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
2. For parallel tasks, use `isolation: "worktree"`. When you do, the sub-agent prompt **must instruct it to commit inside the worktree before returning** (include the expected commit message format). Do NOT tell it to "leave changes staged" — if the sub-agent returns with no commits, the runtime may clean up the worktree and the work is lost. The parent merges via `git merge <branch-name> --no-ff` (step 3).
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

Pause for tests requiring human judgment (visual, UX, cross-process, a11y). An unchecked PRD quality gate that no command can verify is a manual test — don't defer it silently.

1. **If manual tests are needed**: report what to test and wait for user confirmation
   - Be specific: name the gate and what to look at. Offer to walk through it together.
2. **If user reports issues**: fix and re-run the test gate from step 4
3. Do NOT proceed to finalize until any required manual tests are confirmed

### 6. Finalize

Before the task counts as done:

1. **Update docs** for anything affected by the change. Map changed code to the relevant doc using the tables in `CLAUDE.md` (general docs + feature-specific docs).
2. **Mark done** in BOTH files:
   - Task breakdown: add ` ✅` at the end of the task heading (e.g., `### #35 — Title ✅`)
   - PRD: if the task completes a PRD checkbox, mark it too
3. **Resolve remaining PRD quality gates.** Run them, hand them off with a concrete test proposal, or mark out-of-scope with a reason. Never leave a gate unchecked silently.
4. **Treat deferred acceptance criteria as incomplete.** If a sub-agent reports any criterion as "documented only", "deferred", "v1 fallback", or similar, the task is NOT done — surface it to the user and get explicit approval to ship in reduced form (with a follow-up plan) before marking ✅ or proposing a commit. See `feedback_full_coverage.md` in auto-memory.

### 7. Propose commit & wait for approval

1. **Show the user** the staged files and proposed commit message
2. **Do NOT commit** until the user explicitly approves ("go ahead", "commit it", etc.). "Looks good" on a diff is not approval for committing.
3. **On approval**: commit with the proposed message
4. **Run tests post-commit** to verify pre-commit hooks didn't break anything
5. **If post-commit tests fail**: fix and create a NEW commit (never --amend)

### 8. Report, log, wait

1. Report completion with a summary
2. **Log observations** to `.claude/skill-feedback.md` if anything about the implementation flow fell short (test gate unclear, sub-agent context gap, merge friction, etc.). Format per `/retrospect-skills`. Both user and agent contribute.
3. Wait for user go-ahead before the next task
4. **If this was the last task in the tasks file**, offer to run `/retrospect-skills tasks/<file>` to batch-review feedback. If the tasks file also completes a PRD, offer `/retrospect-skills prds/<prd>` for the lifecycle-wide retro.

## Guidelines

- **Never commit without explicit user approval** — propose the commit, wait for "go ahead". This applies even when all tests pass and no manual checkpoint was needed.
- **Tests are part of the implementation, not a follow-up** — every behavior change includes tests
- **One task = one commit** unless tasks are tightly coupled
- **Preserve existing behavior** — don't break other features
- If a task reveals issues beyond its scope, flag them — don't scope-creep
