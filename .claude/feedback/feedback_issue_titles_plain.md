---
name: Issue titles stay plain — Conventional Commits is for commits and PRs only
description: The repo follows Conventional Commits (`feat(area):`, `fix(area):`, etc.) for commit messages and PR titles, but ISSUE titles should remain plain descriptive — no verb-prefix, no scope. The verb prefix can be presumptuous at the issue stage (you don't yet know if it's a fix vs feat) and the type often drifts through triage/refine anyway.
type: feedback
originSessionId: 74f153e5-da3e-44b1-8a5b-8f88983357c3
aw_applies: yes
aw_applies_to: [aw-triage, aw-refine]
---
The Notesage repo's commit and PR titles follow Conventional Commits — every commit on `main` for months uses `<type>(<scope>): <description>` with `feat|fix|docs|chore|ci|refactor|test|perf|style`. This is observed, not codified in `CLAUDE.md` or any skill, but it's fully consistent.

**Do NOT extend this convention to issue titles.** Issue titles stay plain descriptive ("UI: Standardize command bar picker selection (discrete checkmark, stronger visibility)") — colon-domain-prefix optional, but no Conventional Commits verb-prefix.

**Why:**
- Issue titles serve a different reader than commit messages — planners scanning a queue, not git-log readers.
- The type (`fix` / `feat` / `chore`) is often unclear at filing time and drifts through triage/refine anyway.
- The repo's existing issue titles are mixed (some prefixed, some not), so there's no consistent precedent to mirror; plain descriptive is the safer default.

**How to apply:**
- When filing a new GitHub issue, write a plain descriptive title. Don't prefix with `fix(...)`, `feat(...)`, etc.
- When writing a commit message or PR title, DO use Conventional Commits — that part of the convention is real.
- Don't bring this up unprompted; only apply silently.

**Origin:** I filed issue #89 (May 2026) with the title `fix(quiet-sidebar): project-root rename + system-folder safety + rename-input width` because I extended the commit-message convention I'd been seeing in `git log`. The user pushed back: the verb prefix doesn't belong on issue titles. They explicitly chose "extend or NOT extend it to issue titles → NOT". The user also chose to leave existing things (the documentation status quo, the #89 title) as-is rather than codify or rename, so this rule lives in memory rather than in any skill or doc.
