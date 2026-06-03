---
name: audit-documentation
description: Audit for documentation drift — stale file paths, wrong signatures, outdated descriptions
user-invocable: true
---

# Audit: Documentation Drift

Check that documentation matches the current codebase. This is a research-only audit — do not modify any code.

## What to Search For

### File Paths in Documentation

Read each doc file in `docs/` and extract all file path references (e.g., `src/components/editor/Editor.tsx`, `src-tauri/src/commands/ai.rs`). For each path:
- Does the file still exist?
- Has it been renamed or moved?

Check these docs specifically:
- `docs/architecture.md` — project structure tree
- `docs/features/*.md` — key files tables
- `docs/tauri-commands.md` — command file locations
- `CLAUDE.md` — referenced doc paths

### API Signatures (verify existence first, then signature)

Build the command surface from code, then diff against the docs — do not trust the docs
as the index.
- Enumerate command MODULES: `ls src-tauri/src/commands/*.rs`. Cross-check each against
  the `commands/` inventory in architecture.md AND against tauri-commands.md. A module
  present in code but absent from both docs is a MEDIUM drift (the IPC reference is
  incomplete) (e.g. a newly-added `alpha_update.rs` or `preview.rs` documented in
  neither tauri-commands.md nor the architecture.md module inventory).
- Enumerate commands: `rg -n "#\[tauri::command\]" src-tauri/src/commands` and list the
  fn names. For each command that tauri-commands.md DOES document, confirm:
  - the fn still exists (documented command not removed),
  - parameter names and types match the doc signature,
  - the return type matches.
- For each documented command, verify the Rust fn it claims to describe is actually
  present — a documented command with no matching `#[tauri::command]` fn is stale.

### Feature Descriptions

Read feature docs (`docs/features/*.md`) and check for:
- Features described as "planned" or "future" that have been implemented
- Features described as working that have been removed or disabled
- UI elements described that no longer exist (renamed components, removed buttons)
- Keyboard shortcuts in docs that don't match actual bindings

### Keyboard Shortcuts

Compare `docs/keyboard-shortcuts.md` with actual keybinding code:
- Find all `Mod-` / `Cmd+` bindings in source code
- Check each documented shortcut exists in code
- Check for undocumented shortcuts in code

### Architecture Accuracy

Compare `docs/architecture.md` project structure with the actual filesystem:
- Are all listed directories and files present?
- Are there significant directories/files not listed?
- Is the store table accurate (store names, purposes, persistence)?
- Is the extension inventory current?

### Detect Doc-vs-Code Drift Mechanically (repeatable method)

Do not eyeball the docs — run these existence/identity checks so the audit is
repeatable and every claim is traceable to a path or a grep:

1. **Every documented file path must exist.** Extract paths from each doc and stat them:
   `rg -o "[\w./-]+\.(ts|tsx|rs|json|md)" docs/ CLAUDE.md | sort -u` → for each, `test -e`.
   Report dead paths AND newly-significant files the docs omit.
   - A doc that lists a deleted component/store/perf-category is HIGH if it would lead an
     engineer to wire something a guard test now forbids (e.g. docs still documenting a
     `TreeOverlay.tsx` / `tree-overlay-store` / `[perf:tree-overlay]` after a refactor
     deleted them and added a guard test blocking re-introduction).
   - A store listed in the architecture store table must have a real `src/stores/*.ts`
     file. A documented store with no file points the "map of state ownership" at a void
     (e.g. a `sync-store` row whose settings actually live in `commands/sync.rs` + a
     settings JSON, with no `src/stores/sync-store.ts`).
   - Newly-added stores/components that ARE rendered but undocumented are also drift
     (e.g. a rendered `FoldersSection.tsx` + `folder-appearance-store.ts` absent from the
     docs).

2. **Counts and inventories must be re-measured, never copied.** Any doc line with a
   hardcoded test/file count or an "as of <date>" inventory must be re-derived from the
   tree. If a count is off by more than ~20%, report it and prefer replacing the hardcoded
   number with a pointer to the generating command (e.g. a "99 unit files … ~2160 cases"
   inventory measuring ~3x low against the actual tree).

3. **Rendered structure must match documented structure.** For ordered/enumerated UI
   lists (sidebar sections, toolbar buttons, tabs), read the component that renders them
   and compare item-by-item, including count words ("five sections") (e.g. docs claiming a
   five-section "Pinned → Projects → Recent → Tags → Mentions" sidebar while the component
   renders six by adding a Folders section — and the component's own docstring is stale too).

### Cross-Document Consistency (same fact, two docs)

A single fact (a keyboard chord, a component's existence, a version) is often stated in
multiple docs; when only some are updated, the doc set self-contradicts. After resolving
each drift against CODE, grep the asserted value across ALL docs and confirm they agree.
- Keyboard chords are the highest-frequency offender: confirm a chord maps to ONE action
  across keyboard-shortcuts.md and every feature/design doc, and that code routes it
  there (e.g. ⌘⇧E documented as "Export" in one doc but "Tree Overlay" in three others
  after only one doc was updated — verify the keyboard hook actually routes it).
- When a removal/rename lands, search the whole docs tree for the OLD term — partial
  updates (one doc fixed, four stale) are the common failure mode.

### Version References

- Read the canonical version once: `node -p "require('./package.json').version"`.
- Grep EVERY hardcoded version string in docs (`rg -n "[Vv]ersion:?\s*\d+\.\d+" CLAUDE.md docs/`)
  — the same stale string is usually duplicated across CLAUDE.md and product-description.md;
  report each occurrence with its file:line, not just "docs are stale".
- If `package.json` carries a pre-release suffix (`-alpha`, `-beta`, `-rc`), check the
  docs acknowledge the pre-release channel AND that any channel-specific command module
  exists in the docs (e.g. an alpha update command). A docs set that names no channel
  while the build ships one is a HIGH drift.
- Check technology versions (React, Tiptap, Tailwind) against the installed versions in
  `package.json` dependencies, not against prose memory.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**Doc:** `<doc-path>:<line>`
**Reality:** <what's actually true in the codebase>

<Description of the drift.>

**Fix:** <What to update in the doc.>
```

Group findings by document for easier correction.

When multiple findings share a single root cause (an incomplete refactor applied to some
docs but not others, or a version bump not propagated), call out the root cause once at
the top and list the affected docs under it. Order findings so the docs most likely to
mislead an engineer TODAY come first — version drift and live-vs-deleted component/section
mismatches outrank inventory-count staleness and store-table omissions, because a
contributor following a stale component reference hits a guard test or wires a nonexistent
store, whereas a stale count only misleads estimation.

Always verify the drift direction against CODE: state "doc says X, code at <file:line>
does Y" with both citations. A finding without a code-side file:line anchor is not
actionable.

## Example Finding

### LOW: architecture.md lists removed store

**Doc:** `docs/architecture.md:85`
**Reality:** `tag-store` was removed in the SQLite document index migration

The architecture doc's store table still lists `tag-store` with a strikethrough, but the actual store file has been deleted. The strikethrough note is correct but could be cleaned up.

**Fix:** Remove the `tag-store` row entirely since the migration is complete.

### MEDIUM: tauri-commands.md missing 3 new commands

**Doc:** `docs/tauri-commands.md`
**Reality:** `store_credential`, `get_credential`, `delete_credential` exist in code but aren't documented

The credential commands were added in v0.23.0 but the Tauri commands doc wasn't updated.

**Fix:** Add documentation for the credential commands with their signatures, parameters, and usage examples.
