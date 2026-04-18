# Skill Feedback

Append-only log. Entries processed by `/retrospect-skills`.

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
