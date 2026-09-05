# PRD: iOS Home — Only the Folders You Chose

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | The phone's root screen shows the Inbox and the folders the user asked for — not every folder in the library |
| **Tasks** | [ios-home-chosen-folders-tasks](../tasks/2026-09-05-ios-home-chosen-folders-tasks.md) |
| **Depends on** | Folder cards with the Mac's icon and colour (#140, shipped); per-folder view memory (in flight — see "Interplay") |

## Problem

The root of the iOS app is the raw root listing of the iCloud library: every
folder, alphabetically, with the Inbox card pinned above (#683). For anyone
who has used the Mac for a while that is a long wall — archived projects,
research dumps, a `templates/` folder — when what they open on the phone is
the Inbox and two or three live folders.

The owner's ask, verbatim:

> Maybe I don't want to displayable folders in Notesage, just the ones that I
> have selected to display, maybe just the inbox.

and, about the same screen:

> I am not happy with all screens following the same setting in the app, ie
> list view or gallery view. Folders in the root look pretty ugly in gallery
> view, just a wall of folder icons, no personalization like we have on Mac.

Two of the three complaints are already answered: the Mac's per-folder icon
and colour now render on the phone's rows and cards (#140), and per-folder
view memory (view / sort / density remembered per folder) is being built
separately. What is left is the wall itself. The Mac solved this long ago —
its sidebar is a curated list (Pinned, Projects, Folders), not a directory
listing — and the phone should be curated the same way.

## Goals / Non-Goals

### Goals

- The root screen — **Home** — lists the Inbox and only the folders the user
  chose to show. Inbox is on by default; nothing else is.
- Choosing is one gesture away: hold a folder → **Show on Home** / **Hide
  from Home**.
- The whole set is manageable in one place: an **Edit Home** screen listing
  every root folder with a switch.
- Every folder stays reachable in two taps or one search, whether or not it
  is on Home. Nothing becomes unreachable.
- The choice follows the library: an iPhone and an iPad on the same iCloud
  library show the same Home.
- No native code changes. The feature is web + one shared sidecar file, on
  the exact pattern `.notesage/pins.json` already uses.

### Non-Goals

- Reordering Home by hand. Order is Inbox first, then alphabetical — same as
  the rows below it today. (Drag-to-reorder is a follow-up if anyone misses
  it; see Out of Scope.)
- Nesting: only **root-level** folders can be on Home in this phase.
- A Mac-side reader or writer for the chosen set. The file is designed so the
  Mac *can* read it later (a "Show on iPhone" checkbox in project settings);
  wiring it is a separate PRD.
- A Recent section on Home. See Decisions.
- Touching per-folder view memory, folder appearance, or the Inbox card's
  geometry — those are done or in flight elsewhere and are only *referenced*
  here.

## Decisions

Everything below was decided rather than asked, per the brief. The reasoning
is recorded so a later reader can overturn a decision knowingly.

| Question | Decision | Why |
| --- | --- | --- |
| Where does the chosen set live — local persisted store or a shared sidecar? | **Shared sidecar `.notesage/home.json` at the library root, written by iOS, ignored by the Mac.** | The set is a property of *the library*, like pins, not of one device: a second iPhone or an iPad should open to the same Home, and a new device should not start from defaults. The pattern already exists and is tested (`pins-file.ts` + `togglePin`'s read-modify-write, `iosEnsureDirectory(".notesage")`, tolerant parse). The file is a handful of strings, so iCloud's worst case — two devices toggling offline, last writer wins — loses one toggle, the same trade already accepted for pins. Local-only would be simpler but wrong the first time the user picks up the iPad. |
| Should it be the Mac's project list, or piggyback on `pins.json`? | **Neither. A new file the Mac does not read.** | The Mac's `projects` are per-machine absolute paths, some outside iCloud, and `scan-icloud-projects.ts` auto-adds *every* iCloud root folder that has a `.notesage/` dir — for a Mac user "Mac projects" is nearly "all folders", the wall we are removing. Folding the set into `pins.json` would rearrange the Mac sidebar from a phone navigation preference — exactly what #683 refused to do for the Inbox. A sibling file keeps both apps honest and leaves a clean hook for the Mac later. |
| Defaults for a library with no `home.json` | **Inbox only** (when an `Inbox/` folder exists). Root-level *files* still show. | The literal ask. The alternative — pre-select folders that carry `.notesage/project.json` — is nearly the status quo for a Mac user (see above) and would make the first launch of this build look unchanged. A short Home with a one-time hint and an "All Folders" row teaches the model in one glance; a full Home teaches nothing. The `project.json` signal is still used, for free: those folders render with their Mac icon and colour in the Edit Home list, so they stand out as the likely picks. |
| Missing file vs. present file | **Missing = defaults apply. Present = authoritative, including "Inbox is not listed, so Inbox is hidden".** | Lets the user turn the Inbox card off (they may not use the share sheet at all) while never writing a file the user did not ask for — a Mac reader later can still tell "never curated" from "curated to Inbox only". |
| Root-level files (the Mac's Quick Notes land in the library root) | **Stay on Home**, below the folders, under the existing sort/group rules. | A file at the root has no folder to hide behind; hiding it would make the phone lose notes the Mac made. The complaint was folders, and root files are rare. |
| Nested folders on Home | **Root-level only.** The hold-menu row appears only for directories with no `/` in their path. | Home is a curated *top level*; a nested folder on Home would need a path subtitle and would break "back goes to the parent". Relaxing this later is a filter change plus a subtitle, and the file format already carries full relative paths. |
| A Recent section on Home | **No, deferred.** | Home v1 is subtraction. A cross-folder Recent needs file rows with thumbnails and article headers from many folders, and its own interplay with per-folder view memory — a separate design. `recentlyRead` already exists in the store, so it is cheap to add later. |
| How is a folder that is *not* on Home reached? | **An "All Folders" row at the bottom of Home** that pushes the full root listing as a level (Back returns to Home), **plus search at Home searches the whole root**, not just the chosen rows. The breadcrumb's permanent Inbox jump stays. | The top-left "folder" button at root is `pickFolder()` — it re-grants the *library*, it does not browse — so it cannot be the escape hatch. Notes puts "All iCloud" at the bottom of its folder list for the same reason. Search over two rows is pointless; search over the root is the second way to reach anything. |
| Where does "manage the set" live, given the app has no settings screen? | **An "Edit Home…" row in the root "…" menu (and a button in the empty state) that pushes a web-rendered Edit Home screen** with a switch per root folder. | The doc is explicit that every preference is a UIMenu row and a settings screen would be a foreign idiom — for *three toggles*. A list of N folders with switches is a screen's worth, and iOS has the precedent: Files → Browse → **Edit** is a toggle list of locations. A UIMenu submenu of thirty folders is the wrong tool. Web-rendered, with the existing native chrome (back + title), so no Swift. |
| What happens when a chosen folder disappears (deleted or renamed on the Mac)? | **Home simply omits it** — Home is the intersection of the set with the live root listing. **Stale entries are compacted on the next write** (any toggle), never on read. A rename on the *phone* rewrites the entry, like pins. | Compacting on read risks dropping a folder that is mid-sync; compacting on write is bounded and the user is already changing the set. A folder renamed on the Mac is, from the phone's view, a new folder — the user adds it again. The Edit Home screen lists only folders that exist, so a stale entry can never be *seen* as a broken switch. |
| The Inbox card | **Unchanged in geometry and behaviour**; it is the row for the `Inbox` member of the set. Toggling Inbox off hides the card; the breadcrumb Inbox jump still works from any depth. | The card is settled design (#683/#684); this PRD only decides whether it is rendered. |
| Gallery view at Home | **Same rows as list, as folder cards.** "All Folders" is a row after the grid, the Inbox card a row before it, in both views. | Fewer folders plus the Mac icon/colour *is* the answer to the "wall of folder icons"; nothing else changes. |
| First launch of this build on a curated library | **A one-time hint row** on Home when the file is missing and the root has folders: "Your folders are in All Folders. Hold one and choose Show on Home." Dismissed locally. | An existing user's root shrinking to one card is a surprise; one sentence at the point of surprise is enough. The hint is per-device state (it is about *this* screen having changed), so it lives in the persisted store, not the sidecar. |

## User Stories

- As a phone user who mostly reads what I shared from Safari, I want the app
  to open to the Inbox and nothing else, so that what I came for is the first
  thing on screen.
- As someone with three live projects and twenty archived ones, I want to
  hold a folder and choose *Show on Home*, so that Home is my three and the
  twenty are one tap away under All Folders.
- As someone who curated Home on my iPhone, I want my iPad to show the same
  Home, so that I do not curate twice.
- As someone who just renamed a project on the Mac, I want Home to not show a
  dead row, so that the phone never looks broken because the Mac was busy.
- As someone who forgot which folders I hid, I want one screen with every
  root folder and a switch, so that I can fix the set without hunting for the
  hold gesture.
- As someone who never uses the share sheet, I want to switch the Inbox off,
  so that Home is only my folders.

## Technical Approach

### Shape of the change

All frontend; no Rust, no Swift. The file is read and written through the
existing `ios_read_file` / `ios_write_file` / `ios_ensure_directory`
commands, which already carry `.notesage/pins.json` — a sibling JSON file
needs nothing new from the native layer.

```
src/lib/home-file.ts             pure format + derivation (mirrors pins-file.ts)
src/stores/mobile-store.ts       homeFolders (null = no file), load / set, rewrite on rename
src/lib/mobile-entry-actions.ts  "Show on Home" / "Hide from Home" hold-menu row
src/components/mobile/LibraryBrowser.tsx   Home derivation, All Folders row, hint, empty state, search-over-root
src/components/mobile/HomeFolders.tsx      Edit Home screen (switch per root folder)
src/MobileApp.tsx                route: HomeFolders when the editor flag is set
```

### Derivation, not a second listing

Home is **derived at render time from the root listing the browser already
loads**, filtered by the chosen set — the same way the Inbox card and the
grouping sections are derived today. There is no separate "Home listing"
IPC, no cache to invalidate, and a folder that vanished from disk vanishes
from Home on the next listing with no special case.

```ts
// at the root, no query:
const chosen = homeFolders ?? defaultHomeFolders(entries);   // null file → [Inbox]
const homeFolderRows = entries.filter(e => e.is_directory && chosen.has(e.path));
const rootFiles      = entries.filter(e => !e.is_directory);
// with a query: filter over ALL entries — the existing behaviour, unchanged.
```

### "All Folders" is a pushed level, not a mode

All Folders pushes `{ relPath: "", name: t("home.allFolders") }` onto
`folderStack`. That reuses everything the folder stack already gives —
native back button, breadcrumb island with the library as ancestor, scroll
offsets, Back returns to Home — and the listing code loads `""` exactly as
it does today. Two places currently conflate "root listing" with "top of the
stack" and must be split:

- `atRoot` (which decides whether "+" creates a folder or a note) becomes
  `currentRelPath === ""` — true on Home *and* All Folders.
- Screen identity (`key` on the scroller, `scrollOffsets`, and the in-flight
  per-folder view memory) uses a **screen key**: `HOME_KEY` on Home,
  `currentRelPath` otherwise. `HOME_KEY = "/home"` — a relative path can never
  begin with `/` (`sanitize_rel_path` rejects absolute paths), so it cannot
  collide with a real folder.

The Inbox card renders only on Home (`folderStack.length === 0`), as now; in
All Folders the Inbox is an ordinary row.

### The sidecar

`<library>/.notesage/home.json`, beside `pins.json`:

```json
{ "version": 1, "folders": ["Inbox", "Reading", "Writing"] }
```

Root-relative paths, one segment each in this phase. Order in the file is
not significant (display order is Inbox first, then alphabetical), which
keeps a two-device write conflict a pure set question.

- **Read** on browser mount and on every root listing load (one small read;
  a change made on the iPad shows on the next pull-to-refresh or foreground
  return, the same triggers that refresh the listing).
- **Write** by read-modify-write on every toggle, exactly as `togglePin`:
  re-read the file, apply the change, compact entries absent from the root
  listing passed in by the caller, `iosEnsureDirectory(".notesage")`, write.
  Never write on read, never write to materialise defaults.
- **Missing or unparseable** → `null` in the store → defaults apply.
- **Rename on the phone** of a folder on Home → `rewritePath` rewrites the
  entry (extend the existing function; it already does this for pins).
- **Delete on the phone** of a folder on Home → the delete action drops it
  from the set after the delete succeeds (no dead entry waiting for the next
  compaction).

### Hold menu

`entryMenuItems` adds one row for directories whose path contains no `/`:
`Show on Home` (SF `house`) or `Hide from Home` (SF `house.slash`; verify the
symbol renders on the deployment target and fall back to `minus.circle`).
Placed after Pin, before the full-width rows. `EntryActionContext` gains
`isOnHome(relPath)` and `setOnHome(relPath, shown)` so one context object
still serves every row and card — the same discipline as `isPinned` /
`togglePin`.

### Edit Home screen

A React screen (`HomeFolders.tsx`) mounted by `MobileApp` when
`mobile-store.homeEditorOpen` is true (session state, not persisted — like
`openDoc`, and reset by `goBack`). It lists the root directories from one
`iosListDirectory("")` — hidden entries excluded as everywhere — Inbox first
if present, then alphabetical, each with the Mac icon/colour via
`useFolderAppearance` and a shadcn `Switch`. A toggle writes immediately;
there is no Save. Native chrome via `useNativeChrome`: back top-left, title
"Home" top-centre, no top-right, no search, no create button. The web
fallback (desktop dev, tests) renders the islands `Chrome.tsx` provides.

### Interplay with per-folder view memory (in flight)

That work keys remembered view / sort / density by folder. Home and All
Folders must not share a key even though both list `""`: Home's key is
`HOME_KEY`. Whichever lands second wires the key; both task lists should say
so. Nothing else in this PRD touches view preferences.

### What is deliberately reused

- `InboxCard` — rendered or not; not restyled.
- `useFolderAppearance` — the Edit Home list and Home rows get the Mac's icon
  and colour for free.
- `pins-file.ts` — `home-file.ts` is written in its image (framework-free,
  tolerant parse, serializer) so the two cannot drift in idiom.
- `jumpToFolder`, the breadcrumb Inbox entry, the "…" menu builder, the
  search island — untouched apart from the additions named above.

## UI/UX

### Home (root, no query)

```
┌──────────────────────────────────┐
│ [folder]      Notesage       [ … ] │   ← chrome unchanged (pick / breadcrumb / view menu)
│                                  │
│  ▣  Inbox                   12 › │   ← InboxCard, unchanged, only if Inbox ∈ set
│                                  │
│  ★  Reading                  8 › │   ← chosen folders, Mac icon + colour, alphabetical
│  ✎  Writing                  3 › │
│                                  │
│     quick-note.md                │   ← root files, as today (sort/group rules apply)
│                                  │
│  ▤  All Folders                › │   ← always last; pushes the full root listing
│                                  │
│           [ search      3 items ] │
│                             [ + ] │   ← creates a folder (root rule)
└──────────────────────────────────┘
```

- The All Folders row uses `InboxCard`'s geometry (same 40pt icon slot,
  text size, chevron) with a neutral `Folders` glyph and **no** tinted
  background — it is a plain row, not a highlighted one; only the Inbox is
  highlighted. Placed after root files, after the grid in gallery view.
- **Hint row** (missing file, root has ≥1 non-Inbox folder, not yet
  dismissed): one muted line under the last folder — "Your folders are in All
  Folders. Hold one and choose Show on Home." with a small `×`. Dismiss
  persists locally (`homeHintDismissed`). Adding any folder to Home dismisses
  it too.
- **Empty Home** (set resolves to nothing, no root files): the standard empty
  layout (`FolderOpen` glyph, 500-weight title, muted body) reading "Nothing
  on Home yet" / "Choose the folders you want here." with an outline
  **Choose folders…** button opening Edit Home. The All Folders row still
  renders beneath it. If the library root has no entries at all, the existing
  `EmptyFolder` ("Nothing here yet") wins — Home has nothing to curate.
- **Gallery view**: the chosen folders as cards (existing `GalleryCard`,
  Mac icon/colour); Inbox card above, All Folders row below.
- **"…" menu** at root gains, after the image options and behind a
  `sectionBreak`, an action row **Edit Home…** (SF `slider.horizontal.3`).
  Not shown below the root.
- **Search island** at Home: typing filters the *whole* root listing (all
  folders + files), so a hidden folder appears as you type; clearing the query
  returns to Home. The status label counts the rows currently shown.

### All Folders

Exactly today's root listing, one level down: back button, breadcrumb
"All Folders" with the library as the ancestor, Inbox as an ordinary row,
"+" creates a folder. Hold any root folder → **Show on Home** /
**Hide from Home**.

### Hold menu

Files/Notes layout unchanged: icon row (Share · Pin · Delete), then the
full-width rows. The new row sits after the icon row, before Listen / Rename
/ Move, and only for root-level directories.

### Edit Home

```
┌──────────────────────────────────┐
│ [‹]           Home               │
│                                  │
│  ▣  Inbox                   (●) │
│  ★  Reading                 (●) │
│  ▦  Archive 2024            ( ) │
│  ✎  Writing                 (●) │
│  …                               │
└──────────────────────────────────┘
```

Rows use the `FileRow` type scale and the a11y scale/weight variables
(`--ns-a11y-scale`, `--ns-a11y-weight`) like every folder-view surface. The
switch is the shadcn `Switch` (accent ON state is the design system's
sanctioned use). A failed write toasts (`toast.error`) and reverts the switch.
Dark mode and the contrast slider come free through CSS variables.

### States and errors

- Listing failure at root → existing `BrowserError`; Home has nothing to add.
- `home.json` unreadable → defaults, silently (a malformed file is not the
  user's problem to see; it is overwritten on the next toggle).
- Write failure (iCloud offline, permissions) → toast
  "Couldn't update Home: {error}", state unchanged.

## Data Model

```ts
// src/lib/home-file.ts — framework-free, mirrors pins-file.ts
export const HOME_FILE_REL_PATH = ".notesage/home.json";
/** Screen key for Home in per-screen maps (scroll offsets, view memory).
 *  A rel path can never start with "/" so this cannot collide. */
export const HOME_KEY = "/home";

interface HomeFileShape { version: 1; folders: string[] }

/** `null` when the file is missing or unparseable — the caller applies defaults. */
export function parseHomeFileContent(raw: string): string[] | null;
export function serializeHomeFileContent(folders: string[]): string;
/** [Inbox] when an Inbox directory exists in the root listing, else []. */
export function defaultHomeFolders(rootEntries: FileEntry[]): string[];
/** True for a directory entry that may be offered "Show on Home" (root-level). */
export function isHomeCandidate(entry: FileEntry): boolean;
/** Set ∪/∖ one path, then drop entries not present in `rootEntries` (compaction). */
export function applyHomeChange(current: string[], relPath: string, shown: boolean, rootEntries: FileEntry[]): string[];
```

```ts
// src/stores/mobile-store.ts — additions
homeFolders: string[] | null;            // null = no file → defaults. Not persisted.
loadHomeFolders: () => Promise<void>;    // tolerant of a missing file
setOnHome: (relPath: string, shown: boolean, rootEntries: FileEntry[]) => Promise<void>;
homeEditorOpen: boolean;                 // session only
openHomeEditor: () => void;
closeHomeEditor: () => void;             // goBack() also closes it
homeHintDismissed: boolean;              // persisted (partialize)
dismissHomeHint: () => void;
// rewritePath(from, to) additionally rewrites home.json when `from` is on Home.
```

```ts
// src/lib/mobile-entry-actions.ts — EntryActionContext additions
isOnHome: (relPath: string) => boolean;
setOnHome: (relPath: string, shown: boolean) => Promise<void>;
```

New i18n keys (`src/lib/i18n.ts`, en + sv): `home.allFolders`,
`home.editTitle`, `menu.editHome`, `action.showOnHome`,
`action.hideFromHome`, `home.emptyTitle`, `home.emptyBody`,
`home.chooseFolders`, `home.hint`, `home.updateFailed`.

No Tauri commands, no Rust structs, no Swift.

## Dependencies

- Folder icon + colour on iOS (#140) — shipped; reused as-is.
- Per-folder view memory — in flight; the only coupling is the `HOME_KEY`
  screen key described above.
- `ios_write_file` / `ios_read_file` / `ios_ensure_directory` — existing.
- shadcn `Switch` — already in `src/components/ui/`.

## Quality Gates

Outcome-shaped; run the scenario, do not just check the file.

**Functional**

- [ ] A library with `Inbox/` and six other root folders and **no**
  `home.json` opens to Home showing the Inbox card, any root files, the hint
  row, and the All Folders row — and no folder rows.
- [ ] Hold a folder in All Folders → *Show on Home* → Back: the folder is on
  Home with its Mac icon and colour, `home.json` lists it, and a second device
  on the same library shows it after its next listing refresh.
- [ ] Hold a folder on Home → *Hide from Home*: it leaves Home and is still
  in All Folders. The hint, if showing, is gone once any folder was added.
- [ ] "…" → *Edit Home…* lists every root folder, Inbox first, switches
  reflecting the set; flipping Inbox off removes the Inbox card, and the
  breadcrumb's Inbox jump still works from any depth.
- [ ] Delete or rename a Home folder on the Mac: after the next listing the
  phone's Home shows no dead row and no error; the next toggle compacts the
  stale entry out of `home.json`. Renaming the folder on the *phone* keeps it
  on Home.
- [ ] Typing in the search island at Home surfaces folders that are not on
  Home; clearing the query returns to Home.
- [ ] With Inbox absent, nothing chosen, and no root files, Home shows the
  empty state with *Choose folders…*, which opens Edit Home; the All Folders
  row is still present.
- [ ] "+" at Home and at All Folders both create a folder (root rule); "+"
  inside any real folder still creates a note.
- [ ] View / sort / density picked on Home do not leak to All Folders or to
  any folder (verified against the per-folder memory branch once both are on
  main).
- [ ] The hold-menu row never appears for a nested folder or a file.

**Engineering**

- [ ] `pnpm typecheck` and `pnpm test` green; new tests for `home-file.ts`
  (parse / serialize / defaults / compaction), the store (load, set,
  rewrite-on-rename, delete drops entry), `entryMenuItems` (row present for
  root dirs only, label flips), `LibraryBrowser` (Home derivation, All
  Folders push, search-over-root, empty state, hint), and `HomeFolders`
  (list order, toggle writes, failure reverts).
- [ ] No Rust or Swift diff. `home.json` goes through the existing commands.
- [ ] `docs/features/mobile.md` gains a "Home" section and its Key files rows.

**Design (verify every state in the simulator before the build —
`feedback_ios_verify_every_state`)**

- [ ] Home in list and gallery, comfortable and condensed; empty Home; Home
  with hint; All Folders; Edit Home — light and dark — screenshotted from a
  fully seeded library.
- [ ] The All Folders row aligns to the row column exactly like the Inbox
  card (icon slot, text baseline, chevron) — the #684/#889 alignment bugs
  must not recur.
- [ ] Edit Home rows honour Dynamic Type and Bold Text through the a11y
  variables like `FileRow`.

## Out of Scope

- **Drag-to-reorder Home.** The file is a set; order is Inbox first then
  alphabetical. If reordering is wanted, the array order becomes significant
  and the Edit Home screen gains reorder handles.
- **Nested folders on Home.** Relax `isHomeCandidate` and add a path subtitle
  to the row.
- **Mac reads `home.json`.** A "Show on iPhone" checkbox in Settings →
  Project, writing the same file through `write_file`. The format is already
  Mac-friendly (root-relative paths under the iCloud library root, the same
  convention as `pins.json`).
- **Recent on Home.** See Decisions.
- **Deep-link opening the app straight into a Home folder** from the share
  sheet or a widget.
