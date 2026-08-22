# Tasks: macOS Share Extension

Breakdown of `docs/prds/2026-08-22-macos-share-extension.md`.

---

## Phase 0 — De-risk the build ✅ (investigated; findings below)

### #0.1 What the shipped app actually is ✅

```
Authority       Developer ID Application: ADDABLE AB (M39TDQ2D7L)
Flags           0x10000 (hardened runtime)
Contents/       MacOS, Resources, Info.plist, _CodeSignature   ← no PlugIns
```

Developer ID + notarised + hardened runtime is exactly the posture a bundled
extension needs. Nothing structural blocks this.

### #0.2 Two obstacles, both concrete

**A. The Developer ID certificate is not on this machine.**

```
Apple Development: Peter Blenessy (835643VV3T)
Apple Distribution: ADDABLE AB (M39TDQ2D7L)
```

Signing happens in CI, via `tauri-action` reading `APPLE_CERTIFICATE`. So the
embed-and-sign step can only be proven end-to-end in CI, or locally with a
Development identity for a local-only build. Worth knowing before promising a
demo on this laptop.

**B. `tauri-action` owns signing, and embedding invalidates it.**

The bundler creates AND signs the `.app`. An extension added afterwards breaks
the signature; added before, there is no bundle yet. Resolution is to take
over: let Tauri build unsigned, embed the extension, sign the whole bundle
ourselves, then notarise. Well-trodden, but it moves a step out of Tauri's
hands and into `release.yml`, where it must stay correct across Tauri upgrades.

### #0.3 App Groups may not be worth their cost — DECIDED: own bookmark ✅

The iOS design shares the library grant between app and extension through an
App Group. On macOS with Developer ID that is **not** the cheap path: App Group
entitlements require an embedded provisioning profile, which the current
pipeline does not produce and which adds a renewal cliff nobody will remember.

**The alternative avoids it entirely.** The extension asks for the library
folder itself, once, via `NSOpenPanel`, and keeps its own security-scoped
bookmark in its own container. No App Group, no provisioning profile, no
pipeline change beyond embedding.

Cost: the user points at their library a second time — once for the app, once
for the extension. That is one extra dialog, ever, against a permanent
infrastructure burden.

**Recommendation: own bookmark.** Revisit only if a second grant proves
genuinely confusing in use.

---

## Phase 1 — Library access

### #1.1 Grant + bookmark ✅

`NSOpenPanel` pointed at the library, security-scoped bookmark persisted in the
extension's own defaults. Resolve on every use, as iOS does — macOS bookmark
semantics (`withSecurityScope`) differ enough that this needs verifying rather
than assuming.

### #1.2 Coordinated write ✅

`NSFileCoordinator` write into `Inbox/`, with the same native dedupe iOS uses.
Two devices writing the same library through iCloud is the normal case, not an
edge one.

---

## Phase 2 — The share UI (AppKit)

### #2.1 View controller ✅

Preview, format picker, save, cancel. Mirrors the iOS layout; the iOS code is
UIKit and cannot be ported directly.

### #2.2 States that are not the happy path ✅

No grant yet · fetch failed · no article found · save failed. Each should say
what happened. A share that closes silently having done nothing is the worst
outcome available.

---

## Phase 3 — Wire the capture

### #3.1 Link the staticlib ✅

`notesage-capture` for the right target triple, via the same C ABI iOS uses.

### #3.2 Formats ✅

Article (HTML) · Article (Markdown) · Link, matching iOS for the same URL.

**Expect worse image fidelity than iOS, permanently.** macOS share extensions
have no `NSExtensionJavaScriptPreprocessingFile`, so there is no rendered DOM —
desktop capture fetches, and inherits the lazy-loading placeholder problem iOS
escaped in build 7. Not a bug to fix later; a property of the platform, unless
a Safari extension is built.

---

## Phase 4 — Ship it

### #4.1 Build + embed + sign ✅ (wired into `release.yml`; not yet exercised on a real tag)

Compile the extension, place it in `Contents/PlugIns/`, sign the whole bundle,
notarise. Ordering is the fragile part (#0.2 B), and it resolved as follows.

**There is no seam inside the Tauri build.** `beforeBundleCommand` runs *before*
the bundling phase — confirmed against the Tauri 2.11 config schema, which
describes it as "a shell command to run before the bundling phase" — so no
`.app` exists at that point. Open question 1 of the PRD is therefore answered:
we take over.

`scripts/macos-release-embed.sh` embeds into the finished bundle and rebuilds
every artifact derived from it — signature, notarisation ticket, `.dmg`, updater
tarball, updater `.sig`, and `latest.json`'s inline signature. Missing any one
of those ships an inconsistent release; missing the last two breaks auto-update
for every desktop user, which is why the script verifies rather than assumes.

**It runs after tauri-action has uploaded, on purpose.** A failure in the embed
script leaves the already-uploaded, correctly-signed, extension-less artifacts
in place — the behaviour of every prior release.

**The replacement step is mitigated, NOT atomic.** An earlier version of this
document claimed the mismatch outcome was "unreachable". That was wrong, and a
code review caught it. GitHub offers no atomic asset swap — no rename, names
must be unique — so replacing an asset is necessarily delete-then-upload, and a
transient API error between the two leaves the release inconsistent. The
original code made it worse by validating `latest.json` *after* already
replacing the tarball, so a missing-manifest failure guaranteed the mismatch it
was checking for.

What the step does now, in order: prepares everything (reads all three
artifacts, fetches and patches the manifest in memory) before mutating
anything, so every legitimate give-up happens while the release is untouched;
retries uploads, since a transient error is the realistic failure; re-lists the
assets afterwards to confirm the swap landed; and if it still ends up
half-applied, logs `DO NOT PUBLISH THIS DRAFT` with the reason.

That last part matters because the structural protection is only partial. The
release is created as a draft and `publish-release` is skipped when this job
fails, so nothing reaches users automatically — but a human debugging a red
release job, seeing the assets already replaced, could reasonably publish by
hand. The log has to stop them, which a comment claiming the state was
impossible would not have done.

Verified locally where possible: `tauri signer sign <file>` writes
`<file>.sig` as a single-line base64 blob with no trailing newline — the exact
form `latest.json`'s `signature` field takes. **The signing and notarisation
path itself remains unproven**; the Developer ID certificate lives only in CI.

Cosmetic regression accepted: the regenerated `.dmg` is a plain UDZO image with
an `/Applications` symlink, not Tauri's default window layout.

### #4.2 Verify the shipped artefact ✅

Implemented as the final stage of `scripts/macos-release-embed.sh`, so it gates
the release rather than being a manual afterthought:

- `codesign --verify --deep --strict` on the app
- `spctl -a -t exec` Gatekeeper acceptance
- `stapler validate` on both app and dmg
- the extension is present, and signed by a `Developer ID Application` authority
- the rebuilt updater tarball is a strict superset of the one Tauri produced
  (compared entry-by-entry against a listing captured before the embed) and
  contains the extension

An extension that fails to load produces no error anyone sees; it simply never
appears in the Share menu, which is indistinguishable from not having built it.
Hence assertions, not inspection.

---

## Out of scope

Services menu (rejected as primary — see PRD). Safari extension. Desktop image
sweep.
