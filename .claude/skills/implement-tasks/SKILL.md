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
4. **Group by file overlap**: disjoint files → parallel sub-agents in **manual worktrees** (see step 2); overlapping files → one sequential sub-agent per group (one worktree, one merge) to avoid merge conflicts.
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

For each task that runs in isolation (parallel or sequential), **manage the worktree yourself** rather than passing `isolation: "worktree"` to the Agent tool. Why: the Agent tool's worktree isolation snapshots from the session-start ref, not current main HEAD — sub-agents launched after earlier merges can't see them and re-implement duplicate work, producing avoidable merge conflicts (validated 2026-04-22 in `.claude/skill-feedback.md`).

**Launch sequence per sub-agent:**

1. **Pre-create the worktree** from current main HEAD:
   ```bash
   git worktree add .claude/worktrees/agent-<short-id> main -b worktree-agent-<short-id>
   ```
   The `<short-id>` can be derived from the task number, a hash, or any unique tag. The branch always starts from current main, so it sees every merge that has landed in this session.
2. **Pre-symlink `node_modules`** so the sub-agent never has to think about it (this is one of the things that confuses agents about which checkout they're in):
   ```bash
   ln -s /Users/peter/Development/note-sage/node_modules .claude/worktrees/agent-<short-id>/node_modules
   ```
3. **Launch the Agent tool WITHOUT the `isolation` parameter.** Pass the absolute worktree path explicitly in the prompt under a "YOUR WORKTREE" header (do not require the agent to discover it via `pwd` — confirm only). Required prompt sections:
   - **YOUR WORKTREE header** with the explicit path, mandatory first actions: confirm path with `pwd` once, confirm `ls node_modules | head` resolves, every absolute path in Read/Edit/Write must start with the worktree path, every Bash command prefixed with `cd <worktree-path> &&` to anchor CWD. Without these guards, agents leak edits into the parent main checkout.
   - The task description and acceptance criteria from the breakdown file
   - The parent PRD (if one exists) for motivation and constraints
   - The files to create or modify (from the task's `Files` field)
   - `CLAUDE.md` for project conventions
   - The relevant feature doc (see CLAUDE.md's docs tables)
   - Any tests written in step 1 (the implementation must make them pass)
   - **Note in the prompt that the parent will commit on the agent's behalf** — the agent should NOT attempt to run `git add`/`git commit` (the harness denies git for non-isolated agents). Instead, the agent should report back with the list of files to stage and a proposed commit message; the parent runs the commit in step 3.
4. **For UI components**: the same sub-agent writes component tests after implementation (before returning).
5. **If a sub-agent fails or returns partial work**: do NOT merge. Report the failure to the user with the agent's last output and wait for direction.

### 3. Commit the agent's work + merge worktrees

For each sub-agent that returned with implementation work:

1. **Review the agent's report** for the file list + proposed commit message.
2. **Commit on the agent's behalf** from the parent (the harness denied git in the agent's context):
   ```bash
   git -C .claude/worktrees/agent-<short-id> add <specific files>
   git -C .claude/worktrees/agent-<short-id> commit -m "<agent's proposed message>"
   ```
   Stage specific files only — never `git add -A`.
3. **Review the worktree diff** against main: `git -C <worktree-path> diff main...HEAD`. Confirm only the expected files changed.
4. **Merge the branch** from the main checkout: `git merge worktree-agent-<short-id> --no-ff`. Auto-merge should usually succeed because the branch was started from current main HEAD (no stale base by construction).
5. **Resolve conflicts** if multiple worktrees modified adjacent code in the same file.
6. **Remove the worktree** and delete its branch: `git worktree remove -f -f <worktree-path> && git branch -d worktree-agent-<short-id>`.
7. Repeat for each completed worktree before proceeding to the test gate.

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
   - Task breakdown: add ` ✅` at the end of the task heading (e.g., `### #35 — Title ✅`). If the project has an aggressive markdown formatter that strips emojis or rewrites tables (e.g. `\|` table escapes get unescaped, breaking rows), use `git apply --cached` with a small patch instead of Edit/sed — that writes directly to the git index without touching the working tree, bypassing the formatter. Validated workaround as of 2026-04-22.
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
