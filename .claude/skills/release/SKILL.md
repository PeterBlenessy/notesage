---
name: release
description: Prepare a release with version bump, changelog, and history entry
user-invocable: true
argument-hint: "<patch|minor|major>"
---

# Release Preparation

Bump the version, generate a changelog, and create a release history entry.

## Process

1. **Read the current version** from `package.json`.

2. **Calculate the new version** based on the argument:
   - `patch`: 0.4.0 -> 0.4.1 (bug fixes)
   - `minor`: 0.4.0 -> 0.5.0 (new features, backward compatible)
   - `major`: 0.4.0 -> 1.0.0 (breaking changes)
   - If no argument given, ask the user which bump type.

3. **Generate changelog** from git history:
   - Find the last version tag: `git describe --tags --abbrev=0`
   - If no tags exist, use all commits
   - Get commits since last tag: `git log <last-tag>..HEAD --oneline`
   - Group commits by type (features, fixes, refactors, docs, etc.)

4. **Update `package.json`** with the new version.
   - **Do NOT** touch `src-tauri/Cargo.toml` — it maintains an independent crate version per `CLAUDE.md`.

5. **Determine the next history number:**
   - Read `docs/history/` to find the highest numbered file
   - Increment by 1 (e.g., if `008-*` is the latest, create `009-*`)

6. **Create a release history entry** at `docs/history/NNN-release-vX.Y.Z.md`.

   **CRITICAL — tone for the three user-facing sections.** The `Features`, `Fixes`, and `Improvements` sections are extracted by `scripts/generate-changelog.ts` into `public/changelog.json`, which is shipped to end users as the in-app "What's new". Write those bullets for a non-technical user scrolling through versions. Any other `###` heading (like `Under the hood`) is **not** extracted — put task numbers, file paths, commit hashes, and implementation jargon there.

   **Before writing,** open the two most recent prior `docs/history/*.md` files and match their tone. Describe what the user will notice or can now do, not what file changed or which subsystem moved.

   ### Stable promotion — consolidate the alpha series via `aw-release-notes`

   When the release being prepared is a **stable** version (no `-alpha.N` suffix) AND there are alpha history files between the previous stable tag and now, do NOT write the body from scratch. Instead:

   1. Find the previous stable tag: `git tag --list 'v*' | grep -v alpha | sort -V | tail -1`.
   2. List every `docs/history/*.md` file with a version strictly between previous stable and the new version. These are the alpha entries to consolidate.
   3. List the PRs merged since the previous stable tag (`gh pr list --search "merged:>$(git log -1 --format=%cI <prev-stable>) base:main" --json number,title --jq '.[].number' | paste -sd,`).
   4. Invoke the **`aw-release-notes` skill** at `.claude/skills/aw-release-notes/SKILL.md` in `MODE=stable` with:
      - `HISTORY_FILE` = the new file you just created (with the template body intact)
      - `NEXT_VERSION` = the new stable version
      - `PR_NUMBERS` = the comma-separated list from step 3
      - `PREVIOUS_TAG` = the previous stable tag
      - `PRIOR_ALPHA_FILES` = newline-separated list from step 2
   5. The skill consolidates the alpha series into ONE coherent stable changelog — drops alpha-introduced-then-alpha-fixed bugs, collapses iterative refinements into single bullets, polishes for the wider stable audience. Read its output and edit if needed.
   6. Run `pnpm generate-changelog` to regenerate `public/changelog.json` and `public/changelog-alpha.json`. The blocking linter will fail if the consolidated body still contains the placeholder string — fix and rerun.

   **Avoid in Features / Fixes / Improvements bullets:**
   - Task numbers (`#12`, `#23`, etc.) — internal
   - File paths (`useAIContext.ts`, `ChatFooter.tsx`) — internal
   - Commit hashes, store names, type names, migration versions — internal
   - Architecture jargon (`ScopedApproval triples`, `LCA walk`, `$HOME deny-by-default`, `Bucket C`) — opaque to users

   **Prefer:**
   - Verb-first user-visible behavior (`Lock a project to a specific AI provider…`, `Resend an older message…`)
   - Where something lives, named by its menu path (`Settings → Privacy → Approvals`, `Settings → Advanced`)
   - Concrete consequences (`No more stale prompts from an agent that's been restarted`, `Filenames from unselected projects no longer appear in the model's context`)

   Template:

   ```markdown
   # Release vX.Y.Z

   **Date:** YYYY-MM-DD
   **Previous version:** X.Y.Z

   Short 1-2 sentence summary of the release theme for the user.

   ## Changes

   ### Features
   - User-visible new capability, named in terms the user recognises
   - Where to find it (Settings → X → Y) if non-obvious

   ### Improvements
   - What got better that the user will notice
   - Any opt-out / opt-in the user might care about

   ### Fixes
   - The symptom the user was seeing, not the mechanism that caused it
   - Brief enough to scan at a glance

   ## Under the hood

   Optional. Internal notes, task numbers, commit refs, links to PRD/audit. Not shipped to users.

   ## Files Changed

   - N files changed across M commits (+/- line counts if notable)
   ```

   **Spot-check before confirming:** read each bullet in Features / Fixes / Improvements and ask "would a non-technical user understand this?" If no, rewrite. If the bullet requires a task number or file path to make sense, move it to `Under the hood`.

7. **Update `docs/history/README.md`** with the new entry. The one-line summary there should also read as user-visible — the same tone rules apply.

   After updating, regenerate `public/changelog.json` with `pnpm generate-changelog` and sanity-check a few bullets in the JSON to confirm the tone reads right.

8. **Run performance baseline:**
   - Run `pnpm test:perf` — all synthetic benchmarks must pass within budget.
   - **Real-world startup measurement** requires the user's help: ask them to start the app in dev mode (`pnpm tauri dev`), refresh the page, and paste the `[perf:*]` console logs. You cannot capture these yourself — the app runs in a Tauri WebView, not a headless browser.
   - Once the user provides the logs, extract the key metrics and append a dated entry to `docs/performance-baseline.md` under "Startup Performance" with the new version and commit hash. Include: `phase1-ready`, `startup ready`, `tree refresh`, `skills total`, and any metric that changed significantly.
   - Never overwrite previous entries — the history is the point.
   - If any metric regressed >20% from the previous entry, flag it to the user before proceeding.

9. **Present the release for review:**
   - Show the version change
   - Show the changelog summary
   - Show the files that were modified
   - Ask the user to confirm before committing

## Post-Tag: Monitor GitHub Workflow

After the user commits, tags, and pushes a release tag, **always** monitor the GitHub Actions workflow:

1. Wait a few seconds for the workflow to start, then run:
   ```bash
   gh run list --workflow=release.yml --limit 1
   ```
2. Get the run ID and launch a **background agent** to poll the workflow status:
   ```bash
   gh run watch <run-id> --exit-status
   ```
3. If the workflow **fails**, immediately check the failed logs:
   ```bash
   gh run view <run-id> --log-failed
   ```
   Report the failure to the user with the error details.
4. If the workflow **succeeds**, confirm to the user that the release was built and published.

This monitoring should run in the background so it does not block other work.


## User-facing copy vs Under the hood

The `### Features`, `### Improvements`, and `### Fixes` sections in every release history file are extracted by `scripts/generate-changelog.ts` and shipped to end users as the in-app "What's new" feed. A non-technical user scrolling through versions must be able to understand every bullet in those three sections without knowing what a crate, Dependabot alert, classDef, or IPC is.

### Forbidden in user-facing bullets (Features / Improvements / Fixes)

Any bullet that contains the following is wrong and must be moved to `## Under the hood`:

- **Version number triples** — `11.14.0 → 11.15.0`, `rand 0.8.5`, `mermaid@11.15.0`. Users do not care which version number a dependency is at; they care whether something broke.
- **Crate / package / library names** — `rand`, `mermaid`, `tiptap`, `comrak`, `docx-rs`. Internal software names are opaque noise.
- **Alert identifiers** — `Dependabot alert #57`, `classDef HTML injection`, `GHSA-xxxx`. These mean nothing to a user.
- **Distribution mechanics** — `transitive`, `Cargo.lock`, `lockfile`, `cargo update`. Nobody outside the team knows what transitive means in this context.
- **Internal terms** — `Rust crate`, `IPC Origin Confusion`, `custom loggers`, `ScopedApproval triples`, `LCA walk`, `Bucket C`. Architecture jargon.
- **File paths and commit hashes** — `useAIContext.ts`, `ChatFooter.tsx`, `a1b2c3d`. Internal pointers.

### Required bullet shape

Lead with what the user can **do differently** or what got **safer / faster / clearer**. Optionally add where to find it (Settings path, menu name). Put everything else in `## Under the hood`.

> **Format:** `<User-observable outcome> [— <optional location>]`

### Before / After examples

**Security-fix bullet**

- ❌ Before: `Fixed classDef HTML injection in mermaid 11.14.0 → 11.15.0 (Dependabot alert #57, transitive via tiptap)`
- ✅ After: `Fixed a potential content-injection vulnerability in diagram rendering — no action required`

**Dependency-bump bullet**

- ❌ Before: `Updated rand crate 0.8.5 → 0.9.0 (transitive Cargo.lock update)`
- ✅ After: `Improved startup reliability on Apple Silicon (internal dependency update)` — or omit entirely if it has no user-observable effect

### Spot-check rule

Read each Features / Improvements / Fixes bullet aloud and ask: _"Would a non-technical user understand this?"_ If the answer requires knowing what a crate, Dependabot, transitive, or classDef is — move the bullet to `## Under the hood`.

The `scripts/generate-changelog.ts` linter will print a console warning for bullets that match known forbidden patterns (version triples, `Dependabot`, `transitive`). The linter is warn-only (exit code 0) — it guides the writer but does not block releases.

## Important Notes

- This skill prepares the release but does **not** commit or tag. The user decides when to commit.
- The Tauri config (`src-tauri/tauri.conf.json`) reads version from `package.json` via `"version": "../package.json"`, so it picks up the bump automatically.
