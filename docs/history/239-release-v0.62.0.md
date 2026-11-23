# Release v0.62.0

**Date:** 2026-11-23
**Previous version:** 0.61.0

If you use Notesage on more than one Mac, your folders stay yours on each of
them again. This release also closes a long list of ways a failed read could
quietly turn into lost work.

## Changes

### Features

- The **+** next to Folders in the sidebar now opens a small menu: **New
  project**, or **Add existing folder…** to bring in a folder that is already
  on your Mac. Before, it could only create a new one.
- New projects are created in your iCloud library when iCloud is available, so
  they show up on your other devices. The confirmation tells you where the
  project went.

### Improvements

- Removing a synced project from the sidebar now sticks on that Mac. It used
  to come back at the next launch.
- Recording a meeting no longer slows the rest of the app down while you type.
- The editor stays responsive while an AI answer is streaming in.
- Memory used by PDFs and other documents is released when you close them.
- The keyboard shortcuts list (⌘⇧K) now shows the shortcuts the app actually
  uses. Several entries were wrong or referred to things that no longer exist.
- If the sidebar ever fails to load, it now says what went wrong and offers a
  Reload button instead of leaving you stuck.

### Fixes

- After moving your library to Notesage's own iCloud folder on one Mac, your
  other Mac could lose sight of its projects and start up showing the first
  Mac's folders instead. Each Mac now follows the move and keeps its own
  folders, pinned files and open document.
- A project could disappear from the sidebar with a message saying its folder
  no longer existed, when the folder was only temporarily unreadable. Projects
  are now removed only when the folder is really gone, and a problem reading
  your iCloud library is shown instead of an empty sidebar.
- Typing in one document and switching to another straight away could, in rare
  cases, put the second document's text into the first.
- Page breaks could vanish from a document after opening and saving it.
- Comments on a document could be wiped if they failed to load once.
- A project's settings, including its AI provider lock, could be reset if the
  settings file had not finished downloading from iCloud.
- The Recordings list could stay empty even with recordings on disk, and
  recordings made while the app was closed were not picked up for
  transcription.
- Letters such as å, ä and ö, and emoji, could come out garbled in AI answers.
- Chats with GitHub Copilot could mix up their history between conversations,
  and its tools could stall for a minute before failing.
- Typing a name that already existed when creating a project silently took
  over the existing folder. It now tells you the name is taken.
- Importing MCP servers from VS Code did nothing.
- Strikethrough is ⌘⇧S; the toolbar and the shortcuts list said ⌘⇧X.
- Several security fixes to how AI tools and agents are confined to your
  project folders — no action required.

## Under the hood

Everything here is #1081. It began as one bug report (a second Mac losing its
projects after a library move performed elsewhere), grew a fix for the Folders
`+` button, and then carried the high-severity findings of a full-app audit:
`docs/audits/2026-11-22-full.md`, 13 areas, 31 high / 116 medium / 119 low,
filed as issues 1082 to 1125.

The audit's recurring theme is one bug class: a read that fails (iCloud not
downloaded yet, permissions, a transient error) is treated as "empty", shown as
the truth, and then written back over the real data. The library marker,
comment sidecars, `project.json`, the file-backed stores and project pruning
all had it. Each now distinguishes "absent" from "could not read".

Fixed and closed: 1082-1084, 1086-1089, 1093, 1097-1104, 1106-1110, 1123,
1125. Partly fixed, still open: 1085 (the last ~150 ms of typing can be lost
when opening a different document), 1094 (no backend-enforced root check, so a
symlink inside a project is not caught), 1096 (an ancestor-rename bypass of the
new sandbox write denies), 1105 (a store file holding invalid JSON). Not
attempted: 1090-1092 (large-file refactors) and 1095 (narrowing the Seatbelt
`mach-lookup` rule needs a real Mac).

Dependencies: the npm and Rust audit gates were both red on main. npm:
`markdown-it` 14.3.3, `dompurify` 3.4.17, `source-map-js` override. Rust:
`rustls`, `rusqlite` 0.43, our own `zip` 9 and others; nine advisories are
ignored with reasons in `src-tauri/.cargo/audit.toml` because they sit in old
`zip` copies that are only used to write exports or are Windows-only, and
`scripts/check-audit-ignore-claims.sh` now enforces that claim. The Playwright
CI job is pinned to Ubuntu 24.04 until `@playwright/test` supports 26.04.

Not done for this release, and worth doing on a Mac: `pnpm licenses:generate`
(dependencies changed; the generator must run on macOS), and a real-launch
entry in `docs/performance-baseline.md` — startup now resolves the synced
library alongside tree validation instead of after it.

## Files Changed

- 101 files changed in #1081 (+10,959 / -1,069)
