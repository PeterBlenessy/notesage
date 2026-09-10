# Release v0.58.0

**Date:** 2026-09-10
**Previous version:** 0.57.3

Sharing a link after moving your library was quietly filing it into iCloud's
Trash. That is fixed, sharing no longer needs the folder permission at all, and
the app now shows the licences of everything it ships.

## Changes

### Features

- **Notesage lists every open-source project it includes.** Settings → System →
  About → "Open source projects" opens a searchable list of the 1,500-odd
  components inside the app, each row expanding to the full licence text, with
  who wrote it. It is entirely offline — the list ships with the app rather than
  being fetched — and it is grouped so you can see what is bundled with the app
  versus what it builds on.

### Fixes

- **Sharing a link no longer files it somewhere you cannot see it.** If your
  library had moved — into Notesage's own iCloud folder, or anywhere else — the
  share sheet kept writing to where the library used to be, which iCloud had
  put in its Trash. Every capture said "saved" and none of them arrived. Sharing
  now checks that the folder it is about to write to is still your library, and
  if it is not, it says your library moved and offers to point at the new one.
  **If you shared anything after moving your library, look in iCloud Drive's
  Trash — iCloud deletes it about 30 days on.**
- **Sharing to Notesage no longer asks you to pick your library folder.** When
  your library lives in Notesage's own iCloud folder, the share sheet opens it
  directly, because that folder belongs to Notesage. No picker, no permission to
  grant, and nothing that can go stale the next time the library moves. Picking
  a folder still applies to a library kept anywhere else.
- **Keyboard focus is visible again on a default install.** With the accent
  colour left at Default, the focus outline on every sidebar row and both Inbox
  rows drew nothing at all, as did the unsaved-changes dot in the title bar and
  the lines that show where a dragged file will land. All of them are back.
- **The library move stops warning about files it did not harm.** A successful
  move ended with eight alarming lines about comments that "could not be
  moved" — half of them about comment files that were empty or had been
  unreadable long before. The report now mentions only the real gap, in one
  line, and says plainly that nothing was deleted.

## Under the hood

- #975 / #976. A security-scoped bookmark tracks the FILE, not the path, so the
  Share Extension's own bookmark followed the old root into
  `~/Library/Mobile Documents/.Trash/Notesage` when the container migration moved
  it: `resolveRoot()` succeeded, the write succeeded, the UI said saved. A write
  that lands in the wrong place is worse than one that fails, because nothing
  asks the user to fix it. The app cannot repair it from its side — a bookmark it
  mints is not resolvable inside the extension's sandbox, which is why the
  extension has its own — so `validateLiveLibrary` runs at every resolve and
  refuses a root inside a `.Trash`, a root that is gone, and a root the
  container's `library.json` records as `migratedFrom`. All three raise the
  existing `.staleGrant`, so the recovery is the message and picker that already
  exist. An unreadable marker means "no migration recorded", so a hand-edited
  file cannot lock anyone out of sharing.
- #976 then removes the grant from the path entirely: the extension carries the
  iCloud container entitlement itself, backed by its own
  `Notesage_macOS_ShareExtension_DeveloperID.provisionprofile` (a separate App ID
  — the app's profile names `com.notesage.app` exactly rather than a wildcard).
  Two things would have shipped broken and were found by running rather than
  reasoning: a container root has no security scope, so
  `startAccessingSecurityScopedResource()` answers false and the old `guard` read
  that as a stale grant (every capture would have failed); and `--` inside an XML
  comment passes `plutil -lint` but kills codesign with
  "AMFIUnserializeXML: syntax error". Entitlement presence is probed with a real
  write, because `fileExists` cannot tell "no container" from "no permission".
  `macos-release-embed.sh` verifies app and extension through ONE function so the
  pair cannot drift.
- CI did not type-check the macOS extension's Swift at all — the file deciding
  where a shared article goes was compiled by nothing until a release built it.
  It is checked now, and `scripts/check-macos-share-library.sh` runs the
  library rule against real paths (trashed, missing, superseded, container).
- #972. Twelve components spelled the accent fallback inline as
  `var(--accent, var(--primary))`. There is no `--primary` token — the neutral is
  `--color-primary` — and a `var()` that resolves to nothing invalidates the whole
  declaration at computed-value time, so those affordances drew nothing rather
  than the promised neutral grey. All now consume `--color-accent-primary`.
  `accent.test.ts` grows a correctness guard: any `var(--x, var(--y))` whose
  fallback names a custom property nothing in `src/` defines fails with file,
  line and token. One verified slice of #39, not all of it — the remaining
  `focus-visible:` width/colour drift across ~85 files needs a visual pass.
- #971, the Mac half of #949. `scripts/generate-licenses.mjs`
  (`pnpm licenses:generate`) reads the production npm closure and the resolved
  cargo graph, plus an `EXTRAS` table for the four bundles no manifest knows
  about, each reading its text from the copy in this repo so a stale entry throws
  at generation. 1,508 components, 396 distinct notices, texts pooled by content
  hash: 1.7 MB, 194 KB gzipped, loaded as a dynamic import so startup is
  untouched. Missing notices added to the bundle itself: `public/foliate-js`,
  its vendored `zip.js`, and `src-tauri/binaries/llama-server`. Still open on
  #949: the iOS screen (the phone has no About surface yet) and the LEGAL rows
  (the EULA does not exist and the privacy policy is unhosted).
- #967. Of eight warnings on Peter's successful migration, three sidecars were
  `[]`, one had been corrupt since long before the feature existed, four held one
  comment each — so half the report was about nothing, phrased as loss, on the
  one screen that must not cry wolf. Empty sidecars are skipped, unparseable ones
  are logged rather than blamed on the move, and the real gap (comments written
  before sidecars recorded which note they belong to) is one line. The hash in
  the filename can still be matched against the paths the migration recorded, so
  recovery stays possible.
- #973. The suite no longer runs on push to `main`: `main` is protected with
  `strict: true` and `enforce_admins: true`, so every commit arrived through a PR
  whose last run tested the same tree, and the post-merge repeat cost 48
  job-minutes a merge. A nightly run replaces it and carries the advisory checks
  too slow for every push (shuffled-order isolation, `cargo audit`).
- iOS work in this window ships separately to TestFlight: #977 (required-reason
  API declarations, needed for submission), #980 (the swipe watchdog no longer
  runs through a scroll), #968 (each pinned card names its own badge), plus
  #969 / #970 / #978 / #979 tightening the mobile suite's guards.

## Files Changed

- 69 files across 13 commits (+2,772 / −223)
