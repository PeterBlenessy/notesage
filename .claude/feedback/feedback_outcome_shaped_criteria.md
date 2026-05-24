---
name: Acceptance criteria must be outcome-shaped, not implementation-shaped
description: When a task's acceptance criteria name a file, line, function, or hook to modify, treat that as a *suggested* implementation — not the goal. The goal is the user-observable outcome. Verify the outcome before declaring done, even when the literal criteria are satisfied.
type: feedback
originSessionId: 49e083e5-2f1b-4151-a12c-6c29c84e04ea
aw_applies: yes
aw_applies_to: [aw-tdd, aw-review]
---
When a task's acceptance criteria name a file, line, function, or specific hook to modify, treat those as **suggested implementation hints**, not the actual completion bar. The completion bar is always the user-observable outcome. Verify the outcome — usually by running the leak repro or feature scenario manually — before declaring the task done.

**Why:** Task #6 of `2026-04-18-project-data-isolation-tasks.md` had criteria like "apply `isToolCallAllowed` in `useAcpSessionListeners.ts:299-312` before any auto-approval decision." I satisfied all five bullets literally, 71 tests passing, committed. Then the manual test reproduced the very leak the task was meant to close: Claude Code's permission modes never send `acp-permission-request` for reads, so the filter at the prescribed line is structurally incapable of seeing the violation. The criteria specified the wrong enforcement point. The user — quite rightly — pointed out that acceptance criteria should describe what the user gets, not where the code goes.

**How to apply:**
- Before starting any task, read its criteria. If they name files, lines, or functions, mentally rewrite them as outcome statements ("when the user does X, they should observe Y"). If you can't, ask the user to clarify the outcome.
- For tasks that close a known leak / security invariant: run the leak's repro from the audit BEFORE proposing the commit, not after. If the repro still works, the literal criteria are wrong — surface that before declaring done.
- For non-security tasks: run the user-observable scenario from the PRD before proposing the commit.
- When the literal criteria are met but the outcome isn't delivered, do NOT propose a commit. Surface the gap, propose either an extension (`#Nb`) or a rewrite of the criteria, and let the user decide.
- "All unit tests pass" is necessary but not sufficient. The unit test asserts the criterion as written; if the criterion is wrong, green tests don't help.
