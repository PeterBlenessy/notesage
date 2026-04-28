# Release v0.40.0

**Date:** 2026-04-28
**Previous version:** 0.39.1

Quiet Composer follow-up. Adds a real file-search verb to the command bar (`⌘⇧F` → `:file <name>`), opens a `:`-prefix verb namespace for future commands, removes the never-shipped Quick Capture promise, lands a Folders section for arbitrary `⌘O`-opened folders, and folds in the morning live-test fixes from the post-Phase-1 audit.

## Changes

### Features

- **Find files by name from the command bar.** Press `⌘⇧F` in Quiet Composer to open the command bar with `:file ` pre-filled, then start typing a filename. Results scope to your selected projects and `~/Notesage`. An empty query lists recently opened files so you can scan without typing
- **Type `:` in the command bar to discover commands.** Bare `:` opens a list of every available "verb" command with a short description. Press `Tab` to autocomplete (`:f` → `:fi` → `:file `, jumping to the search box). The existing prefix shortcuts (`#` tags, `@` references, `/` skills, `!` tasks, `?` research, `>` commands) keep working exactly as before — `:` is a separate namespace for verb-style commands like `:file`
- **Folders section in the sidebar.** Folders you open with `⌘O` now appear in their own section between Projects and Recent. Right-click for Reveal in Finder, Copy path, or Remove. The section hides itself when no folders are open
- **Window dims when not focused.** When the Notesage window loses focus, accent colors fade to neutral grey and chrome softens — matching how native macOS apps signal "this window isn't active". Document text, syntax highlighting, and diffs stay unchanged. Reduced-motion users see the swap without the fade

### Improvements

- **Click or Enter on a project row** in the sidebar now expands the project inline (showing its files and folders) instead of opening the README. README is still reachable via right-click → Open, or by expanding the project and clicking the README.md row
- **"+N more…" rows are clickable** — activate to expand the project and show every child file and folder
- **Hover previews on expanded child rows** — hover a child folder for the same one-level peek popover the project root has; hover a previewable file (markdown, text, code) for the rendered preview
- **Settings → System → "Show hidden files"** toggle now actually shows dotfiles in the sidebar (it was a no-op — the toggle did nothing). `.DS_Store` is always hidden regardless of the setting
- **Status tray's "Open actions"** now opens the command bar in `!` task-search mode under Quiet Composer (matching `⌘!`) instead of the legacy Actions dialog. New "Actions" row in the status tray shows the open-action count with the `⌘!` shortcut hint
- **Folder file-count stays visible** when you navigate into a folder row with the keyboard (it was being hidden on focus)
- **`⌘⇧E` opens the Export dialog** in Quiet Composer (the slide-in workspace tree overlay it used to open has been removed — see Removed below)
- **`⌘O` for a folder you've already opened** shows a "Folder is already in the sidebar" toast instead of silently duplicating the row. Catches macOS path edge cases (`/var` vs `/private/var`) so you don't end up with two entries for the same place
- **Pinned and Recent files clean up automatically** when you delete the underlying file — or when you delete a parent folder. No more orphaned entries pointing to deleted files
- **Tray "New Note"** under Quiet Composer now opens the sidebar's inline-create row (matching what `⌘N` does) instead of the legacy New Note dialog
- **Sidebar keyboard navigation polish** — focus rings now use the accent color across every section (Recent, Tags, and Mentions used to render muted grey rings); the "Show more" buttons no longer steal Tab focus between sections
- **Pinned files filter faster** when you have many pinned items. Type-to-filter on hundreds or thousands of pinned files is now noticeably snappier
- **Tooltip text no longer clips at the bottom** — letters with descenders (`p`, `g`, `q`, `y`, `j`) were being cut off everywhere tooltips appear (project-lock tooltip, file path hints, etc.)

### Fixes

- **Project-lock tooltip on the sidebar** now shows the connection's friendly name (e.g., "Claude Code (work)") instead of a raw connection ID
- **Agent task completion toast** now has an X button to dismiss it. The toast used to cover the agent orb's click area, so you couldn't click the orb to read the result without dismissing the toast first
- **Clicking an in-document `#tag` or `@mention`** in Quiet Composer now opens the command bar with the matching prefix and drilldown (it used to open the legacy command palette, which doesn't exist in Quiet Composer)
- **Agents you've delegated comments to** now clean up properly when the task completes or is cancelled — no more orphaned agent processes hanging around after the task is done

### Removed

- **Quick Capture (`⌘⇧Space`)** — never shipped. There was no global-shortcut plugin, no separate quick-capture window. The PaletteMode entry, the in-app routing, and the System Tray phase claim have all been removed end-to-end. If Quick Capture comes back later it'll be a proper standalone PRD with the global-shortcut plugin and floating window. Until then, `⌘N` (or the tray "New Note" command) creates notes the normal way
- **Workspace tree overlay (`⌘⇧E`)** in Quiet Composer — the slide-in panel has been deleted. The inline-expand pattern (click or `→` on a project / folder row in the sidebar) replaces it; for a deeper view, the new `:file` verb finds files by name across every selected project. `⌘⇧E` now opens Export

## Under the hood

- Quiet Composer post-Phase-1 audit (`docs/audits/2026-04-27-quiet-composer-migration.md`) — 18 findings either resolved or moved to backlog with explicit decisions documented
- New cmd-bar prefix grammar locked: single-char prefixes for noun pickers; the `:` namespace for verb commands. Adding a new verb (e.g., future `:find-in-files`, `:goto-line`) is one entry in `src/components/cmd/verb-modes.ts` plus one mode-picker file — no grammar plumbing to revisit. PRD: `docs/prds/2026-04-28-cmd-bar-verb-prefixes.md`
- Sidebar simplification PRD (`docs/tasks/2026-04-27-sidebar-simplification-tasks.md`) — 24 tasks landed, including the TreeOverlay deletion, the new `lib/sidebar-events.ts` bus, the canonical-path explorer-folder dedup, and the row memoisation refactor
- New backend command `index_search_filenames` (case-insensitive substring against `files.name`, capped at 50 hits) backs the `:file` verb. LIKE wildcards (`%`, `_`) are escaped server-side so a literal underscore matches an underscore character
- Two regression-lock smoke tests added: `no-quick-capture.test.ts` (greps `src/` for any reintroduction of the removed Quick Capture identifiers) and `no-tree-overlay.test.ts` (similar pattern from the sidebar TreeOverlay deletion)
- Perf benchmark budgets tightened: `FIRST_KEYSTROKE_BUDGETS` from `{100: 50, 500: 500, 2000: 8000}` to `{100: 50, 500: 100, 2000: 400}` — roughly 2× current measured cost so a future regression that doubles render time fails CI loudly

## Files Changed

20 commits across the four bundles (sidebar simplification, Quick Capture removal, verb-prefix infrastructure, `:file` mode). 4,387 unit tests passing across 237 files, performance benchmarks within the new tighter budgets, typecheck clean.
