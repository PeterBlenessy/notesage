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

### #4.1 Build + embed + sign ✅ (script written; unproven — needs a Developer ID cert, i.e. CI)

Compile the extension, place it in `Contents/PlugIns/`, sign the whole bundle,
notarise. Ordering is the fragile part (#0.2 B).

### #4.2 Verify the shipped artefact

`codesign --verify --deep --strict` and a Gatekeeper check on the notarised
bundle, in CI — not by hand. An extension that fails to load produces no error
anyone sees; it simply never appears in the Share menu, which is
indistinguishable from not having built it.

---

## Out of scope

Services menu (rejected as primary — see PRD). Safari extension. Desktop image
sweep.
