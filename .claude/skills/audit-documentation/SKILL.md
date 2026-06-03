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

### API Signatures

Compare documented Tauri command signatures in `docs/tauri-commands.md` with actual Rust code:
- Are parameter names and types correct?
- Are return types correct?
- Are there commands in the code that aren't documented?
- Are there documented commands that no longer exist?

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

### Version References

- Check that version numbers in docs match `package.json`
- Check that technology versions (React, Tiptap, Tailwind) are accurate

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

End with a `### Confirmed Good Patterns` section.

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
