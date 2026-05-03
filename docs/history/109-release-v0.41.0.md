# Release v0.41.0

**Date:** 2026-05-03
**Previous version:** 0.40.1

External file watching gets a real upgrade — rename a file in Finder, terminal, or another editor, and Notesage follows along. The open tab updates, the sidebar refreshes, and any comments you've added to the file stay attached. Plus a stack of fixes for renaming, comments, and the Copilot integration, and a UI consistency pass across the command-bar pickers.

## Changes

### Features

- **Renaming files outside Notesage now Just Works.** When you rename a file in Finder, with `mv` in a terminal, or in any other editor, the open tab updates to the new path and the sidebar refreshes automatically. Pinned and recent files follow too. If the file had unsaved edits, you get a "Save now" prompt instead of silent loss
- **Renaming a folder updates every open document inside it.** Comments attached to files inside the renamed folder migrate to the new path so you don't lose the thread. Works whether the file is currently open or just sitting in a closed tab
- **iCloud sync moves to the project right-click menu.** Open a project's settings (cog icon in the sidebar) → Sync to enable or disable iCloud for that project specifically. The old global "Sync" panel in Settings is gone — there's nothing more to configure separately

### Improvements

- **Command bar pickers share a consistent visual treatment.** All seven prefix-mode pickers (`/` skills, `@` references, `#` tags, `!` tasks, `?` research, `>` commands, `:` verbs) now use the same active-row styling — a muted background with an accent border instead of solid accent fill. Tooltips and hover states match across the whole grammar
- **Renaming a project root in the sidebar now renames the actual project folder** instead of an internal path representation. Catches edge cases on iCloud paths where the canonical path differs from what the sidebar displays
- **Double-click any folder in the sidebar to rename it** — including child folders inside an expanded project. Previously only top-level folders supported double-click; child rows required the right-click menu
- **System folders are protected from accidental rename.** If you try to rename a folder that's a known system location (your home directory, project root from another workspace), Notesage refuses with a clear toast instead of silently breaking your filesystem

### Fixes

- **GitHub Copilot inline completions are more stable.** Fixed a bug where the Copilot Language Server was being shut down and restarted shortly after launch, surfacing as a "process exited unexpectedly" error in the dev console. Inline completions now stay connected from app start through the entire session
- **No more spurious "renamed externally" notifications** when you rename a file from inside Notesage. The watcher used to surface the in-app rename as if it came from outside; now it correctly suppresses self-initiated renames
- **Closed-tab comment sidecars migrate when you rename their folder** — previously, comments on a non-project file would be left behind at the old path and effectively lost when the folder was renamed. They now travel with the file
- **iCloud sync setting reads correctly after toggling.** A subtle race condition meant the toggle could appear stuck or out of date until you reopened settings
- **Removed a console warning from the editor on every load** — `ProseMirror expects the CSS white-space property to be set` — that was noise but indicated the base editor styling was missing a needed property. Fixed for real

## Under the hood

Most of the engineering effort this cycle went into the agentic-workflow (AW) pipeline that drives a meaningful chunk of Notesage's development today. None of it ships to end users, but for contributors / maintainers:

- **WORKFLOW_PAT for bot-PR CI gating** (#118, #120) — bot-authored PRs created with `GITHUB_TOKEN` were not firing `pull_request` events, so `test.yml` never ran on them. Routed PR creation through a fine-grained PAT instead. CI now runs on every bot PR.
- **Author-association gate for external issues** (#123) — public-repo issues from non-trusted authors are now labelled `external` and skipped by the AW pipeline + sweep until the owner adds `aw-approved`. Closes the structural risk where a crafted external issue could ride the pipeline into a malicious draft PR.
- **Defensive post-checks + max-turns bump** (#101, #122) — `claude-code-action` could exit `success` while the agent failed to post the expected output, producing silent successes with no red tile in the audit trail. Added bash post-check steps after each agent call that fail loudly on missing labels; bumped `--max-turns` from 30 → 50 for triage and refine to prevent budget-exhaustion loops.
- **Shared `aw-stage-{stage}-{issue}` concurrency group across all entry points** (#88, #97, #98, #105) — pipeline-run and sweep-run for the same issue+stage now share a queue, fixing two real incidents (PRs #92/#93 from issue #88 producing duplicate PRs; duplicate slice comments on issue #97 from parallel runs). Includes a regression-lock test that parses every `aw-*.yml` file and asserts the convention.
- **Sweep workflow consolidation** (#103, #121) — eight parallel jobs (`find_<stage>` precheck + `<stage>` skill pair per stage) replace four separately-cron-triggered standalones. Idle ticks finish in ~20s with no checkouts; one Actions tile per label edit instead of four.
- **`aw-review` skill** (#85, #86, #94, #106) — independent reviewer of a bot-authored draft PR on a fresh runner. Reads the issue body PLUS every comment posted after the latest `refined` marker, checks each acceptance criterion against the diff, posts a per-criterion checklist. Bounded to 2 reset cycles before escalating via `needs-human`.
- **Skill retrospect pass** — every merged AW PR now triggers `aw-retrospect` which proposes SKILL.md patches when the actual run diverged from the skill's contract.
- **Eight historical audit reports archived** to `docs/audits/` (covering 2026-03-25 → 2026-04-12) — they had been sitting untracked across sessions; now part of the historical record.

For the comprehensive picture of the AW pipeline as it stands today, see `docs/agentic-workflow.md`.

## Files Changed

25 PRs (~5,500 lines added, ~700 lines deleted across ~50 files). Bug-fix PRs touched the watcher, comment-storage, and Copilot LSP modules; the AW infrastructure work was scoped to `.github/workflows/`, `.claude/skills/`, and `docs/`. All test suites passing (frontend, Playwright E2E, Rust). Typecheck clean.
