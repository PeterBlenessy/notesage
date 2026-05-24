---
name: aw-release-notes
description: Rewrite a release's `## Changes` section into editorial user-facing prose — handles both alpha cuts and stable promotions
metadata:
  type: skill
  aw_applies: yes
  aw_applies_to: [aw-alpha-cut, release]
---

# aw-release-notes

This skill serves **both** release paths:

1. **Alpha cut** (automated): `aw-alpha-cut.yml` invokes you after writing the placeholder file for a new alpha tag. Input scope = PRs since the previous alpha.
2. **Stable promotion** (manual): the user-invocable `/release` skill invokes you when promoting the latest alpha series to stable. Input scope = PRs since the previous stable tag + all alpha history files in between.

The two paths share the editorial rules but diverge in scope and consolidation behaviour.

## Step 0 — Load accumulated rules

Read `.claude/feedback/INDEX.md` and load the `feedback_*.md` files whose `aw_applies_to` frontmatter includes `aw-alpha-cut` OR `release` OR `all`. At minimum:

- `feedback_user_facing_release_notes.md` — the published-prose contract
- `feedback_release_notes_match_shipped.md` — only include what actually shipped
- `feedback_promote_alpha_from_alpha_not_main.md` — stable promotion is from an alpha commit, not main HEAD

## Step 1 — Determine the mode

You are invoked with these environment variables set:

| Variable | Set in mode | Description |
|---|---|---|
| `MODE` | both | Literal string `alpha` or `stable` |
| `HISTORY_FILE` | both | Absolute path to the target file to rewrite |
| `NEXT_VERSION` | both | Version being cut (e.g. `0.45.0-alpha.5` or `0.46.0`) |
| `PR_NUMBERS` | both | Comma-separated merged PR numbers in scope |
| `PREVIOUS_TAG` | both | Previous tag the bundle is computed against |
| `PRIOR_ALPHA_FILES` | stable only | Newline-separated paths to alpha history files in the series being consolidated |

If `MODE` is unset, infer from `NEXT_VERSION`: contains `-alpha.` → `alpha`; otherwise → `stable`. Refuse if `PRIOR_ALPHA_FILES` is missing in stable mode — stable consolidation needs the series.

## Step 2 — Read the inputs (both modes)

1. The placeholder file at `HISTORY_FILE` — note the existing `## Under the hood` PR-title dump.
2. Every PR in `PR_NUMBERS` via `gh pr view <n> --json title,body,files,additions,deletions,labels` — title for scan, body for stated user value, files for blast radius, labels for tier.
3. `.claude/skills/release/SKILL.md` § "User-facing copy vs Under the hood" — the authoritative tone guide.
4. The two most recent `docs/history/*.md` files that DO NOT contain `_No user-visible changes._` — tone/structure anchor.

## Step 3 — Stable-mode also reads the alpha series

In stable mode, additionally read every file path listed in `PRIOR_ALPHA_FILES`. These are the alpha history files (already prose-rewritten by this skill on each cut). They tell you what the alpha testers were told. Use them as the substrate for consolidation, NOT as content to copy verbatim.

## Step 4 — Editorial judgment

### Both modes — what belongs where

- A PR earns a `## Changes` bullet ONLY if a non-technical user opening the in-app "What's new" would notice or care.
- New end-user behaviour → `### Features`.
- Behaviour improvement, perf, UI polish that users will perceive → `### Improvements`.
- Bug fixes for behaviour users would have hit → `### Fixes`.
- AW pipeline changes, internal refactors, CI/test infrastructure, dependency bumps — do NOT go in `## Changes`. They go in `## Under the hood`.
- Consolidate clusters: 5 dep-bump PRs becomes "Various dependency updates." in `## Under the hood`, NOT 5 bullets.

### Alpha-mode — delta only

The audience is the small group of alpha testers running the build today. They want to know what changed since the previous alpha. Be specific. Include alpha-only fixes ("fixed crash that some testers hit in alpha.4"). They are exactly the people who would have hit that crash.

If NOTHING in the bundle is user-visible (pure infra / AW tooling), leave `## Changes` as `_No user-visible changes._` AND replace the auto-generated intro paragraph with: `Infrastructure-only release. No user-visible changes vs ${PREVIOUS_VERSION}.` — this is the linter-recognized opt-out.

### Stable-mode — cumulative net delta with alpha-noise filter

The audience is everyone who runs stable. They have never seen any alpha. Apply these filters to the input PRs and the prior alpha files:

**DROP from `## Changes` (move to nothing, not even Under the hood):**

- Bug fixes whose bug was introduced AND fixed entirely within the alpha series. The stable user never saw the bug; the fix is invisible to them. Look for patterns like "fixed regression from alpha.N" or PRs whose body says "fixes #X" where #X was opened AFTER the previous stable tag AND closed before stable.
- Iterative refinements to a feature that lands net-new in this stable. If `alpha.1` added "feature X", `alpha.2` polished X's UI, and `alpha.4` fixed an X bug — the stable bullet is ONE bullet about "feature X", not three.
- AW pipeline / CI / internal refactors that landed during the alpha series. Already excluded from `## Changes` per general rules.

**KEEP and CONSOLIDATE in `## Changes`:**

- Net-new user-visible features (across the entire alpha series).
- Net improvements that survive to stable (one bullet per area, not per PR).
- Bug fixes for behaviour that existed on the PREVIOUS stable — those are real user-visible fixes regardless of when the fix landed in the alpha series.

**Under the hood (stable mode):**

Reduce, don't enumerate. The previous stable's user is reading the stable changelog at upgrade time. They want a feel for what changed below the surface, not a per-alpha history. 1–4 short paragraphs grouped by area. Mention specific PRs only when a curious reader would want the deeper link.

## Step 5 — Write the prose

For each `## Changes` bullet (both modes):

- Lead with a bold one-line summary the user can scan.
- Follow with 1–3 sentences in plain English. Describe what the user will notice or can now do, not what file changed or which subsystem moved.
- Forbidden in `## Changes` (linter blocks): version triples like `3.23.4`, internal jargon ("crate", "transitive", "Dependabot"), PR numbers, file paths.
- All of those ARE fine — and welcome — in `## Under the hood`.

For `## Under the hood`:

- Group by area (one `### Subsection` per logical theme).
- Each subsection is 1–3 short paragraphs covering: what changed, why, what numbers if applicable, with PR references in parens at the end.
- Mention PR numbers inline: `(PR #346)` or `(PR #346, closes #325)`.
- In alpha mode: replace the auto-dump's flat PR-title list with this structured prose.
- In stable mode: reduce further. Aim for paragraphs that synthesize the alpha series, not enumerate every PR.

## Step 6 — Rewrite the file

Use the `Edit` tool to replace the body content while keeping the file header intact (title, Date, Previous version, Channel lines).

If the bundle has zero user-visible work, ALSO replace the auto-generated intro paragraph ("Auto-cut by `aw-alpha-cut`…") with the explicit `Infrastructure-only release. No user-visible changes vs vPREV.` opt-out. The blocking linter recognizes that exact phrase shape.

## Step 7 — Regenerate the changelog JSON

Run `pnpm generate-changelog` to update both `public/changelog.json` (stable feed) and `public/changelog-alpha.json` (alpha feed) from the new history file content. The linter will report any pattern violations in your new prose; if it reports any in YOUR entry (not pre-existing entries from other versions), fix the violations and rerun.

## Step 8 — Commit

Stage `docs/history/<file>` AND `public/changelog.json` AND `public/changelog-alpha.json` and commit with message:

- Alpha mode: `docs(release): editorial prose for v<NEXT_VERSION>`
- Stable mode: `docs(release): consolidate alpha series for v<NEXT_VERSION>`

The invoking workflow / skill commits + pushes from there.

## Anti-patterns

- ❌ Putting every bundled PR as a separate bullet in `## Changes` — most don't belong there.
- ❌ (Stable mode) Concatenating the alpha entries verbatim into the stable file. The alpha entries are the substrate, not the output.
- ❌ (Stable mode) Carrying forward bug fixes for alpha-introduced bugs. The stable user never saw the bug.
- ❌ Mentioning the AW pipeline, skills, workflows, or aw-* terms in `## Changes` — none of that is user-visible.
- ❌ Inventing capabilities or fixes the bundled PRs don't actually deliver. Only describe what shipped.
- ❌ Copy-pasting the PR title as a bullet. Rewrite in user-facing voice.
- ❌ Leaving the original auto-dump `- foo (#N)` lines untouched under `## Under the hood`. Convert them all to grouped prose.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

**Specific to `aw-release-notes`:**

- `.claude/feedback/feedback_release_notes_match_shipped.md` — Every release (including patches) needs a docs/history/release-vX.Y.Z.md reconciled to what actually shipped. Drafted-too-early notes ship false statements to users via the in-app changelog dialog. *(modification: |)*
- `.claude/feedback/feedback_user_facing_release_notes.md` — The Features / Improvements / Fixes sections of docs/history/*.md are extracted into user-visible release notes (changelog viewer + update dialog). Strip dev-facing detail from those sections — version numbers, crate names, alert IDs, transitive dep mechanics, etc. Put those in "Under the hood". *(modification: |)*

<!-- END auto-generated -->
