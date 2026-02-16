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

6. **Create a release history entry** at `docs/history/NNN-release-vX.Y.Z.md`:

   ```markdown
   # Release vX.Y.Z

   **Date:** YYYY-MM-DD
   **Previous version:** X.Y.Z

   ## Changes

   ### Features
   - ...

   ### Fixes
   - ...

   ### Improvements
   - ...

   ## Files Changed
   - N files changed across M commits
   ```

7. **Update `docs/history/README.md`** with the new entry.

8. **Present the release for review:**
   - Show the version change
   - Show the changelog summary
   - Show the files that were modified
   - Ask the user to confirm before committing

## Important Notes

- This skill prepares the release but does **not** commit or tag. The user decides when to commit.
- The Tauri config (`src-tauri/tauri.conf.json`) reads version from `package.json` via `"version": "../package.json"`, so it picks up the bump automatically.
