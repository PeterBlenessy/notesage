# Changelog

All notable user-facing changes to Notesage. Per-version release notes for prior versions live in `docs/history/release-v*.md` and are surfaced in-app via `public/changelog.json`.

## [Unreleased] — Phase 1 UI Refresh

### Quiet Composer Preview (opt-in)

A new, calmer UI is available behind a Settings toggle. The classic UI remains the default for this release.

To try it: **Settings → Appearance → "UI" → "Quiet Composer"** (or click "Try it" on the one-time invitation banner that appears after upgrading).

#### What changes

- **Floating command bar** at the bottom replaces the right-sidebar chat panel. Same chat, same providers, same agents, less chrome. Pinnable to the right edge if you prefer the panel layout.
- **Agent activity** moves from the rail to a single 46px orb (bottom-right) that pulses while tasks are running. Click the orb for the full task list.
- **Sidebar** is now a flat list — Pinned, Projects, Recent, Tags. The full workspace tree is one keystroke away with `⌘⇧E`. Hover or `→` on a project for a one-level peek.
- **Tab bar** is replaced by a compact breadcrumb above the document (Notesage / project / folder / file.md), with a dirty dot and "saved 40s ago".
- **Status bar** is simplified into a tray that opens on click — completions provider, comments, recording state, word count, shortcut help.
- **Toolbars** float as backdrop-blurred pills above the document and viewers (PDF, EPUB, DOCX, PPTX, code editor) and fade while you type.
- **Focus mode** (`⌘.`) dims the chrome and shows a small "Focus · ⌘. to exit" pill.
- **Settings dialog** rebuilt as a two-pane shell with `⌘F` search, live preview for Appearance, and a denser AI & Agents panel.

#### Accessibility

- **ARIA**: combobox + listbox semantics on the command bar, `role="region"` on the pinned panel, `role="tree"` on the workspace overlay, focus traps inside dialogs and overlays, scoped focus restoration.
- **Reduced motion**: every Phase 1 animation respects `prefers-reduced-motion: reduce` (Radix overlays included). Animations are disabled, not just shortened.
- **Keyboard parity with mouse**: hover-peek mirrored by `→`; the right-click menu is reachable via the macOS Menu key or `⌘⇧,`. F2 renames the focused row inline.
- **Automated WCAG contrast audit** (`pnpm audit:contrast`) runs in CI; a new `--color-border-strong` token clears 3:1 for form-control affordances.

#### New keyboard shortcuts

- `⌘⇧E` — open the workspace tree overlay
- `⌘⌥C` — copy the focused file's path
- `⌘⌥R` — reveal the focused file in Finder
- `F2` — rename the focused row inline
- `⌘⇧[` / `⌘⇧]` — cycle through recently used documents (MRU order)
- Double-tap `⌘` — alternate way to focus the command bar (where the OS reliably reports it)

### Removed

- **Preview HTML** (formerly `⌘⇧P`) — the dedicated read-only HTML preview pane is gone. The integrated viewers cover the same need; if you want a standalone HTML render of a document, the export menu still produces self-contained HTML files (right-click a `.md` file → Export as… → HTML).
- **External diff review banner** — replaced by a simpler watcher flow. The default is now to silently auto-reload externally-changed files with a 3-second info toast (`<name> reloaded from disk`). If you want the previous accept/reject UI back, enable **Settings → Editor → "Review external diff"** — when on, you get inline diff decorations plus a sticky toast with Accept / Reject / Dismiss actions.
- **Cross-project mode banner** — the persistent banner above the chat input is gone. When the setting is on, you'll see a compact "Cross-project scope" pill in the command bar's context row instead.

### Known limitations

- The preview is opt-in for this release. Most users will continue to see the classic UI; the toggle is the only entry point.
- New project templates (Default, Research, Writing, Blank) are temporarily unavailable in the new UI's inline create flow — `⌘⇧N` and the Projects `+` button create a blank project. The template picker will return as a `/scaffold-project` skill in a later release; until then, use the classic UI if you need a templated project.
- Sidebar row rendering hasn't been memoized yet, so type-to-filter on lists with thousands of pinned or recent items will feel sluggish on the first keystroke. Real-world workloads (typically <50 items per section) are nowhere near this ceiling — tracked as a follow-up.
- Some chrome that exists in the classic UI (e.g. the resizable activity panel) is intentionally absent from Quiet Composer. Use the orb's panel for the same task list.
- Double-tap `⌘` to focus the command bar relies on native key timing and may be unreliable on some platforms; `⌘K` is always the primary path.

### Internals (for plugin / theme authors)

- **New CSS variables**: `--color-accent`, `--color-border-strong`, `--cmd-bar-pinned-width`.
- **Accent palette**: Default (neutral grey), Orange, Blue, System (reads `NSColor.controlAccentColor` on macOS via the new `get_system_accent_color` Tauri command). Override via Settings → Appearance.
- **New stores**: `tree-overlay-store`, `quiet-sidebar-store`. New settings flags: `uiPreview`, `cmdBarPinned`, `cmdBarPinnedWidth`, `sidebarTagsHidden`, `sidebarRecentCap`.
- **Renamed**: `editor-store.openTabs` → `openDocuments` (with a one-time persisted-state migration; existing localStorage tab lists carry over).
- **New perf categories**: `[perf:cmdbar]`, `[perf:orb]`, `[perf:status]`, `[perf:peek]`, `[perf:tree-overlay]`, `[perf:sidebar]`, `[perf:focus]` — see `docs/architecture.md` for the full list.

---

For prior releases (v0.38.1 and earlier), see [`docs/history/`](docs/history/) or open the in-app "What's new" panel.
