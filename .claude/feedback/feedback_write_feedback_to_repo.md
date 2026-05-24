---
name: Behavioural-correction memories go in the repo, not local memory
description: When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).
type: feedback
aw_applies: yes
aw_applies_to: [all]
---

# Behavioural-correction memories go in the repo

**Rule:** In any project with a `.claude/feedback/` directory, when the agent needs to save a memory entry, classify the entry first:

- **Behavioural correction** (a rule for future work on similar tasks) → write to `.claude/feedback/feedback_<slug>.md` via the `save-feedback` skill. Visible to every AW skill's Step 0. Travels with the repo.
- **Project state** (in-flight branch, last-good commit, current decision in progress) → write to `~/.claude/projects/<project-slug>/memory/project_*.md`. Local-only. Does not need to be visible to AW or to other clones of the repo.

**Why:** Before this rule, behavioural corrections lived in `~/.claude/projects/<project-slug>/memory/feedback_*.md` — invisible to AW agents (which run in CI worktrees without that memory) and invisible to other clones of the repo (operators, contributors). The corpus accumulated locally but never shaped AW or another operator's work. Moving behavioural corrections into the repo (PR #337 / issue #336) fixed both problems. Maintaining that move means new corrections must default to `.claude/feedback/`.

**How to apply:**

1. When about to write a memory entry, ask: is this a rule that should change behaviour next time the agent hits a similar task? If yes → behavioural correction → `.claude/feedback/`.
2. Use the `save-feedback` skill — it handles the frontmatter (`aw_applies`, `aw_applies_to`), runs the indexer (`scripts/gen-feedback-index.py`), and stages the diff for operator review.
3. If the entry is genuinely project-state (in-flight work the agent needs to remember for the next session of this project specifically), write to `~/.claude/projects/<project-slug>/memory/project_*.md`. Keep the same `name` / `description` / `type` frontmatter shape used for other project memories.
4. When in doubt: default to the repo. A rule that lives in the repo can be reviewed and reverted; a rule that lives only in local memory is invisible.

**Anti-patterns:**

- Writing a behavioural-correction rule to `~/.claude/projects/<project-slug>/memory/feedback_*.md` in a project that has a `.claude/feedback/` directory. The rule becomes invisible to AW.
- Writing project-state to `.claude/feedback/`. The corpus is for portable rules, not per-clone scratch notes.
- Adding a rule directly to `.claude/feedback/` by hand (without the `save-feedback` skill). The skill regenerates `INDEX.md` and the per-skill curated sections in every `aw-*/SKILL.md` — skipping it leaves the new rule invisible to the curated lookups.
