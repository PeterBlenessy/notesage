---
name: retrospect-skills
description: Review accumulated skill-feedback entries and propose SKILL.md improvements, with per-change approval.
user-invocable: true
argument-hint: "[scope: all | tasks/<file> | prds/<file>]"
---

# Retrospect Skills

Read `.claude/skill-feedback.md`, group observations by skill, and propose concrete SKILL.md edits. Every change requires explicit user approval.

## Log format

Entries live in `.claude/skill-feedback.md` (append-only). Both the user (navigator) and the agent may append. Format per entry:

```markdown
## YYYY-MM-DD — <skill>[, <other-skill>] — <context>
- <Observation 1>
- <Observation 2>
```

**Context pointer** names the source of the observation:

- `task #35 of tasks/2026-04-10-feature-y.md`
- `tasks file tasks/2026-04-10-feature-y.md` (whole-batch observation)
- `PRD prds/2026-04-10-feature-y.md`
- `audit 2026-04-11-full → prd` (phase transition)
- `research research/<slug>.md → prd`

Processed entries move to `## Archived` at the bottom. Keep archived entries for history — recurrence is signal.

## Process

1. **Read** `.claude/skill-feedback.md`. If the file doesn't exist or has no unprocessed entries, tell the user and stop.

2. **Filter by scope** (from the argument):
   - No argument or `all` → all unprocessed entries
   - `tasks/<file>` → entries whose context references that tasks file or any `task #N of <file>` within it
   - `prds/<file>` → entries whose context references that PRD, its tasks files, or upstream transitions pointing at it

3. **Offer the user a chance to add observations** before processing: "Before I process the log, anything you want to add?" Append any replies to the log in the standard format (attributed as user).

4. **Group entries by skill.** An entry that references multiple skills appears under each.

5. **For each skill with entries:**
   - Read the current `SKILL.md` (and any `examples/` files it points at)
   - Draft the smallest edit that addresses the observations
   - Present the proposed edit to the user with the observations as justification
   - **Wait for explicit approval per skill** before editing. "Looks good" on a summary does not authorize the edit.
   - Apply the edit if approved; skip if declined

6. **Archive processed entries:**
   - Move them under a `## Archived` section at the bottom of `.claude/skill-feedback.md`
   - Prepend `### Reviewed YYYY-MM-DD` to the archived batch
   - If an entry was skipped (no edit made), append a one-line reason to it

7. **Summarize** to the user: which skills were updated, which were skipped (with reason), how many entries archived.

## Guidelines

- **Never edit a SKILL.md without explicit approval** — not even typos or added pointers. Each change is a judgment call.
- **Stay grounded in the log.** If an entry is vague, ask the user to clarify — don't embellish.
- **Prefer small targeted edits.** If three entries point at the same root cause, propose one edit that resolves all three, not three edits.
- **Surface patterns.** If the same observation has recurred across retros, say so — that's a strong signal the current wording isn't working.
- **If no edit is worth making** for a skill's entries, say so explicitly and archive with a reason.
- **Self-applies.** If `/retrospect-skills` appears in the log, propose edits to it like any other skill.
- **Never commit** the SKILL.md edits. The user reviews and commits separately per their usual flow.

ARGUMENTS: Optional scope — `all` (default), `tasks/<path>` (single tasks file), or `prds/<path>` (whole PRD lifecycle).
