# Tasks: The Notesage library is the app's own iCloud container

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Not started |
| **PRD** | [icloud-container-library](../prds/2026-09-05-icloud-container-library.md) |
| **Total** | 25 tasks: 5S, 16M, 4L |
| **Suggested order** | Spike (#1) → Phone (#2–#10) → Mac follows + migrates behind the flag (#11–#20) → Mac entitlement (#21–#24) → Graduate (#25) |

Legend: ✅ done · 🚧 in progress · (blank) pending.

Categories beyond the usual `backend` / `frontend` / `both`: `native` (Swift
in the plugin package or the extensions), `build` (signing, scripts, CI),
`docs`, `qa` (device runs whose findings are recorded here).

## Risks and open questions carried from the PRD

- **#1 is a gate, not a formality.** If an unentitled Mac write into an
  existing container does *not* sync, Phase 2 has no read/write path without
  the Phase 3 entitlement, and #11–#17 are re-ordered behind #21–#22. Do not
  start #11 until #1 has an answer in this file.
- **The first migrated library is the owner's** (4.7 MB, 19 top-level
  entries). #20 is the run, with a copy taken first. Nothing in #14–#16 may
  delete a source entry before its destination exists.
- **`gen/apple/` is gitignored and regenerated** by `tauri ios init`. Every
  iOS project change goes through `integrate-share-extension.py` or the
  tracked reference files, never a hand edit in `gen/` (the App Group learned
  this the hard way — see the script's comment at line 194).
- **Blast radius:** #12 changes what `settings.icloudNotesagePath` means for
  every consumer (Inbox, pins, sync targets, discovery, watcher, badge). It
  ships with #17's regression test or not at all.

---

## Phase 0 — Spike

### #1 — Measure the container facts on real devices

Answer, with one command or one screenshot each, the claims the plan rests
on. Record the findings under this heading (the way
`2026-08-22-macos-share-extension.md` records its Phase 0) before any
dependent task starts.

1. On a dev-signed iOS build with the iCloud entitlements from #2's reference
   files: `FileManager.default.url(forUbiquityContainerIdentifier:
   "iCloud.com.notesage.app")` is non-nil; `Documents/` created; the Files app
   shows **Notesage** under iCloud Drive (needs `NSUbiquitousContainers` in
   Info.plist — use a throwaway build number).
2. On the Mac signed in to the same account:
   `ls ~/Library/Mobile\ Documents/iCloud~com~notesage~app/Documents` exists
   after (1); `touch …/Documents/from-mac.md` appears on the phone within a
   sync interval. This is the unentitled-write claim Phase 2 depends on.
3. `mkdir -p ~/Library/Mobile\ Documents/iCloud~com~example~unknown/Documents`
   + a file: confirm it does **not** appear on the phone (the Mac-first case
   needs #21–#22).
4. Delete a file from the phone inside the container → Files → Recently
   Deleted lists it.
5. The Share Extension target, entitled the same way, resolves the container
   (`url(forUbiquityContainerIdentifier:)` from the extension process) — and
   note whether it returns nil before the app has ever launched.
6. Time the first `url(forUbiquityContainerIdentifier:)` call on a fresh
   install (justifies the `provisioning` state and the off-main rule).

- **Complexity:** M · **Category:** qa · **Depends on:** — · **Files:** this
  file (findings); throwaway edits to `src-tauri/ios/Notesage.entitlements`,
  `src-tauri/ios/ShareExtension.entitlements` (kept only if #2 confirms them)

## Phase 1 — The phone owns the container

### #2 ✅ — Entitle both iOS targets and declare the container

Account side (documented, in `docs/ios-testflight.md`, as a new numbered
section beside "Create the App Group FIRST"): enable the **iCloud**
capability with **iCloud Documents** on both App IDs (`com.notesage.app`,
`com.notesage.app.ShareExtension`), create container `iCloud.com.notesage.app`,
assign it to both. Build side: `integrate-share-extension.py` writes, through
`project.yml` `entitlements.properties` for **both** targets (the same seam
that carries the App Group),
`com.apple.developer.icloud-container-identifiers`,
`com.apple.developer.icloud-services: [CloudDocuments]`,
`com.apple.developer.ubiquity-container-identifiers`; and through the app
target's `info.properties` (the seam that carries
`LSSupportsOpeningDocumentsInPlace`) the `NSUbiquitousContainers` dict:
`NSUbiquitousContainerIsDocumentScopePublic: true`,
`NSUbiquitousContainerName: Notesage`,
`NSUbiquitousContainerSupportedFolderLevels: Any`. Extend the script's
end-of-run assertion to check the container id landed in both generated
entitlements files. Update the two tracked reference entitlements files so
they mirror what ships (the extension one currently says "no iCloud
capability required" — that comment is now wrong and must go).

- **Complexity:** M · **Category:** build · **Depends on:** #1 · **Files:**
  `src-tauri/ios/integrate-share-extension.py`,
  `src-tauri/ios/Notesage.entitlements`,
  `src-tauri/ios/ShareExtension.entitlements`, `docs/ios-testflight.md`

### #3 ✅ — `LibraryAccess`: container root, library mode, reconcile

Implement the PRD's `reconcile()` / `resolveRoot()` pseudo-code in
`LibraryAccess.swift`: `containerRoot()` (background-queue resolution, cached
per process, creates `Documents/`, writes the marker from #4 on first
creation), `libraryMode` stored in the App Group defaults under
`notesage.library.mode`, `reconcile()` run at the top of every `resolveRoot()`,
the two `picked → container` flips (marker with `migratedFrom`; bookmark no
longer resolving while a marked container exists), and the new error case
`iCloudUnavailable`. `persistBookmark` sets mode `picked`. `getLibraryGrant()`
returns `kind` and `icloudAvailable`. Every existing read/write method keeps
working in both modes — the `scoped` guard already tolerates a non-scoped
URL; verify by reading the code, not by assuming. Add a `setLibraryMode(_:)`
that keeps the bookmark when switching to `container` (so "switch back" is
possible) and a `clearLibraryGrant()` that clears both mode and bookmark.

- **Complexity:** L · **Category:** native · **Depends on:** #1, #4 ·
  **Files:**
  `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/LibraryAccess.swift`

### #4 ✅ — The library marker file, shared format

`.notesage/library.json` at the library root, shape per the PRD's Data Model.
TS: `src/lib/library-marker.ts` — `parseLibraryMarker(text)` (tolerant of
unknown fields, rejects wrong `version`/`kind`), `serializeLibraryMarker`,
`markMigrated(marker, { from, by, at })`. Rust: `src-tauri/src/library_marker.rs`
with the same struct (`serde`, `#[serde(rename_all = "camelCase")]`) and a
`read_marker(root) -> Option<LibraryMarker>` used by #11. Swift: the minimal
writer (`createdBy: "ios"`) and a reader that only needs `migratedFrom`
presence, in `LibraryAccess`. Tests: TS round-trip + rejection cases; Rust
round-trip against a fixture written by the TS serializer (the two must
agree byte-for-byte on a canonical example).

- **Complexity:** M · **Category:** both · **Depends on:** — · **Files:**
  `src/lib/library-marker.ts`, `src/lib/__tests__/library-marker.test.ts`,
  `src-tauri/src/library_marker.rs`, `src-tauri/src/lib.rs` (mod),
  `tests/fixtures/library-marker.json`

### #5 ✅ — Plugin methods, Rust commands, `ios-api.ts`

Plugin (Swift `@objc` + Rust wrapper): `setupLibrary` → runs `reconcile()`
off-main, resolves the grant; `setLibraryMode(mode)`; `getLibraryGrant`
returns the richer shape. App crate: `ios_setup_library`,
`ios_set_library_mode`, `LibraryGrant { kind, icloud_available }` mapped from
the plugin struct the way `grant()` does today; non-iOS stubs return the
platform error; register in the iOS-only handler list in `lib.rs`.
`ios-api.ts`: `iosSetupLibrary()`, `iosSetLibraryMode()`, the extended
`IosLibraryGrant`. Update `docs/tauri-commands.md`'s iOS table (done in #9,
but leave the signatures here for it).

- **Complexity:** M · **Category:** both · **Depends on:** #3 · **Files:**
  `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/NotesageIosPlugin.swift`,
  `src-tauri/crates/tauri-plugin-notesage-ios/src/lib.rs`,
  `src-tauri/src/commands/ios_library.rs`, `src-tauri/src/lib.rs`,
  `src/lib/ios-api.ts`

### #6 ✅ — Mobile store, onboarding without a picker, library settings row

`mobile-store`: `grantState` gains `"provisioning"` and
`"icloud-unavailable"`; `refreshGrant` calls `iosSetupLibrary` and maps
`{granted, kind, icloudAvailable}` → state; `setLibraryMode(mode)` action;
`libraryKind` in state (not persisted). `MobileApp.tsx`: route `provisioning`
to a centred spinner + "Setting up your Notesage library in iCloud…";
`icloud-unavailable` and `stale` to `Onboarding`. `Onboarding.tsx`: the
no-iCloud copy per the PRD's UI/UX, primary "Choose a folder", secondary
"How to turn on iCloud Drive" (opens Settings through a small native call —
add `ios_open_settings` to #5 if no existing affordance exists; check
`useNativeChrome` first). `LibraryBrowser.tsx` root menu: the "Library" row
with "Use a different folder…" and "Switch to Notesage in iCloud" (the latter
only in `picked` mode with iCloud available), replacing the bare re-pick.
i18n `en` + `sv` for every new string; the count guard in `i18n` tests
passes. Tests: `mobile-store.test.ts` drives the four states and both mode
switches through the mocked commands.

- **Complexity:** L · **Category:** frontend · **Depends on:** #5 ·
  **Files:** `src/stores/mobile-store.ts`, `src/MobileApp.tsx`,
  `src/components/mobile/Onboarding.tsx`,
  `src/components/mobile/LibraryBrowser.tsx`, `src/lib/i18n.ts`,
  `src/stores/__tests__/mobile-store.test.ts`

### #7 ✅ — Share Extension resolves the container itself

`ShareViewController`: resolve the root on a background queue before the
sheet's first layout (the container call can block — #1.6 has the number),
then proceed exactly as today. Replace the `getLibraryGrant().granted` guard
at line 369 with a switch on the resolve error: `iCloudUnavailable`/`noGrant`
with iCloud reachable → "Open Notesage once to set up your library";
no iCloud and no picked folder → the existing "choose your library" copy.
`LibraryCapture.swift` needs no change (it calls `resolveRoot()`), but read
it to confirm no bookmark assumption hides in `claimName`/`nameUnavailable`.
Strings in the extension's `L()` table, `en` + `sv`.

- **Complexity:** M · **Category:** native · **Depends on:** #2, #3 ·
  **Files:** `src-tauri/ios/ShareViewController.swift`,
  `src-tauri/ios/LibraryCapture.swift`, `src-tauri/ios/ShareResources/*`

**Blocked on the Apple Developer account, not on code.** #2's entitlements
declare `iCloud.com.notesage.app`, and Xcode refuses to sign against a
provisioning profile that does not carry them. So the moment this merges, the
next TestFlight cut fails to sign unless the App ID has the iCloud capability
enabled and that container exists in the portal, with the profiles
regenerated. The runtime degrades gracefully — a nil container falls back to
the picker — but signing does not degrade, it fails. This is why the PR is
open without auto-merge.

**Findings (2026-09-05).** `macro_rules! ios_only` sat two thirds of the way
down `ios_library.rs`, beside the notification commands that first needed it.
`macro_rules!` is only in scope AFTER its definition point, so the two new
commands added higher in the file failed with "cannot find macro `ios_only`
in this scope" — a confusing error for code textually identical to its
working neighbours. Moved above every use, with a comment saying why it lives
there. The view-options menu test also asserts the menu's exact shape, so the
two new library rows had to be added to both of its expectations.

### #8 — Device verification matrix

Run every state, not one (feedback rule): fresh install with iCloud (no
screen, Files shows Notesage, share before first open lands in `Inbox/`);
fresh simulator without an account (picker path end-to-end incl. a share);
upgraded install with a bookmark (unchanged); mode switch both ways, honoured
by the extension without an app relaunch; delete → Recently Deleted; a
container-mode share while the app is killed. Record each with a line under
this heading and screenshots in the PR. This is the Phase 1 gate for #9
and the TestFlight cut.

- **Complexity:** M · **Category:** qa · **Depends on:** #2–#7 · **Files:**
  this file (findings)

### #9 ✅ — Phase 1 documentation

`docs/features/mobile.md`: rewrite "Why a folder picker?" as "Where the
library is" (container first, picker as fallback, the mode rule, the marker);
update the command surface list. `src-tauri/ios/README.md`: same rewrite of
"Why a folder picker at all?". `docs/tauri-commands.md`: the iOS table gains
`ios_setup_library` / `ios_set_library_mode` and the richer `LibraryGrant`.
`docs/app-store/`: `app-privacy.md`, `privacy-policy.md`, `listing.md`,
`testflight.md` — "the folder you grant" becomes "your Notesage library in
iCloud (or a folder you choose)"; the "Data Not Collected" evidence gains one
line saying the container is Apple's. `docs/architecture.md`: the
`mobile-store` row's grant states.

- **Complexity:** M · **Category:** docs · **Depends on:** #8 · **Files:**
  `docs/features/mobile.md`, `src-tauri/ios/README.md`,
  `docs/tauri-commands.md`, `docs/app-store/*.md`, `docs/architecture.md`

### #10 ✅ — TestFlight script refuses an unentitled build

In `scripts/ios-testflight.sh`'s verification step (beside the version and
authority checks on the unzipped `.ipa`): `codesign -d --entitlements :-`
on the app and on the `.appex`; both must contain `iCloud.com.notesage.app`
under `com.apple.developer.icloud-container-identifiers`, or the script
exits before upload with the same tone as the existing failures ("Apple
would install this and the app would not see its library"). Add the check to
the "What to Test" template's pre-flight list.

- **Complexity:** S · **Category:** build · **Depends on:** #2 · **Files:**
  `scripts/ios-testflight.sh`, `docs/app-store/testflight-whats-new.md`

## Phase 2 — The Mac follows, and migrates behind the Labs flag

### #11 — `get_library_container_path` and `read_library_marker`

In `sync.rs`: `get_library_container_path() -> Option<String>` returns
`~/Library/Mobile Documents/iCloud~com~notesage~app/Documents` iff that
directory exists (macOS only; `None` elsewhere) — no creation in this phase.
`read_library_marker(root) -> Option<LibraryMarker>` over #4's Rust reader.
`tauri.ts` wrappers. Unit tests with a temp `HOME` for the path derivation
and marker parsing; a test that a missing container yields `None` rather than
an error.

- **Complexity:** S · **Category:** backend · **Depends on:** #1, #4 ·
  **Files:** `src-tauri/src/commands/sync.rs`, `src-tauri/src/lib.rs`,
  `src/lib/tauri.ts`

### #12 — Root resolution in `reloadTrees` with the marker

Replace the two lines that append `/Notesage` with the PRD's four-branch
rule (`migratedFrom` → container; marker + empty/absent CloudDocs →
container; CloudDocs exists → CloudDocs; container exists → container).
Store `libraryRootKind` (non-persisted, stripped in `partialize`). Extract
the rule into a pure function `resolveSyncedLibraryRoot(inputs)` in
`src/lib/library-root.ts` so it is unit-testable without the lifecycle hook;
the existing `reloadTrees` regression-lock test gains one case per branch.
`useStartWatchers` already keys on the setting; confirm the watcher restarts
on the new root when the value changes mid-session (a migration in #15
changes it). "Empty" for CloudDocs means no entries other than `.DS_Store`.

- **Complexity:** M · **Category:** frontend · **Depends on:** #11 ·
  **Files:** `src/hooks/useAppLifecycle.ts`, `src/lib/library-root.ts`,
  `src/lib/__tests__/library-root.test.ts`, `src/stores/settings-store.ts`,
  `src/hooks/__tests__/useAppLifecycle*.test.ts`

### #13 — Labs flag `icloud-container-library`

Registry entry in `src/lib/flags.ts` (`stage: "experimental"`, `introducedIn`
= the next `package.json` version, `default: false`); the Labs panel row
comes from the registry. `flags.test.ts` still locks defaults off. The flag
gates *performing* a migration (#15/#16) only — never the root resolution in
#12.

- **Complexity:** S · **Category:** frontend · **Depends on:** — · **Files:**
  `src/lib/flags.ts`, `src/lib/__tests__/flags.test.ts`

### #14 — `migrate_library_entry` primitive

`migrate_library_entry(src, dst) -> String`: refuse if `dst` exists (the
orchestrator decides collisions, the primitive never overwrites); refuse if
`src` is not inside a known library root (defence against a bad path from
the frontend); `std::fs::rename`; on `EXDEV` fall back to the existing
`migrate_directory` (copy → verify count → delete) for directories and
copy+remove for files. Returns the destination. Tests with temp dirs: file,
directory, dot-directory, refuse-on-existing, nested `.notesage/` survives,
symlink is moved as a link not followed.

- **Complexity:** M · **Category:** backend · **Depends on:** — · **Files:**
  `src-tauri/src/commands/sync.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`

### #15 — Migration orchestrator with the collision policy

`src/lib/library-migration.ts`: `planLibraryMigration(sourceListing,
destListing, markers)` (pure) → a plan of ordered steps with the PRD's
collision policy (Inbox merge with dedupe + `reading-progress.json` merge via
`reading-progress-file.ts`; pins union via `pins-file.ts`; drop
`sync-settings.json`; same-name folder rules; loose-file dedupe; skip
`.DS_Store`); `runLibraryMigration(plan, deps)` executes steps through
`migrate_library_entry`, `rename_path`, `read_file`/`write_file`, is
**resumable** (re-planning over what remains yields the same end state),
then rewrites paths in one pass — `workspace-store.updateProjectPath`,
`updateFilePaths` for pins, `editor-store.renameOpenDocument`/recents, and
the non-project comment sidecars through the helper `useFileRenameSync`
already uses (extract it if it is not yet reusable) — writes
`markMigrated(...)` to the container marker, sets `icloudNotesagePath` and
`libraryRootKind`, removes the old root only if empty, and returns a report
`{ moved: {projects, inboxItems, looseFiles}, merged, renamed, leftBehind }`.
Tests: plan over fake listings for every collision row; a resumed run; a
report that lists leftovers; no step ever produces a delete before its
destination exists (assert on the step sequence).

- **Complexity:** L · **Category:** frontend · **Depends on:** #4, #11, #14 ·
  **Files:** `src/lib/library-migration.ts`,
  `src/lib/__tests__/library-migration.test.ts`,
  `src/hooks/useFileRenameSync.ts` (extract sidecar helper),
  `src/stores/workspace-store.ts`, `src/stores/editor-store.ts`

### #16 — Migration UI: Settings group, confirmation, progress, report, startup toast

Settings → Projects: a `SettingsGroup` "Library" above the project cards
with a `SettingsRow` showing the resolved root and its pill ("Notesage in
iCloud" / "iCloud Drive/Notesage"), and — only when the flag is on and
`planLibraryMigration` reports eligibility — the primary button. Confirmation
`Dialog` renders the plan (counts, size from a shallow `du`-style listing or
`stat_file` sums, the re-upload note, collisions with their rule). `Progress`
per step. Report `Dialog` with counts and a "Reveal in Finder" for leftovers.
Startup: one sonner toast per eligible launch while the flag is on, action
"Review" opens the Settings row; it never migrates by itself. Every surface
uses shadcn, the neutral palette, `TooltipProvider` where a tooltip appears,
and reads in light and dark. Component tests for the eligible/ineligible
states and that the button is absent with the flag off.

- **Complexity:** M · **Category:** frontend · **Depends on:** #13, #15 ·
  **Files:** `src/components/settings/v2/ProjectsSettings.tsx`,
  `src/components/settings/LibraryMigrationDialog.tsx`,
  `src/hooks/useAppLifecycle.ts` (toast), tests beside each

### #17 — Consumer audit + regression lock for the resolved root

Walk every reader of `icloudNotesagePath` (`inbox-store.load`,
`workspace-store` pins write-through, `ProjectSettings`/`ProjectCard` move
to/from iCloud, `scanICloudForProjects`, `useFileWatcher` discovery,
`useFileTreeItemState` badge, `useFileOperations` notes-tree refresh,
`useStartWatchers`) and confirm each works with the container root — most
need no change, but the per-project "move to iCloud" copy says "iCloud
Drive" and the new-project default path must land under the resolved root.
Add one regression test: with a marker-bearing container root, the Inbox
dir, the pins file path, and a new synced project's path all resolve under
it.

- **Complexity:** M · **Category:** frontend · **Depends on:** #12 ·
  **Files:** the files listed, `src/lib/__tests__/synced-root-consumers.test.ts`

### #18 — macOS Share Extension prefers the container

`ShareLibraryAccess.defaultLibraryGuess()`: container `Documents/` first,
then today's two candidates. A bookmark that resolves to a folder that no
longer exists already reports "not granted" → picker; verify that path once
against a removed folder. No entitlement change — the extension keeps its
own user-selected bookmark.

- **Complexity:** S · **Category:** native · **Depends on:** #1 · **Files:**
  `src-tauri/macos/ShareLibraryAccess.swift`

### #19 — Phase 2 documentation

`docs/features/workspace.md` "Notesage Library & iCloud Sync": the container
is the synced root, the marker, the resolution rule, the migration and its
collision table, the flag. `docs/features/inbox.md` "The folder": the root
is the container when present. `docs/architecture.md`: `settings-store` row
(`icloudNotesagePath` semantics, `libraryRootKind`), `sync.rs` line in the
module tree. `docs/tauri-commands.md`: the three new commands.

- **Complexity:** M · **Category:** docs · **Depends on:** #16, #17 ·
  **Files:** `docs/features/workspace.md`, `docs/features/inbox.md`,
  `docs/architecture.md`, `docs/tauri-commands.md`

### #20 — Dogfood: migrate the owner's live library

Pre-flight: `cp -R "~/Library/Mobile Documents/com~apple~CloudDocs/Notesage"
~/Notesage-backup-2026-MM-DD` and confirm the copy's file count. Phone on the
Phase 1 TestFlight build, still bookmarked. Enable the flag on the Mac, take
the toast, review the plan (expect 19 top-level entries, `Inbox/` with its
items, the pins file), confirm. Then verify each Phase 2 quality gate in the
PRD in order: projects reopen with pins/recents/open doc; Inbox unchanged
incl. read state and progress; comments on a non-project note; old folder
gone; the phone follows without a screen within one sync interval and a
phone share lands on the Mac; Files shows **Notesage**. Record timings and
anything the report listed as left behind here. Keep the backup for a week.

- **Complexity:** S · **Category:** qa · **Depends on:** #8, #16, #17, #18 ·
  **Files:** this file (findings)

## Phase 3 — The Mac is entitled (Mac-first users)

### #21 — Spike: a notarised Developer ID build with the iCloud entitlement

Account side: iCloud capability + container on the macOS App ID; a Developer
ID provisioning profile. Build side: `Entitlements.plist` gains the three
iCloud keys; the profile ships as `Contents/embedded.provisionprofile` —
try `bundle.macOS.files` in `tauri.conf.json` first; if `tauri-action`'s
signing pass rejects it, embed in `scripts/macos-release-embed.sh`'s re-sign
step (which already re-signs the whole bundle for the Share Extension).
Prove on a clean Mac: Gatekeeper passes, `codesign -d --entitlements :-`
shows the keys, the app launches, and `URLForUbiquityContainerIdentifier:`
from a tiny Swift/objc probe inside the signed bundle returns a URL on an
account that never ran the phone app. Record the findings and the exact
mechanism here. Fallback if it cannot be made to work: the Mac-first
onboarding says "install Notesage on your iPhone first" plainly, and #22–#23
are dropped.

- **Complexity:** L · **Category:** build · **Depends on:** #1 · **Files:**
  `src-tauri/Entitlements.plist`, `src-tauri/tauri.conf.json`,
  `scripts/macos-release-embed.sh`, this file (findings)

### #22 — Entitled container creation from Rust, feature-detected

`get_library_container_path(create: bool)`: when `create` and the running
process carries `com.apple.developer.icloud-container-identifiers`
(`SecTaskCopyValueForEntitlement` via FFI), call
`NSFileManager.URLForUbiquityContainerIdentifier:` through `objc2` on a
blocking thread, create `Documents/`, write the marker with
`createdBy: "macos"`, return the path. Unentitled (every local dev build):
today's exists-check, no crash, a log line saying why. Tests: the
entitlement probe returns `false` under `cargo test`; the create path is
covered by #23's device run.

- **Complexity:** M · **Category:** backend · **Depends on:** #11, #21 ·
  **Files:** `src-tauri/src/commands/sync.rs`, `src-tauri/Cargo.toml`

### #23 — Mac-first default: new installs get the container

In `reloadTrees`, when no CloudDocs library exists and no container exists
but iCloud Drive does, call `get_library_container_path(create: true)` and
use the result; `com~apple~CloudDocs/Notesage` is no longer created for new
installs (find every place that creates it — `migrate_to_icloud` does with
`create_dir_all` — and point them at the resolved root). Verify on a clean
Mac account, then install the phone app: it shows the Mac's library with no
screen. Extend `library-root.test.ts` for the create branch.

- **Complexity:** M · **Category:** frontend · **Depends on:** #12, #22 ·
  **Files:** `src/hooks/useAppLifecycle.ts`, `src/lib/library-root.ts`,
  `src-tauri/src/commands/sync.rs`

### #24 — Release pipeline verifies the Mac entitlement

`release.yml`: after signing (and after the Share Extension embed, which
re-signs), a step runs `codesign -d --entitlements :-` on the `.app` and
fails the job if the container id is absent; the profile secret is added
beside the existing `APPLE_*` secrets with a comment on what it is and how it
is renewed (Developer ID profiles expire). Document the renewal in
`docs/release-runbook` (or wherever the macOS signing notes live — find it).

- **Complexity:** M · **Category:** build · **Depends on:** #21 · **Files:**
  `.github/workflows/release.yml`, `scripts/macos-release-embed.sh`, docs

## Phase 4 — Graduate

### #25 — Remove the flag; the container is the library

Per the Labs graduation rule (evidence, not a timer): delete the registry
entry; the migration prompt appears for every eligible Mac (toast + Settings
button, still confirm-only); the CloudDocs root becomes a legacy source that
is only ever read for migration; the phone's picker remains only for the
no-iCloud case; `docs/product-description.md` roadmap entry; changelog;
`docs/app-store/` copy final. Re-run the Phase 1 and Phase 2 quality gates on
the shipped builds.

- **Complexity:** M · **Category:** both · **Depends on:** #20, #23, #24 ·
  **Files:** `src/lib/flags.ts`, `src/hooks/useAppLifecycle.ts`,
  `src/components/settings/v2/ProjectsSettings.tsx`,
  `docs/product-description.md`, `docs/app-store/*.md`, `public/changelog.json`
