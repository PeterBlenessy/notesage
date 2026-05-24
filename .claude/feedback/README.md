# `.claude/feedback/` — accumulated corrections that every AW skill must read

This directory is the **canonical source** for behavioural feedback the human operator has given in interactive Claude Code sessions. Every Agentic-Workflow (AW) skill loads the relevant rules from here as its first step (`Step 0`) before doing any work.

The hypothesis driving this directory's existence: interactive sessions are higher-quality than AW PRs because the operator corrects the agent in real time and the corrections accumulate in Claude Code's per-project memory (`~/.claude/projects/<project-slug>/memory/`). AW agents don't see that memory. Promoting the corrections here — into the repo — makes them visible to every AW invocation and lets the corpus travel with the project (clone, fork, copy to another repo).

## The contract

1. **Every `aw-*` skill's "Process" section begins with Step 0: "Load accumulated rules"** — read `.claude/feedback/INDEX.md` then read every rule whose `aw_applies` is `yes` or `with-modification`. Skipping this step is the single biggest cause of avoidable AW failures.

2. **`.claude/feedback/INDEX.md` is auto-generated** by `scripts/gen-feedback-index.py` from the YAML frontmatter of each rule file. Re-run after any rule add/edit. The script also generates per-skill curated lists so an agent can find "what applies to me" in one read.

3. **New corrections land here, in the repo.** When the operator corrects the agent in an interactive session and a memory entry is warranted, the file goes here (`.claude/feedback/`) — not into `~/.claude/projects/.../memory/`. Project-state memories (in-flight work, branch state, scratch notes) still live in `~/.claude/.../memory/`. Behavioural-correction memories live in the repo.

4. **The `aw_applies` field is mandatory** on every new rule:
   - `yes` — applies directly to AW; load on every relevant skill invocation.
   - `with-modification` — intent applies, AW reads "user" as the issue/PR thread. Include an `aw_note` explaining the modification.
   - `no` — interactive-session-only OR release-process-only OR dev-tooling AW doesn't encounter. Stays here for historical record but never loaded by skills.

5. **The `aw_applies_to` field lists the most-affected skills** (e.g., `[aw-tdd, aw-review]`). It's optional, defaults to "all" when absent. The list drives the per-skill curated index in `INDEX.md`.

## File shape

Every rule is a single `feedback_<slug>.md` file with this frontmatter:

```yaml
---
name: <human-readable name>
description: <one-line summary used in INDEX.md tables>
type: feedback
aw_applies: yes | with-modification | no
aw_applies_to: [aw-tdd, aw-review]    # optional, only when aw_applies != no
aw_note: "..."                          # optional, only when aw_applies == with-modification
---
<rule body, including **Why:** and **How to apply:** sections>
```

The body should be terse — agents read it under context pressure. ~5-20 lines is typical. Long rules indicate a rule that should be split.

## Writing rule content

Rules in this directory must be **generic and portable** — written so the corpus can be copied to another repo without rewording. That means:

- Do not name the operator, contributors, or any individuals. Use "the operator", "the agent", "the reviewer", or rephrase to avoid the subject entirely.
- Do not name the project, the product, the company, or the repository owner in the rule body OR description unless the rule is genuinely project-specific (e.g., a codebase convention that references a stack-specific store or design system). When project-specific, state the dependency explicitly so the rule can be copy-paste-adapted (e.g., "Notesage uses Zustand with…").
- Anti-pattern: "When peter says X, do Y." Generic version: "When the operator requests X, do Y."
- Anti-pattern: "Notesage's CI runs on…" (inside a rule about CI hygiene that applies anywhere). Generic version: "The repo's CI runs on…" — let the project supply the specifics.

The same constraint applies to infrastructure files in this directory (this README, INDEX.md, the generator script) — none of them should name the operator or hardcode the project.

## Adding a new rule

Manual path:
1. Create `feedback_<slug>.md` here with the frontmatter above.
2. Run `python3 scripts/gen-feedback-index.py` to regenerate `INDEX.md`.
3. Commit both files.

Automated path (after Phase 5 lands): the `save-feedback` skill writes the file + regenerates the index + stages the commit.

## Updating an existing rule

Edit the file in place. Re-run `gen-feedback-index.py`. Commit. The change is visible to the next AW invocation that loads `INDEX.md`.

## What this directory is NOT

- **Not project-state memory.** "Branch X is in-flight," "tag Y is the last green release" — those go in `~/.claude/.../memory/` as `project_*.md`. Behavioural rules only here.
- **Not skill prompts.** Skills live at `.claude/skills/<name>/SKILL.md`. The feedback files are inputs the skills read; they aren't themselves skills.
- **Not release notes / changelog.** Those are kept in the repo's history directory (typically `docs/history/`). Don't conflate.

## Maintenance

- The `aw_applies` triage is reviewed when bucket assignments seem stale (e.g., a `no` rule starts applying because AW gained a new responsibility).
- The escape-hatch language in `feedback_fix_all_*.md` and similar bounded-retry rules is the failsafe against "fix every problem" turning into "loop forever or sabotage tests to pass." Update it when AW exhibits a new flavour of runaway behaviour.
- Phase 6 of the original integration plan calls for a `VALIDATION.md` here that records, per recent failed AW PR, whether the loaded rules would have caught the failure. Add to it when a real failure happens.
