# PRD: The Notesage library is the app's own iCloud container

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | The phone never asks for a folder again — the library exists on whichever device runs first, and `Inbox/` always has a home |
| **Tasks** | [icloud-container-library-tasks](../tasks/2026-09-05-icloud-container-library-tasks.md) |
| **Precedent** | `docs/prds/2026-06-28-ios-mobile-app.md` (the grant flow this replaces), `docs/prds/2026-08-22-macos-share-extension.md` (why the Mac's signing pipeline matters) |
| **Flag** | `icloud-container-library` (Labs, Phase 2 only — see Rollout) |

## Problem

The owner, verbatim:

> right now, we need to select the Notesage folder on first start so Inbox
> can have a home. What if the Notesage folder doesn't exist?? What if the iOS
> app is the only one or the first one a user installs of the Mac app and iOS
> app? Why can the app not know about the Notesage folder? I mean it is not a
> random folder. We set it from the Mac for synced Notesage managed folders.

The answer already given, which this PRD builds on: an iOS app can touch its
own sandbox, its own iCloud container, and folders a person hands it through
the document picker — nothing else. Today's synced library,
`iCloud Drive/Notesage`, is a plain folder in Apple's generic
`com~apple~CloudDocs` container that the *Mac* created with ordinary file I/O
(`useAppLifecycle.reloadTrees` → `get_icloud_path()` + `"/Notesage"`). To the
phone it is somebody else's folder, indistinguishable from `Recipes/`, so the
phone has to ask. That is the whole reason `Onboarding.tsx`, the
security-scoped bookmark in `LibraryAccess.swift`, and the App Group exist.

Three consequences follow, and the first two are real user-facing failures:

1. **Phone-first users have nothing to pick.** The picker is pre-pointed at a
   folder that does not exist. They must invent one, and nothing tells them
   the Mac will later look for `iCloud Drive/Notesage` specifically.
2. **iOS-only users are second class.** `Inbox/` is only a real thing once a
   folder has been granted; until then share-sheet captures fail with
   "choose your library" (`ShareViewController.swift:369`).
3. **Bookmarks go stale.** A rename or an iCloud hiccup produces the
   "Reconnect your library" screen (`grantState === "stale"`) — a support
   burden for a folder the app itself named.

The arrangement that removes all three: both apps ship the same iCloud
container identifier under the team. The phone owns the folder from first
launch; the Share Extension resolves it the same way; iCloud creates it on
whichever device runs first; and `NSUbiquitousContainerIsDocumentScopePublic`
makes it appear in Files (and in Finder's iCloud Drive) as **Notesage**, so
nothing the user sees changes except that the question goes away.

## Goals / Non-Goals

### Goals

- **No picker on the phone when iCloud is on.** First launch resolves the
  container and shows the library — empty or not — with `Inbox/` ready for
  the Share Extension. Zero taps.
- **Every install order works.** Phone-first, Mac-first, and the
  both-already-installed case (the owner) each end with one library.
- **One migration, once, on the Mac.** Today's `iCloud Drive/Notesage` moves
  into the container without losing a file, a pin, a comment sidecar, or a
  reading position; the phone follows without being asked to re-pick.
- **The Share Extension needs no separate grant.** It resolves the container
  itself; the App Group stays only for the shared defaults it already uses
  (last capture format, library mode).
- **Non-iCloud users keep working** through the picker, which stays as the
  fallback rather than being deleted.

### Non-Goals

- **Choosing where the folder lives.** This is the stated loss. The container
  is where Apple puts it; the picker fallback (below) is for people without
  iCloud, not a "custom location" feature.
- **Moving the local `~/Notesage` library.** It is the *local* library by
  design (`settings.notesRootPath`), holds Recordings and local projects, and
  is what a Mac without iCloud uses. It does not move.
- **Moving non-synced projects.** A project outside `iCloud Drive/Notesage`
  is local by the user's choice (`isProjectSynced` is derived purely from the
  path). Untouched.
- **Live change notification on the phone** (`NSMetadataQuery`). The browser
  re-lists on navigation today; that stays.
- **Sync of `~/.notesage/`** (settings, skills, credentials). Different
  problem, different PRD.
- **CloudKit.** This is iCloud *Documents* — files, `NSFileCoordinator`,
  Finder — exactly what the Mac already relies on. No database, no records.

## What the code does today (research, not guesswork)

| Question | Answer | Where |
| --- | --- | --- |
| How does the Mac decide the synced root? | `get_icloud_path()` returns `~/Library/Mobile Documents/com~apple~CloudDocs` if it exists; the frontend appends `/Notesage` and stores it as `settings.icloudNotesagePath` (non-persisted, recomputed each launch). It is set whenever iCloud Drive exists — there is no on/off switch consulted. | `sync.rs`, `useAppLifecycle.ts:440-448` |
| How does the desktop Inbox find `Inbox/`? | `root = rootOverride ?? icloudNotesagePath ?? resolveNotesRoot(notesRootPath)`; `inboxDir(root)` = `<root>/Inbox`. | `inbox-store.ts:249`, `notes-root.ts` |
| What else keys off the synced root? | Pins file (`<root>/.notesage/pins.json`), per-project "move to iCloud" (`migrate_to_icloud`), startup discovery of projects synced from other machines (`scanICloudForProjects`), runtime discovery in the watcher, the cloud badge, the notes-tree refresh. | `workspace-store.ts:418`, `ProjectSettings.tsx:155`, `scan-icloud-projects.ts`, `useFileWatcher.ts:127`, `useFileTreeItemState.ts`, `useFileOperations.ts:158` |
| How does the phone get the folder? | `UIDocumentPickerViewController` pre-pointed at `com~apple~CloudDocs/Notesage`; a `.minimalBookmark` stored in the App Group defaults under `notesage.library.bookmark`; `resolveRoot()` re-resolves it on every call and refreshes stale bookmarks. | `LibraryAccess.swift` |
| How does the Share Extension get it? | Same `LibraryAccess.swift`, compiled into the extension target; it reads the same bookmark. Every write is `NSFileCoordinator`-coordinated into `<root>/Inbox`. | `LibraryCapture.swift`, `integrate-share-extension.py` |
| What entitlements ship? | iOS app and extension: App Group only. The reference `src-tauri/ios/Notesage.entitlements` already *lists* `iCloud.com.notesage.app` + `CloudDocuments`, but the generated `gen/apple/*.entitlements` (what actually builds) carry only the App Group — `integrate-share-extension.py` writes the App Group through project.yml and nothing else. macOS app: `audio-input` only. macOS Share Extension: sandboxed, its own bookmark, deliberately no App Group because that would need an embedded provisioning profile the release pipeline does not produce. | `gen/apple/notesage_iOS/notesage_iOS.entitlements`, `src-tauri/Entitlements.plist`, `src-tauri/macos/ShareExtension.entitlements` |
| Where does the iOS signing happen? | `scripts/ios-testflight.sh`: Tauri archives, the script stamps versions, `xcodebuild -exportArchive` with automatic signing + an App Store Connect API key, then verifies version/authority on the `.ipa` and refuses to upload on mismatch. | `scripts/ios-testflight.sh:305-380` |
| Does the Mac read third-party containers without an entitlement? | This Mac already has `~/Library/Mobile Documents/<team>~<bundle>` folders for WhatsApp, SoundHound, etc. — plain directories on disk. The owner's live library is `com~apple~CloudDocs/Notesage`: 19 top-level entries, **4.7 MB**. `iCloud~com~notesage~app` does not exist yet (no entitled build has run). | `ls ~/Library/Mobile Documents/` |
| Is the download state already handled? | Yes: `.icloud` placeholders are unwrapped in listings, `ensureDownloaded` reads `ubiquitousItemDownloadingStatus` and calls `startDownloadingUbiquitousItem`; the Reader awaits it before reading. Unchanged by this PRD. | `LibraryAccess.swift`, `Reader.tsx:1273` |

## Decisions

Recorded so the implementation does not re-litigate them. Each is
reversible only by editing this section.

1. **Container id `iCloud.com.notesage.app`; the library root is its
   `Documents/` folder.** The identifier is the one already in the reference
   entitlements. `Documents/` is what `NSUbiquitousContainerIsDocumentScopePublic`
   exposes; anything outside it is invisible to Files, which is what we want
   for nothing — everything lives under `Documents/`. On the Mac the path is
   deterministic: `~/Library/Mobile Documents/iCloud~com~notesage~app/Documents`.
2. **The phone owns the container; the Mac follows.** The phone's app is the
   only build guaranteed to be entitled from Phase 1, so it is the thing that
   creates the container on the account. The Mac reads and writes the
   deterministic path with the same plain file I/O it uses for
   `com~apple~CloudDocs/Notesage` today — no entitlement needed for that
   (Phase 2). The entitlement on the Mac is Phase 3 and exists for one case:
   Mac-first users, whose account has no container until an entitled app
   touches it.
3. **A marker file makes the library self-describing:
   `<root>/.notesage/library.json`.** Written by whichever device creates the
   root, extended by the migration. The Mac's root-resolution rule reads it, so
   a second Mac (or a phone with a bookmark) follows a migration performed
   elsewhere without a flag, a setting, or a prompt. Precedent: the pins file
   and `reading-progress.json` already live in `.notesage/` beside the data
   they describe.
4. **Library mode on the phone: `container` or `picked`, stored in the App
   Group defaults** (`notesage.library.mode`) beside the bookmark, so the app
   and the Share Extension resolve the same root. Mode is *reconciled* on every
   resolve, not just at onboarding, so the extension follows a switch the app
   made and vice versa.
5. **Precedence on the phone: an existing bookmark keeps working until the
   Mac migrates.** An upgraded install with a bookmark stays in `picked` mode;
   it flips to `container` the moment the marker says a migration happened
   (`migratedFrom` present) or its bookmark stops resolving while the container
   has a marker. New installs with iCloud go straight to `container`. This is
   what makes Phase 1 safe to ship to the owner's phone: nothing changes for a
   bookmarked device until the Mac says so.
6. **The Mac migrates only behind the Labs flag, but *follows* a migration
   unconditionally.** Following is read-only and prevents the dangerous case
   (a second Mac with the flag off watching its projects vanish from
   `com~apple~CloudDocs/Notesage`). Migrating moves the owner's live library,
   so it is opt-in until Phase 4.
7. **Migration is a per-entry same-volume `rename(2)`, resumable, with an
   explicit collision policy** (below). Both roots sit under
   `~/Library/Mobile Documents` on one APFS volume, so each top-level entry
   moves atomically; the existing copy→verify→delete fallback
   (`sync.rs::migrate_directory`) covers the cross-volume case that should
   never occur. Between entries the state is legal: both roots are scanned
   until the old one is empty.
8. **The picker stays, as a fallback and as a choice.** Shown when
   `url(forUbiquityContainerIdentifier:)` returns nil (no iCloud account,
   iCloud Drive off for Notesage, App Store reviewer's device) and offered in
   the library's settings as "Use a different folder…" for anyone who wants the
   old folder or a folder another app manages. Deleting it would strand
   non-iCloud users and the review process for no gain.
9. **`~/Notesage` and non-synced projects do not move.** See Non-Goals; the
   container replaces exactly one thing — the meaning of
   `settings.icloudNotesagePath`.
10. **No new Zustand store.** `icloudNotesagePath` keeps its name and every
    consumer; only its *value* changes (container root vs CloudDocs root), plus
    a non-persisted `libraryRootKind` for the Settings UI. Renaming the setting
    would touch a dozen files for no behavioural gain.
11. **Version bump when the container's visibility keys change.** Apple
    latches `NSUbiquitousContainers` at first use; the keys only take effect
    with a higher `CFBundleVersion`. The TestFlight script already stamps a
    fresh build number every run, which is sufficient — noted so nobody debugs
    an "invisible in Files" container for an afternoon.
12. **`sync-settings.json` is not extended.** `read_sync_settings` has no
    frontend caller today (only the `tauri.ts` wrapper); the sync state is
    derived from paths (`isProjectSynced`). The marker file carries what the
    migration needs. Deleting the dead command is a separate cleanup.

## User Stories

- As someone who installs Notesage on an iPhone first, I want the app to open
  on an empty library with a working share sheet, so that I start capturing
  without being asked to find or create a folder.
- As someone who has used the Mac app for a year, I want the phone to show my
  library the first time it launches, so that "sync" means what it says.
- As the owner with both apps installed, I want the Mac to move my library into
  the container once, tell me what it moved, and have the phone follow without
  a re-grant, so that the switch is one confirmation and not an afternoon.
- As someone without an iCloud account, I want to pick a folder and keep using
  the app exactly as today, so that the new default is not a new requirement.
- As someone sharing from Safari on the phone, I want the capture to land in
  `Inbox/` even if I have never opened the Notesage app, so that capture is
  the zero-setup path it was meant to be.
- As a Mac-first user, I want the container created from the Mac, so that the
  phone I install next week finds the library.

## Technical Approach

### Ubiquity APIs, and where each one goes

| API | Used by | Notes |
| --- | --- | --- |
| `FileManager.url(forUbiquityContainerIdentifier: "iCloud.com.notesage.app")` | iOS app, iOS Share Extension, (Phase 3) Mac via objc2 | First call per process can block for seconds — it initialises the container locally — so it runs on a background queue and the result is cached per process. `nil` ⇒ iCloud unavailable for this app ⇒ fallback picker. The root is `<url>/Documents`, created with `createDirectory(withIntermediateDirectories:)`. |
| `startAccessingSecurityScopedResource()` | already in every `LibraryAccess` method | Returns `false` for a non-scoped URL and the code already guards on the return value, so the container path needs no changes there. Only `picked` mode has a scope. |
| `NSFileCoordinator` | unchanged | Every read and write is already coordinated. That is the contract for a folder several devices write to; it stays for both modes. |
| `ubiquitousItemDownloadingStatus`, `startDownloadingUbiquitousItem`, `.icloud` placeholders | unchanged | Already handled (`ensureDownloaded`, `children(of:)`). |
| `NSUbiquitousContainers` (Info.plist) | iOS app | `NSUbiquitousContainerIsDocumentScopePublic: true`, `NSUbiquitousContainerName: Notesage`, `NSUbiquitousContainerSupportedFolderLevels: Any`. Written through `integrate-share-extension.py` (the file that already injects `LSSupportsOpeningDocumentsInPlace` into the generated project), never by hand in `gen/`. |
| `NSMetadataQuery` | — | Out of scope (Non-Goals). |

### The phone (`LibraryAccess.swift`, plugin, Rust commands, mobile store)

`LibraryAccess.resolveRoot()` becomes mode-driven:

```
reconcile()                                // runs at the top of every resolveRoot()
  mode = defaults["notesage.library.mode"]  // "container" | "picked" | nil
  container = containerRoot()               // cached; nil when iCloud unavailable
  if mode == nil:
      mode = bookmark exists ? "picked" : (container != nil ? "container" : nil)
  if mode == "picked", container != nil, marker(container).migratedFrom != nil:
      mode = "container"; clear bookmark    // the Mac moved the library (Decision 5)
  if mode == "picked", bookmark does not resolve, container != nil, marker(container) exists:
      mode = "container"; clear bookmark    // same, observed from the other side
  persist mode

resolveRoot()
  "container" → containerRoot() ?? throw .iCloudUnavailable
  "picked"    → resolve bookmark (today's code) ?? throw .staleBookmark
  nil         → throw .noGrant
```

`containerRoot()` ensures `Documents/` exists and, on first creation, writes
the marker `{ version: 1, kind: "container", createdBy: "ios", createdAt }`.
It never touches a marker that already exists.

The grant surface grows rather than changes shape:

```ts
export interface IosLibraryGrant {
  displayName: string;
  granted: boolean;
  /** How the root was resolved. Absent when not granted. */
  kind?: "container" | "picked";
  /** Whether the container could be resolved at all (drives the fallback copy). */
  icloudAvailable: boolean;
}
```

New commands (all iOS-only, non-iOS stubs return the platform error like the
rest of `ios_library.rs`):

- `ios_setup_library() -> LibraryGrant` — run `reconcile()` off-main, return the
  grant. Called by `mobile-store.refreshGrant` at mount. Replaces the
  "ungranted → show picker" reflex with "ungranted *and* iCloud unavailable →
  show picker".
- `ios_set_library_mode(mode: "container" | "picked")` — the settings action.
  Switching to `container` keeps the bookmark (so "switch back" is possible)
  but stops using it.
- `ios_pick_library_folder` — unchanged, but persisting a bookmark now also
  sets mode `picked`.

`mobile-store.grantState` gains `"provisioning"` (container being resolved —
a spinner, first launch only) and `"icloud-unavailable"` (the onboarding
variant that offers the picker). `MobileApp.tsx` routes on it.

**Share Extension.** It already compiles the same `LibraryAccess.swift`, so it
inherits `reconcile()` and container resolution for free. Two changes: the
resolve runs on a background queue before the sheet's first layout (the
container call can block), and `noGrant`/`iCloudUnavailable` get their own
copy: "Open Notesage once to set up your library" rather than "choose your
library". The extension gains the iCloud entitlements (Decision 1 needs both
targets entitled; App Group alone is not enough for `url(forUbiquity…)`).

### The Mac — Phase 2, follow and migrate

**Root resolution** (`reloadTrees`, replacing the two lines that append
`/Notesage`):

```
containerRoot = get_library_container_path()        // exists-check on the deterministic path; None when absent
cloudDocsRoot = get_icloud_path() + "/Notesage"     // today's value
marker        = read_library_marker(containerRoot)  // None when absent

icloudNotesagePath =
  if marker?.migratedFrom            → containerRoot        // a migration happened somewhere: follow it
  elif marker && cloudDocsRootIsAbsentOrEmpty → containerRoot   // phone-first user, Mac joined later
  elif cloudDocsRoot exists          → cloudDocsRoot        // today's behaviour, untouched
  elif containerRoot exists          → containerRoot
  else                               → null
libraryRootKind = "container" | "clouddocs" | null   // non-persisted, Settings UI only
```

Every consumer of `icloudNotesagePath` (Inbox, pins, per-project sync
targets, discovery scan, watcher, cloud badge, tree refresh) picks the new
root up without modification because they read the setting. The asset-scope
grant (`allow_asset_dir`) for the new root happens where it happens today
(`inbox-store.load`).

**Migration** is offered when *all* hold: the Labs flag is on, `containerRoot`
exists (iCloud created it because the phone has run), `cloudDocsRoot` has
content, and the marker has no `migratedFrom`. It is orchestrated from TS
(`src/lib/library-migration.ts`, pure core + a thin runner) over one new Rust
primitive, `migrate_library_entry(src, dst)`: refuse if `dst` exists;
`rename(2)`; on `EXDEV` fall back to `migrate_directory`'s copy→verify→delete.
Listing, deduping and JSON merging stay in TS where the existing merge logic
lives (`reading-progress-file.ts`, `pins-file.ts`).

What moves: every top-level entry of `cloudDocsRoot`, dot-entries included
(`.notesage/pins.json`, `.notesage/sync-settings.json`, `Inbox/`, loose Quick
Notes, every project folder, `templates/` if present). `.DS_Store` is skipped.

Collision policy when the destination already has the entry (phone-first
users who captured before the Mac arrived; a resumed run):

| Entry | Rule |
| --- | --- |
| `Inbox/` | Merge file by file. Same name → the phone's dedupe rule (`name-1.ext`). `Inbox/.notesage/reading-progress.json` → the existing merge (monotonic progress, tombstones win by time). |
| `.notesage/pins.json` | Union of relative paths. |
| `.notesage/sync-settings.json` | Dropped (Decision 12). |
| `.notesage/library.json` | Destination's kept; `migratedFrom`, `migratedAt`, `migratedBy` added at the end. |
| Top-level folder, same name, destination has no `.notesage/` (a folder the phone made) and source has one (a project) | Merge source *into* destination file by file with dedupe; the project's `.notesage/` moves over. |
| Top-level folder, same name, both have `.notesage/` | Keep destination; move source as `<name> (from iCloud Drive)`; list it in the report. Never merge two projects' metadata. |
| Loose file, same name | Dedupe (`name-1.ext`). |

After the entries: rewrite paths in one pass — `workspace-store.updateProjectPath`
for each moved project, `updateFilePaths` for pins, editor recents and the
open document (`renameOpenDocument`), and the path-keyed comment sidecars for
non-project files through the helper `useFileRenameSync` already uses. Then
`icloudNotesagePath` ← `containerRoot`, the watchers restart on the new root
(`useStartWatchers` keys on the setting), and `cloudDocsRoot` is removed
*only if empty*. Anything left behind is listed in the report, with the
folder left where it is.

**iCloud cost of the move.** A rename across two containers is a delete in
one and a create in the other as far as `bird` is concerned: the library is
re-uploaded and every other device re-downloads it. The owner's library is
4.7 MB. The confirmation dialog states the size so a user with gigabytes of
PDFs in `Inbox/` can choose the moment.

**Other Macs on the account** see `com~apple~CloudDocs/Notesage` empty out
and the container appear. Their next launch hits the `migratedFrom` branch
and switches roots with *no* local migration — their local copy was moved by
iCloud. That is why following is unconditional (Decision 6).

**macOS Share Extension.** Holds its own bookmark. `defaultLibraryGuess()`
gains the container `Documents/` as its first candidate; a bookmark that
resolves to a folder that no longer exists reports "not granted", which
already routes to the picker. Nothing else changes; the extension writes
into whatever folder it is granted.

### The Mac — Phase 3, entitlement (Mac-first users)

An account with no container has no folder for the Mac to find. Creating one
requires an entitled process to call `URLForUbiquityContainerIdentifier:` on
this account. For a Developer ID app that means: the iCloud entitlements in
`Entitlements.plist`, an App ID with the iCloud capability and the container
assigned, and — the part the macOS Share Extension PRD already ran into — a
**Developer ID provisioning profile embedded as
`Contents/embedded.provisionprofile`**, which `tauri-bundler` does not produce
today. `bundle.macOS.files` in `tauri.conf.json` is the likely vehicle;
`scripts/macos-release-embed.sh` re-signs the bundle and must keep the
profile and the entitlements through that step. A spike (tasks #21) settles it
before anything depends on it. The Rust side calls the API through `objc2`
off the main thread and *feature-detects* the entitlement at runtime
(`SecTaskCopyValueForEntitlement`) so an unentitled local build keeps the
exists-check behaviour instead of crashing into a nil.

### First-run matrix

| Situation | Phone | Mac |
| --- | --- | --- |
| **Phone first**, iCloud on | Container resolved, `Documents/` + marker created, library shown empty, `Inbox/` ready. Files shows "Notesage" under iCloud Drive. | (Phase 2) Later install finds the container with a marker and no CloudDocs library → uses the container. (Phase 3 not needed.) |
| **Phone first**, no iCloud | `icloud-unavailable` onboarding: picker, mode `picked`. | Unaffected. |
| **Mac first**, iCloud on | Later install resolves the container the Mac created. | Phase 3: entitled app creates the container, library defaults to it; `com~apple~CloudDocs/Notesage` is no longer created for new installs. Until Phase 3 ships: today's behaviour (CloudDocs root), and the phone still needs the picker — stated in the Rollout table, not hidden. |
| **Both exist** (the owner) | Bookmark keeps working. After the Mac migrates, `reconcile()` sees `migratedFrom` → container mode, bookmark cleared, no screen shown. | Flag on → migration offered → confirm → report. Flag off → nothing changes. |
| **Second Mac**, any flag state | — | Follows via the marker; no local migration. |
| **Bookmarked phone, Mac never migrates** | Keeps the bookmark indefinitely. Settings offers "Switch to Notesage in iCloud" (manual mode switch; the container is empty until the Mac moves things). | — |
| **App Store reviewer** (no iCloud on device) | Picker fallback; any folder works. | — |

## UI/UX

**Phone, first launch with iCloud.** No onboarding screen. `MobileApp`
shows the library browser; for the seconds the container takes to initialise
the `provisioning` state renders a centred spinner and "Setting up your
Notesage library in iCloud…" (design-system muted foreground, no
progress bar — there is no progress to report). Nothing to tap.

**Phone, first launch without iCloud.** The existing `Onboarding` layout with
different copy: title "iCloud isn't available", one sentence explaining that
Notesage keeps its library in iCloud Drive and that it can use a folder of
their choosing instead, the two feature rows retained, primary button
"Choose a folder". A secondary text button "How to turn on iCloud Drive"
opens Settings via `UIApplication.openSettingsURLString`. Stale-bookmark
copy (`titleStale`) stays for `picked` mode.

**Phone, library settings.** The folder root's top-right native menu (the
`LibraryBrowser` island where "re-pick" lives today) gains a "Library" row:
"Notesage in iCloud" or "<folder name> (chosen folder)", with the actions
"Use a different folder…" (picker → `picked`) and, when in `picked` mode and
iCloud is available, "Switch to Notesage in iCloud". Switching shows the
container's contents immediately; it does not move anything — the copy says
so.

**Share Extension.** Unchanged when a root resolves. When none does:
"Open Notesage once to set up your library" (iCloud on, container not yet
initialised — rare) or the existing "choose your library" (no iCloud, no
folder picked).

**Mac, Settings → Projects → Library group** (new `SettingsGroup`, above
per-project cards): a `SettingsRow` "Synced library" showing the current root
with a pill — "Notesage in iCloud" or "iCloud Drive/Notesage" — and, when
migration is eligible, a primary button "Move library into Notesage in
iCloud". The confirmation `Dialog` (shadcn) lists the plan: N projects,
`Inbox/` with N items, N loose notes, total size, "iCloud will re-upload
this", and any name collisions with the rule that will apply. Progress uses
`Progress` per entry (entries, not bytes — a rename is instant). The report
is a `Dialog` with the moved counts and, if any, "left in iCloud
Drive/Notesage" with a "Reveal in Finder" action. A sonner toast on startup
("Your library can move into Notesage in iCloud" · action "Review") appears
once per eligible launch while the flag is on; it never migrates on its own.

**Mac, sidebar.** No change. The cloud badge and project rows key off the
resolved root.

## Data Model

```ts
// src/lib/library-marker.ts — parsed/serialized in TS; mirrored in Rust for the Mac's read path
export interface LibraryMarker {
  version: 1;
  kind: "container";
  createdBy: "ios" | "macos";
  createdAt: string;            // ISO 8601
  migratedFrom?: "com~apple~CloudDocs/Notesage";
  migratedAt?: string;
  migratedBy?: string;          // device name, informational
}
// path: <library root>/.notesage/library.json
```

```rust
// src-tauri/src/commands/sync.rs (extended)
#[tauri::command] pub async fn get_library_container_path() -> Result<Option<String>, String>;
//   Phase 2: Some(~/Library/Mobile Documents/iCloud~com~notesage~app/Documents) iff it exists.
//   Phase 3: `create: bool` — when entitled, initialise the container and return it.
#[tauri::command] pub async fn read_library_marker(root: String) -> Result<Option<LibraryMarker>, String>;
#[tauri::command] pub async fn migrate_library_entry(src: String, dst: String) -> Result<String, String>;
//   Refuses if dst exists. rename(2); EXDEV → migrate_directory (copy → verify → delete).
```

```rust
// src-tauri/src/commands/ios_library.rs (extended)
pub struct LibraryGrant { display_name, granted, kind: Option<LibraryKind>, icloud_available: bool }
#[tauri::command] pub async fn ios_setup_library(app) -> Result<LibraryGrant, String>;
#[tauri::command] pub async fn ios_set_library_mode(app, mode: LibraryKind) -> Result<LibraryGrant, String>;
```

`settings-store`: `libraryRootKind: "container" | "clouddocs" | null`
(non-persisted, stripped in `partialize` like `icloudNotesagePath`).
`mobile-store.grantState`: `+ "provisioning" | "icloud-unavailable"`.
`FLAGS`: `"icloud-container-library": { stage: "experimental", summary: "Keep the synced library in Notesage's own iCloud folder", introducedIn: "0.57.0", default: false }`.

App Group defaults keys (both iOS targets): `notesage.library.mode` beside the
existing `notesage.library.bookmark`.

## Dependencies

- **Apple Developer account (paid, settled):** the iCloud capability on both
  iOS App IDs with container `iCloud.com.notesage.app` assigned; for Phase 3,
  the same on the macOS App ID plus a Developer ID provisioning profile.
  Account-side steps are documented in `docs/ios-testflight.md` in the same
  style as the App Group section.
- **Signing pipeline:** `scripts/ios-testflight.sh` (automatic signing
  already picks up new capabilities once the App ID has them); `release.yml`
  and `scripts/macos-release-embed.sh` for Phase 3.
- **Existing merges reused, not rewritten:** `reading-progress-file.ts`,
  `pins-file.ts`, `useFileRenameSync`'s sidecar migration,
  `sync.rs::migrate_directory`.
- **Labs flag registry** (`src/lib/flags.ts`, PRD 2026-08-15) for the
  Phase 2 gate.
- No new crates on the desktop for Phase 2. Phase 3 adds `objc2-foundation`
  bindings for `NSFileManager` (already a transitive dependency of Tauri on
  macOS) and `security-framework` or a direct `SecTaskCopyValueForEntitlement`
  FFI for the entitlement probe.

## Risks

| Risk | Why it is real | Mitigation |
| --- | --- | --- |
| **The owner's live library is the first thing migrated.** | There is no staging library; the 4.7 MB in `iCloud Drive/Notesage` is the one with a year of notes. | Task #20 is the dogfood run with a pre-flight copy to `~/Notesage-backup-<date>`; per-entry atomic renames; nothing is deleted until the old root is empty; the report lists leftovers. The flag keeps every other Mac on today's path. |
| **Unentitled Mac access to the container is an assumption until measured.** | Finder and third-party editors do edit `~/Library/Mobile Documents/<container>` folders, and this Mac has such folders — but "a write from an unentitled process syncs" and "mkdir of an unknown container id does *not* sync" are claims. | Task #1 tests both with one command each before any Mac work starts (feedback rule: test the limit before asserting it). If the first claim fails, Phase 2 collapses into Phase 3 and the plan re-orders; the phone side is unaffected. |
| **A user without iCloud, or a reviewer's device.** | The container is nil; the app must not dead-end. | The picker fallback is a first-class path, tested in the device matrix (#8) on a simulator with no account. |
| **App Store review.** | A new entitlement is visible to review; a mismatch between capability, entitlement and profile produces a build that installs and then cannot see its library — the same failure shape `docs/ios-testflight.md` warns about for the App Group. | `ios-testflight.sh` reads the entitlements back from the exported `.ipa` for both bundles and refuses to upload without the container id (#10). App Privacy answers stay "Data Not Collected": the container is Apple's, between the user's devices — copy updated (#9). |
| **Container invisible in Files.** | `NSUbiquitousContainers` is latched at first use; a later edit needs a higher build number. | Decision 11; the script stamps a new build every run. Verified in #8. |
| **First `url(forUbiquityContainerIdentifier:)` blocks.** | Documented behaviour; on the main thread it would freeze the WebView or the share sheet. | Background queue + per-process cache in `LibraryAccess`; the `provisioning` state on the phone; the extension resolves before first layout. |
| **A phone still in `picked` mode captures into the old folder while the Mac migrates.** | Two roots exist for a few minutes. | The old folder is scanned until empty; the migration's final pass merges anything that arrived; the phone's next `reconcile()` flips it. A capture made in that window is moved, not lost. |
| **Re-upload volume.** | Cross-container move = delete + create for iCloud. | Size shown in the confirmation; the user picks the moment. |
| **Two Macs, one with the flag on and one off, both open.** | Only the flagged one migrates; the other follows the marker at its next launch — mid-session it is watching a folder that empties. | Following is read-only and the watcher already tolerates a root that goes away (paths pruned on tree validation); the marker check also runs when the watcher sees `library.json` appear under the container root. Acceptable for an opt-in phase; Phase 4 removes the asymmetry. |
| **Phase 3 provisioning profile turns out to be incompatible with `tauri-action`.** | The macOS Share Extension PRD hit the same seam. | Spike #21 gates the phase; the fallback is "Mac-first users install the phone app first", which the onboarding copy would say plainly rather than pretend. |

## Rollout

Phased, phone first. The argument for that order: the phone is the only
build that must be entitled for the design to work at all, it is what creates
the container on the account, and it can ship without touching any existing
user's data (Decision 5). The Mac's flag is not about hiding the feature; it
is about who runs a migration of the live library and when.

| Phase | Ships | Gate | Who is affected |
| --- | --- | --- | --- |
| **0 — Spike** | Findings in the tasks file. | Both Mac claims measured; Files visibility confirmed. | Nobody. |
| **1 — Phone owns the container** | Entitlements, `LibraryAccess` modes, marker, new commands, onboarding, extension, TestFlight verification, docs. | Device matrix (#8) green; TestFlight build cut from `main`. | New phone installs get the container. Bookmarked phones: no change. Mac: no change. |
| **2 — Mac follows and migrates (Labs)** | Root resolution with the marker, migration primitives + orchestrator + UI, flag, macOS extension guess, docs. | Owner's dogfood migration (#20) done and the phone followed. | Everyone's Mac *follows* a migration; only flagged Macs *perform* one. |
| **3 — Mac entitlement (Mac-first)** | Provisioning profile in the bundle, entitled container creation, release pipeline checks. | Spike #21 proves a notarised, entitled build; a fresh Mac creates the container and a phone finds it. | New Mac installs default to the container. |
| **4 — Graduate** | Flag removed; migration offered to every eligible Mac; CloudDocs root becomes legacy; store copy final. | Telemetry shows the flag stable per the Labs graduation rule. | Everyone. |

Phases 1 and 2 can be in flight together; 3 depends only on 0; 4 depends on
all of them.

## Quality Gates

Outcome-shaped: each is a scenario run on a device or a Mac, not a file that
exists. Unit tests back the pure parts (marker, migration plan, collision
policy, root resolution) and are listed per task.

### Phase 1 — phone

- [ ] Fresh install on an iPhone signed in to iCloud: the app opens on an empty library with no onboarding screen; the Files app shows **Notesage** under iCloud Drive containing an empty `Inbox` after the first share.
- [ ] Same device, never having opened the app after install: share a page from Safari → the capture lands in `Inbox/` and the app shows it on first open.
- [ ] Fresh install on a simulator with no iCloud account: the onboarding offers "Choose a folder"; picking one leads to the library; sharing works into that folder.
- [ ] Upgrade a device that has a bookmark: nothing changes — same library, no screen, extension keeps writing to the bookmarked folder.
- [ ] On that device, "Switch to Notesage in iCloud" shows the (empty) container; "Use a different folder…" returns to the picker; both survive a relaunch and both are honoured by the extension without relaunching the app.
- [ ] Delete a note in the container from the phone → it is in Files' Recently Deleted.
- [ ] `scripts/ios-testflight.sh` refuses to upload an `.ipa` whose app or extension lacks `iCloud.com.notesage.app` in its entitlements.
- [ ] `pnpm test` and `pnpm typecheck` green; `mobile-store.test.ts` covers the new states and the reconcile transitions (driven through the mocked commands).

### Phase 2 — Mac

- [ ] Flag off, container present with a phone-created marker, `iCloud Drive/Notesage` populated: the Mac keeps using `iCloud Drive/Notesage`; no prompt.
- [ ] Flag on, same state: the startup toast appears; Settings → Projects shows "Move library into Notesage in iCloud" with a plan that names every project, the Inbox count, loose notes and the size.
- [ ] Confirm: every project reopens from its new path with its pins, recents, and the open document intact; the Inbox list shows the same items with the same read/unread and progress; comment popovers on a non-project note still find their comments; `iCloud Drive/Notesage` is gone (or listed as left behind with the reason).
- [ ] Within one iCloud sync interval the phone — still bookmarked — shows the same library with no re-grant screen, and a share from the phone lands in the Mac's Inbox.
- [ ] A second Mac on the account, flag off, relaunched after the migration: its projects are back under the container path with no prompt and no data movement of its own.
- [ ] Phone-first user's Mac (container with marker, no CloudDocs library, flag off): startup uses the container; a new project from `⌘⇧N` lands under it; the phone sees it.
- [ ] Collision cases pass their unit tests: Inbox merge with dedupe and progress merge; pins union; same-name folder rules; a resumed run after an interrupted one converges to the same end state.
- [ ] Interrupt the migration mid-way (kill the app): relaunch shows both roots' content and offers to finish; finishing produces the same result as an uninterrupted run.
- [ ] `pnpm test`, `pnpm typecheck`, `cargo test` green; the `reloadTrees` regression-lock test extended for the four root-resolution branches.

### Phase 3 — Mac entitlement

- [ ] A notarised release build passes Gatekeeper on a clean Mac, carries the iCloud entitlements (`codesign -d --entitlements :-`), and creates `iCloud~com~notesage~app/Documents` on an account that never ran the phone app; a phone installed afterwards finds the library.
- [ ] An unentitled local dev build still runs, using the exists-check path, with no nil crash.
- [ ] `release.yml` fails the job if the entitlements are missing from the signed bundle.

### Design

- [ ] Every new surface uses shadcn primitives (`Dialog`, `Progress`, `SettingsRow`/`SettingsGroup`), the neutral palette, and reads correctly in light and dark on both platforms; the phone copy exists in `en` and `sv`.

## Out of Scope

- `NSMetadataQuery`-driven live refresh on the phone.
- Removing the App Group (still needed for the shared defaults).
- Deleting `read_sync_settings` / `SyncSettings` / `sync-settings.json` — dead
  code today, separate cleanup.
- Moving `~/Notesage` (local library) or `~/.notesage` (settings) anywhere.
- A "custom library location" feature on either platform beyond the picker
  fallback.
- iCloud storage-quota handling beyond surfacing the OS error on write.
- Android or any non-Apple sync.
