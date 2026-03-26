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

### 1. Write tests first

Before implementing, write tests that define the expected behavior:

| Task type | Test approach |
|-----------|--------------|
| Bug fixes | Write a failing test that reproduces the bug — red first, then fix to green |
| New utilities, hooks, stores | Define expected behavior as Vitest tests, then implement |
| New Tauri commands | Write Rust `#[test]` for the command logic, then implement |
| Refactors | Ensure existing behavior is covered by tests before changing code |
| UI components | Skip this step — write component tests after implementation (step 3) |

If the task doesn't change testable behavior (e.g., docs-only, config changes), skip this step.

### 2. Implement

For each task (parallel or sequential depending on pre-flight):

1. **Start a background sub-agent** with explicit context:
   - The task description and acceptance criteria from the breakdown file
   - The files to create or modify (from the task's `Files` field)
   - `CLAUDE.md` for project conventions
   - The relevant feature doc (e.g., `docs/features/editor.md` for editor tasks — see the docs table in step 6)
   - Any tests written in step 1 (the implementation must make them pass)
2. Use `isolation: "worktree"` for parallel tasks to avoid conflicts
3. The sub-agent implements the task following project conventions
4. **For UI components**: write component tests after implementation to cover the new behavior

### 3. Merge worktrees

For tasks that ran in worktree isolation:

1. **Review the worktree diff** to confirm the changes are correct
2. **Merge the worktree branch** into the working branch
3. **Resolve any conflicts** if multiple worktrees modified adjacent code
4. Repeat for each completed worktree before proceeding to tests

### 4. Test gate

When implementation is merged:

1. **Run automatic tests** (`/test`)
2. **If tests fail**: fix and re-run. Do not proceed until green.
3. **Run automatable verifications** — if the task's acceptance criteria can be verified by running commands (checking file existence, running scripts, verifying output), do it now. Don't defer to the user what a script can confirm.
4. **Run `/review-code`** for M and L complexity tasks to catch convention violations
5. **If task touches UI components**: run `/review-ui` for design system compliance

### 5. Manual test checkpoint

Only pause for tests that genuinely require a human:

| Requires human | Does NOT require human |
|----------------|----------------------|
| Visual appearance, animations, transitions | File exists, command runs, output matches |
| UX feel, interaction flow | Config values are correct |
| Cross-process behavior (Tauri IPC in real app) | Test suite passes |
| Accessibility with real screen reader | Script produces expected output |

1. **If there are truly manual tests**: report what to test and wait for user confirmation
2. **If everything is automatable**: report results and proceed — no need to block
3. **If user reports issues**: fix and re-run the test gate from step 4
4. Do NOT proceed to marking done until any required manual tests are confirmed

### 6. Mark done

1. **Task breakdown file**: add ` ✅` at the end of the task heading (e.g., `### #35 — Title ✅`)
2. **PRD file**: if the task completes a PRD checkbox, mark it too

### 7. Update docs

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

### 8. Commit

1. **Stage** the implementation files, tests, task breakdown, and updated docs
2. **Commit** with a descriptive message
3. **Run tests post-commit** to verify pre-commit hooks didn't break anything
4. If post-commit tests fail, fix and create a new commit

### 9. Report & wait

1. **Report completion** to the user with a summary of what was done
2. **Wait for user go-ahead** before starting the next task
3. User may clear context, ask follow-up questions, or request changes

## Guidelines

- **Every task that adds or changes behavior must include corresponding tests** — no exceptions. Tests are part of the implementation, not a follow-up.
- **Never commit without user confirmation** when manual testing is required
- **Never skip the test gate** — all automatic tests must be green
- **One task = one commit** unless tasks are tightly coupled
- **Preserve existing behavior** — don't break other features
- Follow the task done format: `### #N — Title ✅` (no checkbox lines)
- If a task reveals issues beyond its scope, flag them — don't scope-creep
