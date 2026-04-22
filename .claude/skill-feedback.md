# Skill Feedback

Append-only log. Entries processed by `/retrospect-skills`.

## 2026-04-22 — implement-tasks — tasks file tasks/2026-04-21-ui-refresh-phase1-tasks.md (validation run for the manual-worktree trial)
- Validated the manual-worktree approach with task #9 (FloatingCommandBar shell). Pre-created the worktree via `git worktree add .claude/worktrees/agent-cmd9 main -b worktree-agent-cmd9` from current main HEAD `fc5e2cd`, pre-symlinked `node_modules`, called Agent **without** the `isolation: "worktree"` parameter, passed the worktree path in the prompt under a "YOUR WORKTREE" header that named the path explicitly (no discovery via `pwd` needed beyond confirmation).
- Result: **clean run.** Agent confirmed `pwd`, confirmed symlink, stayed in worktree paths, no leaks to main checkout. 11/11 new tests pass. Auto-merge into main was conflict-free — exactly what the manual approach was supposed to fix vs. the stale-base failures of #3 and #5 earlier in this session. Total session test count: 3160 → 3167 (+7 from #9).
- **New finding worth capturing:** Agent reported that all `git` commands (including `git status`) returned "Permission to use Bash has been denied" — the harness apparently scopes git permission to the parent's main checkout when the Agent isn't launched with `isolation: "worktree"`. Workaround: parent commits the agent's work via `git -C <worktree-path> add <files> && git -C <worktree-path> commit -m '...'`. Adds one step but isn't blocking — the agent's actual implementation work was unaffected.
- → SKILL.md change (now confirmed safe to land — pending user approval): replace `isolation: "worktree"` recipe with a manual-worktree recipe. Include the explicit-path "YOUR WORKTREE" prompt header. Note that the parent commits on the agent's behalf because the Agent harness denies git when launched without the isolation flag.

## 2026-04-22 — implement-tasks — tasks file tasks/2026-04-21-ui-refresh-phase1-tasks.md
- Sub-agents launched with `isolation: "worktree"` branched their worktrees from a stale ref (the session-start commit, observed merge-base `9953eb5`), not from current main HEAD at launch time. After Batch A merged into main, the worktrees for #3 (Batch B) and #5 (Batch C) couldn't see #1's `uiPreview` work and re-implemented duplicate scaffolding in `settings-store.ts`. Caused two non-trivial merge conflicts (~10 min each) that were avoidable. Same with #5 vs #3 — settings-store accumulated duplicates because each worktree branched independently from old main.
- Root cause: Agent tool's worktree creation appears to snapshot the working tree at session-start time, not at Agent-launch time. The skill currently has no instruction for the agent to rebase or pull before working, so they operate against stale state.
- Trialing a fix this session: stop using `isolation: "worktree"` for batches that build on each other. Instead, manually `git worktree add .claude/worktrees/agent-X main -b worktree-agent-X` from current main HEAD, pre-symlink `node_modules`, then call Agent without isolation and pass the worktree path in the prompt. Validates next batch.
- → SKILL.md candidate change (only if trial succeeds): replace the current "use `isolation: \"worktree\"`" guidance with a "create worktree manually from current main HEAD" recipe, including the symlink step.

## 2026-04-22 — implement-tasks — tasks file tasks/2026-04-21-ui-refresh-phase1-tasks.md
- Three of four sub-agents in Batch A (#1, #2, #4) initially edited the parent's main checkout before noticing they were in a worktree. Each ran `git checkout --` to revert tracked files, but #2 had created a new file (`ThemeProvider.test.tsx`) that `git checkout --` doesn't remove — left as an untracked leak in main that I had to delete before merging. Pattern repeated until I added a "YOUR WORKTREE" header to every prompt mandating `pwd` first, the symlink, and a path-prefix discipline rule. Batches B and C had zero leaks.
- Root cause: Bash CWD doesn't persist between tool calls, and the agent's mental model of "current directory" drifts. Combined with `node_modules` being missing in the worktree (forcing the agent to think about both paths), the slip is easy.
- → SKILL.md should bake in the "YOUR WORKTREE" prompt boilerplate as a required section for every sub-agent prompt that uses worktree isolation: mandatory `pwd` first action, mandatory `node_modules` symlink (pre-populated by the parent if the manual-worktree fix above lands), mandatory path-prefix and `cd <worktree> &&` discipline.

## 2026-04-22 — implement-tasks — tasks file tasks/2026-04-21-ui-refresh-phase1-tasks.md
- Editing the tasks file via the Edit tool repeatedly produced linter side-effects: `\|` table escapes were stripped (truncating #1's description), `~` in headers was escaped to `\~`, `>` was HTML-escaped to `&gt;`, `[` and `]` to `\[` `\]`, and ✅ task markers were silently stripped from headings post-commit. The user discovered missing ✅ marks for #3, #5, #6, #8 even though my commits clearly added them — restoring from HEAD fixed the working tree but the underlying mangling kept happening on subsequent writes. I worked around it with `git apply --cached` (writes directly to git index without touching working tree), which bypasses the formatter.
- Root cause: unknown — no git hook, no husky, no prettier/markdownlint config in repo, no relevant VSCode extensions in `.vscode/extensions.json`. Possibly a global editor formatter on save, or something internal to the harness.
- → For tasks-file ✅ markers and other markdown table edits where escaping matters, prefer `git apply --cached` over Edit/sed. The `implement-tasks` SKILL.md could mention this as the safe path for marking task headings done in projects that have aggressive markdown formatters.

## Archived

### Reviewed 2026-04-18

## 2026-04-18 — implement-tasks — tasks file tasks/2026-04-18-acp-protocol-tail-tasks.md
- Dispatched a sub-agent with `isolation: "worktree"` and prompted it with "Do not commit — leave changes staged for the parent to review." The runtime cleaned up the worktree on return because no commits existed, and the agent returned no worktree path. Work was recoverable only because changes somehow also landed in the main working tree. → SKILL.md now explicitly forbids "leave staged" with worktree isolation and requires sub-agents to commit before returning.

## 2026-04-18 — implement-tasks — task #10 of tasks/2026-04-18-acp-protocol-tail-tasks.md
- Task #10 (stored-artifact fast path) was returned by the sub-agent as "documented only, not implemented — acceptable per v1 framing." I bundled it into the Phase 3 commit with a caveat flagged at commit time. Per `feedback_full_coverage.md`, the skill should have stopped and asked for explicit approval before marking the task ✅ or including it in a commit proposal. → SKILL.md now treats "deferred / documented only / v1 fallback" responses as NOT done until the user explicitly approves reduced scope.

## 2026-04-18 — plan-tasks, prd — tasks file tasks/2026-04-18-acp-protocol-tail-tasks.md
- User established a durable rule mid-session: PRDs and tasks files must have two-way links (PRD → Tasks row, tasks file → PRD row). The PRD for this batch had only the tasks-file missing; had to add it retroactively. → `plan-tasks` now updates the PRD header with a Tasks row when creating a tasks file; `prd` reserves a Tasks row placeholder in the header template for `plan-tasks` to fill in.

### Reviewed 2026-04-17

## 2026-04-17 — implement-tasks — tasks file tasks/2026-04-17-acp-rich-tool-content-tasks.md
- At task completion I left a PRD quality gate unchecked ("Looks correct in both light and dark mode — requires manual visual verification") and moved on. The user pointed out I should have surfaced the unticked gate explicitly and proposed testing exactly that remaining item. It was a small, scoped check — the cost of asking was trivial and would have closed the loop properly.
- Root cause: the skill's "Manual test checkpoint" step says to pause for things requiring human judgment, but in practice I treated visual/theme checks as deferrable rather than as a concrete manual test to run before finalize. The skill should make clear that remaining unchecked PRD quality gates block "done" — either run them, hand off to the user to run, or explicitly skip with reasoning.
