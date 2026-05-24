---
name: save-feedback
description: Save a behavioural correction the operator just gave into `.claude/feedback/` as a new rule. Writes the file with proper frontmatter, regenerates `.claude/feedback/INDEX.md` and the per-skill curated sections, and stages the changes for commit. Use when the operator says "save this as feedback", "remember this rule for AW", or similar.
---

# save-feedback

When the operator corrects the agent (interactive session or PR thread) in a way that should apply to future work, save the correction as a new `feedback_*.md` rule in `.claude/feedback/`. After Phases 1-4 of #336, anything saved here is loaded by every AW skill's Step 0 — i.e., the correction takes effect across the AW pipeline, not just the current session.

## When to use

Invoke this skill when:

- The operator explicitly says "save this as feedback", "save this as a rule", "remember this for AW", "add this to the corpus", or similar.
- The operator corrects a recurring pattern of behaviour (not a one-off context-specific instruction) and the correction would help on a future similar task.

Do NOT use this skill for:

- Project-state memory ("PR #X is in flight", "branch Y is the last good commit"). Those go in `~/.claude/projects/<project-slug>/memory/` as `project_*.md`. Save-feedback is for behavioural-correction rules only.
- One-off instructions specific to the current task ("for this PR, use Y instead of X"). Those belong in the conversation, not the rule corpus.
- Personal preferences that don't generalise ("I prefer terse responses"). Those belong in the operator's CLAUDE.md, not the project's `.claude/feedback/`.

## Process

1. **Confirm the rule.** Echo back a one-sentence summary of the rule to the operator. Confirm:
   - What the rule says (the actual behavioural correction).
   - Whether it applies to AW agents (`aw_applies: yes | with-modification | no`).
   - Which AW skill(s) it most affects (one or more of `aw-triage`, `aw-refine`, `aw-slice`, `aw-tdd`, `aw-review`, `aw-iterate`, `aw-ci-repair`, `aw-retrospect`, `aw-feedback`, or `all`).
   - If `with-modification`, the one-line `aw_note` explaining the modification.

   Only proceed once the operator confirms. The corpus loses value when rules are added without operator review.

2. **Pick a slug.** Derive a short kebab-case slug from the rule (e.g., `fix_all_test_failures`, `outcome_shaped_criteria`). Prepend `feedback_`. The full filename is `feedback_<slug>.md`. If a file with that slug already exists in `.claude/feedback/`, propose updating the existing rule instead of creating a new one (duplicates fragment the corpus).

3. **Write the file.** Create `.claude/feedback/feedback_<slug>.md` with this frontmatter:

   ```yaml
   ---
   name: <human-readable name>
   description: <one-line summary used in INDEX.md tables>
   type: feedback
   aw_applies: yes | with-modification | no
   aw_applies_to: [skill, skill, ...]    # omit when aw_applies: no
   aw_note: "..."                         # only when aw_applies: with-modification
   ---

   <rule body — terse, ~5-20 lines, with **Why:** and **How to apply:** sections>
   ```

   The body must follow `feedback_generic_voice`: no personal names, no project-specific hardcodes unless the rule genuinely depends on a project-specific surface (in which case state the dependency).

4. **Regenerate indexes.** Run:

   ```bash
   python3 scripts/gen-feedback-index.py
   ```

   This rewrites `.claude/feedback/INDEX.md` AND the auto-generated section at the bottom of every `aw-*/SKILL.md`. The new rule is now visible to every AW skill's Step 0 and to the per-skill curated list.

5. **Stage the changes.** Do NOT commit. Stage the files so the operator can review the diff:

   ```bash
   git add .claude/feedback/feedback_<slug>.md .claude/feedback/INDEX.md .claude/skills/
   git status -sb
   ```

   Tell the operator: "Staged. Review `git diff --staged` and commit when ready."

## Anti-patterns

- **Adding a rule without operator confirmation.** The agent's job is to capture the rule the operator stated, not to invent one. Always confirm before writing.
- **Hardcoding individuals or project names in the rule body.** Per `feedback_generic_voice`, rules must be portable. Substitute "the operator" / "the agent"; substitute "the repo's CI" / "the project's design system" / etc.
- **Saving project-state as feedback.** "Branch X is the latest" is project state, not a behavioural rule. Wrong tool — write to `~/.claude/projects/<project-slug>/memory/` as `project_*.md` instead.
- **Skipping the regenerator.** A new file in `.claude/feedback/` that isn't in `INDEX.md` or the per-skill sections is invisible to AW. Always run the generator.
- **Committing on the operator's behalf.** Saving feedback is a small change but it shapes future AW behaviour — the operator should always see the diff before commit.

## Comment templates

**Confirmation (before writing):**

```
Proposed feedback rule:

- **Name:** <human-readable name>
- **Slug:** `feedback_<slug>`
- **AW applies:** `<yes | with-modification | no>` → `[<skills>]`
- **Body:** <one-paragraph summary>

OK to write? (or: edit the body / slug / skills first)
```

**After staging:**

```
Saved as `.claude/feedback/feedback_<slug>.md`. Indexes regenerated:

- `.claude/feedback/INDEX.md` updated (now N rules)
- `.claude/skills/aw-*/SKILL.md` curated sections updated where applicable

Staged but not committed. Review with `git diff --staged` and commit when ready.
```
