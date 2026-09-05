# Tasks: iOS Home — Only the Folders You Chose

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | ✅ Done (2026-09-05) |
| **PRD** | [ios-home-chosen-folders](../prds/2026-09-05-ios-home-chosen-folders.md) |
| **Total** | 12 tasks: 4S, 6M, 2L |
| **Suggested order** | Format + store (#1–#3) → Actions (#4) → Home screen (#5–#8) → Edit Home (#9–#10) → Docs + device pass (#11–#12) |

All frontend. No Rust, no Swift: `.notesage/home.json` travels through the
same `ios_read_file` / `ios_write_file` / `ios_ensure_directory` commands
that already carry `.notesage/pins.json`.

## Risks and open points

- **Per-folder view memory is landing in parallel.** Home and All Folders
  both list `""`; they must be keyed by a *screen key* (`HOME_KEY` for Home,
  `currentRelPath` otherwise) or Home's view/sort/density leaks into All
  Folders. Whichever branch merges second wires the key (#6 here). Say so on
  both PRs.
- **`atRoot` is currently `folderStack.length === 0`.** All Folders pushes a
  stack entry with `relPath: ""`, so every "am I at the root?" check must be
  split into "root listing" (`currentRelPath === ""`) vs "top of the stack"
  (`folderStack.length === 0`). #6 audits every use.
- **Two devices, one file.** Read-modify-write on every toggle, compaction
  only on write, never a write on read — the `togglePin` discipline. A test
  pins each of those three rules.
- **`house.slash`** may not exist on the deployment target's SF Symbols. #4
  verifies on device; fall back to `minus.circle`.
- **The hint must not nag.** It renders only while `homeFolders === null`
  (no file yet) and is dismissed by `×` or by the first *Show on Home*.

---

### #1 ✅ `home-file.ts` — format, defaults, compaction (pure)

Create `src/lib/home-file.ts` in the image of `src/lib/pins-file.ts`:
framework-free, no Tauri imports.

- `HOME_FILE_REL_PATH = ".notesage/home.json"`, `HOME_KEY = "/home"`.
- `parseHomeFileContent(raw): string[] | null` — `null` for missing shape,
  wrong `version`, or unparseable JSON; drops non-string entries; dedupes.
- `serializeHomeFileContent(folders): string` — `{ version: 1, folders }`,
  two-space indent (matches `pins.json`).
- `defaultHomeFolders(rootEntries): string[]` — `[INBOX_FOLDER_NAME]` when a
  directory of that exact name is in the listing, else `[]`.
- `isHomeCandidate(entry): boolean` — `is_directory && !path.includes("/")`.
- `applyHomeChange(current, relPath, shown, rootEntries): string[]` — add or
  remove, then keep only entries that name a directory in `rootEntries`
  (compaction). Pure so the rule is testable without the store.

**Tests** (`src/lib/__tests__/home-file.test.ts`): round-trip; `null` on
missing file / bad JSON / `version: 2`; defaults with and without Inbox;
compaction drops a vanished folder but never a present one; adding twice is
idempotent; `isHomeCandidate` false for files and nested dirs.

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** —
- **Files:** `src/lib/home-file.ts`, `src/lib/__tests__/home-file.test.ts`

### #2 ✅ Store: `homeFolders`, load, set, rename-rewrite, editor flag, hint

Extend `src/stores/mobile-store.ts`:

- `homeFolders: string[] | null` (not persisted), `loadHomeFolders()` —
  tolerant of a missing file, mirrors `loadPinnedPaths`.
- `setOnHome(relPath, shown, rootEntries)` — read-modify-write: re-read the
  file (not the cached array), `applyHomeChange`, `iosEnsureDirectory(".notesage")`,
  write, then `set({ homeFolders })`. Rethrows so callers can toast.
- `rewritePath(from, to)` — after the pins block, the same read-modify-write
  against `home.json`, only when `from` is listed (no write for an ordinary
  rename).
- `homeEditorOpen` (session only) + `openHomeEditor` / `closeHomeEditor`;
  `goBack()` closes the editor before it considers documents or folders.
- `homeHintDismissed: boolean` + `dismissHomeHint()` — persisted via
  `partialize`.
- `reset()` clears all of the above.

**Tests** (`src/stores/__tests__/mobile-store.test.ts`): load → `null` when
the read throws; `setOnHome` re-reads before writing (a pin-style clobber
test: file changed underneath, both changes survive); `setOnHome` compacts;
`rewritePath` rewrites a Home entry and does not write when the path is not
on Home; `goBack` closes the editor first; hint flag persists.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #1
- **Files:** `src/stores/mobile-store.ts`, `src/stores/__tests__/mobile-store.test.ts`

### #3 ✅ i18n keys (en + sv)

Add to `src/lib/i18n.ts` in both dictionaries: `home.allFolders`,
`home.editTitle`, `menu.editHome`, `action.showOnHome`,
`action.hideFromHome`, `home.emptyTitle`, `home.emptyBody`,
`home.chooseFolders`, `home.hint`, `home.updateFailed`. "Inbox" itself stays
the untranslated on-disk name (`@/lib/inbox`).

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** —
- **Files:** `src/lib/i18n.ts`

### #4 ✅ Hold menu: *Show on Home* / *Hide from Home*

In `src/lib/mobile-entry-actions.ts`:

- `EntryActionContext` gains `isOnHome(relPath)` and
  `setOnHome(relPath, shown): Promise<void>`.
- `entryMenuItems` adds one full-width row, after the icon row and before
  Listen/Rename/Move, only when `isHomeCandidate(entry)`: id `home-show`
  (`house`) or `home-hide` (`house.slash`, fallback `minus.circle` if the
  symbol is missing on device — check in #12).
- `runEntryAction` handles both ids; failure toasts `home.updateFailed`.
- `delete` on a Home folder: after `iosDeleteFile` succeeds, call
  `ctx.setOnHome(path, false)` so no dead entry waits for the next compaction.

**Tests** (`src/lib/__tests__/mobile-entry-actions.test.ts` — add to the
existing file if present, else create): row present for a root dir, absent for
a nested dir and for a file; label flips with `isOnHome`; delete of a Home
folder calls `setOnHome(false)`.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #1, #3
- **Files:** `src/lib/mobile-entry-actions.ts`, `src/lib/__tests__/mobile-entry-actions.test.ts`

### #5 ✅ `AllFoldersRow` + `HomeHint` components

- `src/components/mobile/AllFoldersRow.tsx` — copies `InboxCard`'s geometry
  (40pt icon slot, `1.0625rem` scaled text, chevron, the split 8+8 inset)
  with lucide `Folders` at `strokeWidth={1.5}` in `text-muted-foreground`
  and **no** tinted background. Label `t("home.allFolders")`.
- `src/components/mobile/HomeHint.tsx` — one muted line (`0.75rem` scaled,
  a11y weight var) reading `t("home.hint")` with an `×` button
  (`aria-label` "Dismiss"). No card chrome.

Both take the a11y variables from the ancestor root like every folder-view
surface (no `useA11yPrefs` of their own).

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #3
- **Files:** `src/components/mobile/AllFoldersRow.tsx`, `src/components/mobile/HomeHint.tsx`

### #6 ✅ LibraryBrowser: Home derivation, All Folders level, screen key

In `src/components/mobile/LibraryBrowser.tsx`:

- Read `homeFolders`, `loadHomeFolders`, `setOnHome`, `homeHintDismissed`,
  `dismissHomeHint`, `openHomeEditor` from the store. Call `loadHomeFolders()`
  on mount **and** after every successful root listing load (one small read;
  this is how the iPad's change shows up on pull-to-refresh / foreground).
- **Home derivation** (root, `!query`): `chosen = homeFolders ?? defaultHomeFolders(entries)`;
  folder rows = `entries` ∩ chosen; root files unchanged; Inbox card only
  when `Inbox` ∈ chosen and the directory exists (it is then excluded from the
  rows as today). With a query: filter the **whole** `entries` — existing
  behaviour, untouched.
- Render order (both views): Inbox card → folder rows / grid → root files →
  `HomeHint` (when `homeFolders === null && !homeHintDismissed` and the root
  has a non-Inbox folder) → `AllFoldersRow`.
- **All Folders**: `enterFolder({ relPath: "", name: t("home.allFolders") })`.
  Audit every root check and split it:
  `atRoot` (create-folder rule) → `currentRelPath === ""`;
  Inbox card / hint / All Folders row / Edit Home menu row → `folderStack.length === 0`.
- **Screen key**: `const screenKey = folderStack.length === 0 ? HOME_KEY : currentRelPath`
  for the scroller `key`, `scrollOffsets`, `restoredFor`, and the per-folder
  view memory hook once it exists (coordinate with that branch).
- `actionContext` gains `isOnHome` and `setOnHome` (passing the current
  `state.entries` for compaction; toasts `home.updateFailed` on failure).
  A successful *Show on Home* also calls `dismissHomeHint()`.
- Search status label counts the rows currently shown.

**Tests** (`src/components/mobile/__tests__/LibraryBrowser.test.tsx`, using
the existing `setMockInvokeHandler` harness): no file + Inbox + 6 folders →
Inbox card, hint, All Folders, zero folder rows; file listing two folders →
exactly those rows in alphabetical order; file without Inbox → no card; a
chosen folder absent from the listing → not rendered, no error; query
matches a hidden folder; All Folders push shows every folder and Back
returns to Home; `+` label is "New Folder" on both Home and All Folders; the
hint disappears after a *Show on Home* and after `×`.

- **Complexity:** L — touches the browser's root-vs-stack assumptions
  throughout; highest blast radius in the set.
- **Category:** frontend
- **Dependencies:** #1, #2, #3, #4, #5
- **Files:** `src/components/mobile/LibraryBrowser.tsx`, `src/components/mobile/__tests__/LibraryBrowser.test.tsx`

### #7 ✅ Empty Home state

In `LibraryBrowser.tsx`: when the root listing is non-empty but Home resolves
to no Inbox card, no folder rows and no root files, render `HomeEmpty` —
the `EmptyFolder` layout (`FolderOpen` 1.25 stroke, 500-weight title, muted
body) with `t("home.emptyTitle")` / `t("home.emptyBody")` and an outline
`Button` **Choose folders…** (`ios-press-row`) calling `openHomeEditor()`.
`AllFoldersRow` still renders beneath. The existing `EmptyFolder` keeps
winning when `state.entries.length === 0`.

**Tests:** empty Home shows the button and the All Folders row; an empty
library shows `EmptyFolder` instead.

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #6
- **Files:** `src/components/mobile/LibraryBrowser.tsx`, `src/components/mobile/__tests__/LibraryBrowser.test.tsx`

### #8 ✅ "…" menu: *Edit Home…* row (root only)

In the `topRight` menu builder in `LibraryBrowser.tsx`, at root only
(`folderStack.length === 0`), append an **action** row (no `selected`)
`{ id: "edit-home", title: t("menu.editHome"), icon: "slider.horizontal.3", sectionBreak: true }`
after the image-size rows, and map `"edit-home": () => openHomeEditor()`.
Web fallback: an `Edit Home` `ChromeButton` (lucide `SlidersHorizontal`) in
the top-right island at root.

Note for the native side (no change needed): action rows already emit via
the Toggle-binding trick in `ChromeOverlay.swift` — do **not** add a
`selected` flag or the row renders as a checkmark.

**Tests:** menu declares the row at root, not one level down; tapping it
sets `homeEditorOpen`.

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #2, #3, #6
- **Files:** `src/components/mobile/LibraryBrowser.tsx`, `src/components/mobile/__tests__/LibraryBrowser.test.tsx`

### #9 ✅ `HomeFolders` — the Edit Home screen

Create `src/components/mobile/HomeFolders.tsx`:

- Loads `iosListDirectory("")`, keeps visible directories only (same hidden
  filter as the browser), Inbox first when present, then
  `localeCompare(..., { sensitivity: "base" })`.
- One row per folder: `useFolderAppearance` icon + colour in the 40pt slot,
  name at the `FileRow` scale with the a11y weight var, shadcn `Switch` on
  the right, `aria-label` = folder name. Checked = `isOnHome` (with
  `homeFolders ?? defaultHomeFolders(entries)`).
- Toggle → `setOnHome(path, next, entries)`; optimistic flip; on rejection
  toast `home.updateFailed` and revert.
- Skeleton (reuse the browser's `BrowserSkeleton` shape) while loading;
  `BrowserError` with retry on failure.
- Native chrome via `useNativeChrome`: `topLeft: { id: "back", icon: "chevron.backward" }`,
  `topCenter: { title: t("home.editTitle") }`, no `topRight`, no `search`,
  no `bottomRight`; `back` → `closeHomeEditor()`. Web fallback: the
  top-left `ChromeButton` back island.
- Root `div` carries `a11yRootProps(useA11yPrefs())` like `LibraryBrowser`.

**Tests** (`src/components/mobile/__tests__/HomeFolders.test.tsx`): order
(Inbox first, then alphabetical, hidden dirs excluded, files excluded);
switches reflect the file; a toggle writes `home.json` with the expected
content; a rejected write reverts and toasts; back closes.

- **Complexity:** L
- **Category:** frontend
- **Dependencies:** #1, #2, #3
- **Files:** `src/components/mobile/HomeFolders.tsx`, `src/components/mobile/__tests__/HomeFolders.test.tsx`

### #10 ✅ Route the editor in `MobileApp`

In `src/MobileApp.tsx`, when `grantState === "granted"`: `homeEditorOpen` →
`<HomeFolders />`; else the existing `openDoc ? <Reader/> : <LibraryBrowser/>`.
The editor is a leaf like the Reader — nothing else changes; the inline sweep
stays mounted at the root as today.

**Tests** (`src/components/mobile/__tests__/mobile-app.test.tsx`): the flag
swaps the screen and Back restores the browser.

- **Complexity:** S
- **Category:** frontend
- **Dependencies:** #2, #9
- **Files:** `src/MobileApp.tsx`, `src/components/mobile/__tests__/mobile-app.test.tsx`

### #11 ✅ Docs: `docs/features/mobile.md`

Add a **"Home: only the folders you chose"** section after "Reaching the
Inbox (#683)": what Home lists, the defaults rule (missing file = Inbox only;
present file authoritative), `home.json` beside `pins.json` and why it is
neither the Mac's project list nor `pins.json`, All Folders as a pushed
level with `HOME_KEY`, hold-menu rows, Edit Home, disappearance +
compaction-on-write, search-over-root. Add Key files rows for
`home-file.ts`, `HomeFolders.tsx`, `AllFoldersRow.tsx`. Update the "What it
does" bullet that describes browsing the root. Do not touch the PRD after
this (PRDs are historical).

- **Complexity:** M
- **Category:** docs
- **Dependencies:** #6, #9
- **Files:** `docs/features/mobile.md`

### #12 ✅ Simulator + device pass, every state

Per `feedback_ios_verify_every_state` and `feedback_verify_ios_in_simulator_first`:
seed a library with `Inbox/` (a few captures), six root folders (two with a
Mac `project.json` appearance, one nested folder inside one of them), two
root files. Screenshot, light **and** dark:

1. Home, no `home.json` — list comfortable / condensed, gallery comfortable /
   condensed: Inbox card, root files, hint, All Folders, nothing else.
2. After *Show on Home* on two folders (one from All Folders, one via Edit
   Home): both views again; Mac icon/colour present.
3. Home with Inbox switched off; then Inbox reachable from the breadcrumb
   menu at depth 2.
4. Empty Home (Inbox absent, nothing chosen, no root files).
5. All Folders: back button, breadcrumb ancestor is the library, `+` creates
   a folder, Inbox is a plain row.
6. Edit Home with Dynamic Type at the largest non-a11y size and Bold Text on.
7. Hold menu on: a root folder on Home, a root folder off Home, a nested
   folder (no row), a file (no row). Confirm `house.slash` renders; else swap
   to `minus.circle` in #4.
8. Rename a Home folder on the Mac, then pull-to-refresh on the phone: no
   dead row; toggle any switch; confirm `home.json` no longer lists the old
   name.
9. Second simulator (or the iPad) on the same seeded library: Home matches
   after a refresh.

Then `pnpm typecheck`, `pnpm test`, and the iOS Simulator Build CI job. Run
the whole PRD quality-gate list before calling it done.

- **Complexity:** M
- **Category:** frontend (verification)
- **Dependencies:** #6, #7, #8, #10
- **Files:** — (screenshots attached to the PR)
