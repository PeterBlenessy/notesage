# Release v0.39.0 (draft — Phase 1 UI Refresh)

**Date:** TBD (set at /release time)
**Previous version:** 0.38.1

> **Draft note:** This is the user-facing copy for the Phase 1 release of the Quiet Composer UI refresh. The version number, date, and "Files Changed" totals are placeholders that `/release` will fill in at ship time.

Phase 1 of the UI refresh introduces the Quiet Composer Preview — a new, calmer UI that the classic interface remains the default companion to. Everything ships behind a Settings toggle for this release.

## Changes

### Features

- **Quiet Composer Preview (opt-in).** A new UI shell with a floating command bar, a single agent orb, a flat-list sidebar, a doc-head breadcrumb, and a simplified status tray. Try it from **Settings → Appearance → "UI" → "Quiet Composer"**, or click "Try it" on the one-time invitation banner that appears after upgrading
- **Workspace tree overlay (`⌘⇧E`).** Slide-in panel with the full project + folder tree, focus-trapped and keyboard-navigable
- **Folder peek.** Hover a project row (or press `→` from the keyboard) for a one-level preview popover with shortcuts to open files
- **Pinned files** in the sidebar — drag to reorder, drop from anywhere to pin
- **Type-to-filter** in the sidebar — start typing while the sidebar has focus to filter Pinned, Projects, Recent, and Tags simultaneously
- **Settings dialog rebuilt** as a two-pane shell with `⌘F` search, live preview for Appearance, and a denser AI & Agents panel
- **System tray "Recent" submenu** (existing) now scopes by the chat footer's selected projects with an opt-in "All Recent" view
- **Accent palette** — pick Default (neutral grey), Orange, Blue, or System (reads `NSColor.controlAccentColor` on macOS) from Settings → Appearance

### Improvements

- **Floating command bar** is the new chat surface in Quiet Composer mode. Same providers, agents, branching, segments, scoped approvals — fewer pixels of chrome. Pinnable to the right edge if you prefer the panel layout
- **Agent activity** moves from the rail to a single 46px ambient orb. Pulses while tasks are running; click for the full task list in a Popover-anchored panel
- **Tab bar replaced** by a compact breadcrumb above the document (Notesage / project / folder / file.md), with a dirty dot and a "saved 40s ago" hint
- **Toolbars float** as backdrop-blurred pills above the document and viewers (PDF, EPUB, DOCX, PPTX, code editor) and fade while you type
- **Focus mode** (`⌘.`) shows a small "Focus · ⌘. to exit" pill, restores focus to the previously-focused element on exit, and announces enter / exit to screen readers
- **Status bar** simplified into a tray that opens on click — completions provider, comments, recording state, word count, shortcut help all in one place
- **External-change handling** is now silent auto-reload by default, with a 3-second info toast (`<name> reloaded from disk`). The previous accept/reject UI is still available — toggle **Settings → Editor → "Review external diff"**
- **Cross-project mode** indicator is now a compact "Cross-project scope" pill in the command bar's context row instead of a persistent banner above the chat input

### Accessibility

- **ARIA**: `role="combobox"` + listbox semantics on the command bar, `role="region"` on the pinned panel, `role="tree"` with `aria-level` / `aria-expanded` on the workspace overlay, focus traps inside dialogs and overlays, scoped focus restoration on close
- **Reduced motion**: every Phase 1 animation respects `prefers-reduced-motion: reduce` (Radix overlays included). Animations are disabled, not just shortened
- **Keyboard parity with mouse**: hover-peek mirrored by `→`; the right-click menu is reachable via the macOS Menu key or `⌘⇧,`. F2 renames the focused row inline (announces "Renaming X" via aria-live)
- **PermissionCard** reads as a `role="alert"` with full-intent button labels (`"Allow write_file to /path/to/file.md"`); focus moves to Allow on appearance
- **Automated WCAG contrast audit** (`pnpm audit:contrast`) runs in CI on every push; a new `--color-border-strong` token clears 3:1 for form-control affordances while the existing `--color-border` stays subtle for decorative hairlines (per WCAG 1.4.11 carve-out)

### New keyboard shortcuts

- `⌘⇧E` — open the workspace tree overlay (Quiet Composer); preempts the legacy "Export as PDF" binding while Quiet Composer is mounted
- `⌘⌥C` — copy the focused file's path
- `⌘⌥R` — reveal the focused file in Finder
- `⌘⇧K` — open the keyboard shortcuts dialog (`⌘7` retained as legacy alias)
- `F2` — rename the focused row inline
- `⌘⇧[` / `⌘⇧]` — cycle through recently used documents (MRU order)
- Double-tap `⌘` — alternate way to focus the command bar (macOS only, where the OS reliably reports it)

### Removed

- **Preview HTML** (formerly `⌘⇧P`) — the dedicated read-only HTML preview pane is gone. The integrated viewers cover the same need; if you want a standalone HTML render of a document, the export menu still produces self-contained HTML files (right-click a `.md` file → Export as… → HTML). The `⌘⇧P` chord now opens the command palette in `>` (Commands) mode in both shells
- **External diff review banner** — replaced by the simpler watcher flow described above. Default is auto-reload + toast; opt back in via Settings → Editor

## Under the hood

- **Phase 1 of the UI refresh PRD** (`docs/prds/2026-04-21-ui-refresh.md`) — 100 numbered tasks across 10 milestones (M1.1 Foundation through M1.10 Pre-ship). All are gated behind `settings.uiPreview === "quiet-composer"`; the classic Layout remains mounted by default
- **New CSS variables**: `--color-accent`, `--color-accent-primary`, `--color-border-strong`, `--cmd-bar-pinned-width`
- **New stores**: `tree-overlay-store`, `quiet-sidebar-store`. New `settings-store` flags: `uiPreview`, `cmdBarPinned`, `cmdBarPinnedWidth`, `sidebarTagsHidden`, `sidebarRecentCap`, `quietChromePreset`, `quietChromeOverrides`, `accent`, `tintHue`, `tintChroma`, `previewInvitationShownAt`, `previewInvitationDismissedAt`
- **Renamed**: `editor-store.openTabs` → `openDocuments` (one-time persisted-state migration; existing localStorage tab lists carry over)
- **New perf categories**: `[perf:cmdbar]`, `[perf:orb]`, `[perf:status]`, `[perf:peek]`, `[perf:tree-overlay]`, `[perf:sidebar]`, `[perf:focus]` — see `docs/architecture.md`
- **New helpers**: `useFadeOnType`, `useFocusMode`, `useReducedMotion`, `useRovingTabindex`, `useSidebarItemShortcuts`, `useDoubleTapCmd`, `useRecentDocumentCycle`; `cmd-bar-events` bus; `quiet-chrome` preset application; `contrast-math` (oklch → relative luminance → WCAG ratio)
- Every Phase 1 task lands with regression-lock tests; `reduced-motion-sweep.test.ts` asserts no entrance animation under `prefers-reduced-motion: reduce` for every animated surface

## Known limitations

- The preview is opt-in for this release. Most users will continue to see the classic UI; the Settings toggle is the only entry point
- New project templates (Default, Research, Writing, Blank) are temporarily unavailable in Quiet Composer's inline create flow — `⌘⇧N` and the Projects `+` button create a blank project. The template picker will return as a `/scaffold-project` skill in a later release; until then, use the classic UI if you need a templated project
- Sidebar row rendering hasn't been memoized yet, so type-to-filter on lists with thousands of pinned or recent items will feel sluggish on the first keystroke. Real-world workloads (typically <50 items per section) are nowhere near this ceiling — tracked as follow-up F6 in `docs/tasks/2026-04-21-ui-refresh-phase1-followups.md`
- Some chrome that exists in the classic UI (e.g. the resizable activity panel) is intentionally absent from Quiet Composer. Use the orb's panel for the same task list
- Double-tap `⌘` to focus the command bar relies on native key timing and is macOS-only; `⌘K` is always the primary path

## Files Changed

TBD — `/release` will fill in commit count, file count, and test totals at ship time. As of the M1.9 wrap-up: 4,103 unit tests passing across 218 files, 43 perf benchmarks within budget, contrast audit 22/22 pass, typecheck clean.

For prior releases (v0.38.1 and earlier), see the rest of `docs/history/`.
