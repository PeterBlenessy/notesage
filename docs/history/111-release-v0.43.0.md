# Release v0.43.0

**Date:** 2026-05-10
**Previous version:** 0.42.0

A focused pass on the sidebar — folders are easier to talk about, easier to customize, and easier to find. Plus a new alpha release channel for early testers and a faster cold-start for files you recently edited.

## Changes

### Features

- **Customize a folder's icon and colour.** Right-click a folder in the sidebar → Customize… to pick from a curated icon set (including a new AI / agentic group — Brain, Bot, Sparkles, Atom) and an 8-colour palette. Works for any folder, whether it's a Notesage folder or one you opened with ⌘O.

- **Manage with Notesage.** A folder you opened with ⌘O can now be promoted to a Notesage folder via right-click → Manage with Notesage. That unlocks AI provider lock, durable comments that survive renames, custom appearance persistence, and per-folder skills, agents, and MCP servers. If the folder already has a `.notesage/` settings directory, the entry reads "Open as Notesage folder" instead.

- **Alpha release channel.** Settings → Updates → Release Channel lets you switch to "Alpha" to receive pre-release builds with new features earlier than stable. Switch back to "Stable" any time. Alpha builds carry a `-alpha.N` version suffix.

- **Faster cold-start for previously-edited files.** Notesage now keeps a local snapshot of recently-edited file viewports. Reopening a file you edited in a previous session paints content almost instantly instead of going through the full parse pipeline.

### Improvements

- **One unified "Folders" sidebar section.** The previous separate "Projects" and "Folders" sections are merged into a single "Folders" list. Notesage folders and folders you opened with ⌘O share the section and are distinguished by their icon, not by sitting in different groups.

- **Folder-only vocabulary.** The user-facing word "Project" is gone — everything is now just "folder". Locked folders (with an AI provider lock) and folders you opened from elsewhere on disk are signalled by their icons and accessibility labels rather than by separate noun categories.

- **Crash-safe folder renames.** If Notesage crashes or is force-quit while it's migrating comments after a folder rename, the next launch detects the in-progress migration and completes it cleanly. No more lost comments from interrupted folder renames.

- **Folders you opened with ⌘O can be removed from the sidebar.** Right-click → Remove from sidebar. Files stay on disk; the folder just disappears from the workspace until you reopen it.

- **Notesage folders can also be removed from the sidebar** with the same right-click menu entry — useful for trimming back to just the folders you're actively working in.

### Fixes

- **The customize popover doesn't get covered by the file preview anymore.** Hovering inside the popover used to make the folder hover preview pop up over it. Fixed.

- **Typing while customize is open no longer ends up in the sidebar filter.** Keystrokes meant for the popover used to leak into the sidebar's type-to-filter. Fixed.

- **Right-clicking a folder you opened with ⌘O now reliably opens the Notesage menu.** Previously the OS handled the right-click on those rows and the row got "selected" without offering the Customize / Manage / Reveal entries.

- **System folders (`.notesage`, `.git`, etc.) only show safe entries** in their right-click menu. Rename, Delete, Customize, and other mutating actions are hidden for these folders so you can't accidentally damage app or repo state.

## Under the hood

PRs since v0.42.0: #129, #130, #136, #145, #146 (issue #142), #148 (issue #141), #149 (issue #143), #150 (issue #144), #151 (issue #139), #152, #153 (issue #132), #154 (issue #140), plus a tip-of-main repair commit (`603b5be5`) that fixed the customize popover and folder-section merge end-to-end after #154 shipped only the storage layer.

### Customize popover repair (`603b5be5`)

The customize feature shipped in #154 had several event-isolation bugs that made it unusable in practice:

- Picker storage wasn't wired to row rendering — `useProjectMetadataStore.appearance` and `useFolderAppearanceStore` were written by the picker but never read by `ProjectRow` / `FolderRow`. Custom icon + colour choices silently disappeared. Fixed by threading appearance through `resolveFolderIcon` and applying `style={{ color }}`.
- Popover anchoring used a `sr-only` `<span>` `<PopoverTrigger>`. The 1×1 anchor box ended up in unpredictable positions; users couldn't reliably reach the popover. Replaced with `<PopoverAnchor>` wrapping the row.
- Radix's controlled Popover doesn't fire `onOpenChange(true)` on external prop changes (only on user-initiated dismissals). The previous wiring on `SidebarContextMenu`'s customize hooked `onOpenChange` and silently missed the open transition. Replaced with a `useEffect` keyed on `customizeOpen`, matching `FoldersSection`'s working pattern.
- Hover preview popover (`FolderPeek`) opened over the customize popover because (a) Quiet's `FoldersSection` inline `ContextMenu` didn't bump the existing context-menu pause counter and (b) even with the counter, the existing pause logic doesn't close already-open peeks. Added a dedicated `isAnyCustomizePopoverOpen()` flag plus a `forceCloseAllPeeks()` signal in `sidebar-context-menu-state`. `FolderPeek.handleMouseEnter` / `handleMouseLeave` / openTimer all bail unconditionally on the new flag. The `QuietSidebar` `<nav>` `onKeyDown` (type-to-filter) bails on the same flag — fixes keystrokes leaking from the customize popover into the sidebar filter.
- `<ContextMenuTrigger asChild>` was wrapping `<FolderRow>` directly. Radix's `Slot` uses `cloneElement` to inject `onContextMenu` and a `ref`, but `FolderRow` is a function component that destructures only its declared props — the injected props were silently dropped, the OS native menu fired, and the row got "selected" by the OS. Same workaround `ProjectsSection` already learned: wrap in a passthrough `<div>`.

### AW pipeline

- **Propose-don't-punt** policy shift across `aw-refine` / `aw-slice` / `aw-tdd` / `aw-feedback` skills (#152). Default switched from "bounce open questions to human" to "propose a defensible answer, document it, proceed." `hitl` narrowed to four exhaustive criteria (destructive migration, security relaxation, breaking external API, explicit human request). Added `awaiting-prototypes` label and prototype-peers mode for genuine N-way uncertainty. Open questions get inline `## Proposed answers` in slice rationale; humans override by commenting. Full rationale in `docs/agentic-workflow.md` § "Choice: propose-don't-punt default".

### Other

- Keyboard manifest: JSDoc shortcut table promoted to a typed JSON manifest at `src/shared/appCommandManifest.json` with a generated catalog (`src/lib/appCommandCatalog.ts`) and a CI drift test against `docs/keyboard-shortcuts.md`. Unblocks E2E shortcut testing through the same code path as real keystrokes.
- Playwright fixtures refactored into a two-layer architecture (browser-only + Tauri-mocked).
- IndexedDB viewport cache shipped in #153 — see PRD `docs/prds/2026-05-03-large-file-instant-load.md` for the architecture.
- Crash-safe rename — three-phase commit transaction directory at `<notesRoot>/.notesage/rename-txn/<txn-id>/` with automatic recovery scan on startup, gated on `startupReady`. Watcher gains an explicit exclude for the staging dir.

## Files Changed

13 PRs since v0.42.0 plus the tip-of-main repair commit. ~7,000 lines added, ~1,800 deleted across ~80 files.

## Quality Gates

- `pnpm typecheck` — clean
- `pnpm test --run` — 4774 / 4774 passing (deleted the two pre-existing `it.skip` placeholders that covered behaviour that no longer exists)
- `pnpm test:perf` (CI's 1.5× multiplier) — 46 / 46 passing
- `cargo test` — 685 / 685 passing
