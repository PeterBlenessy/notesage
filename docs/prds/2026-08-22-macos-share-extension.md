# PRD: macOS Share Extension

**Status:** Draft
**Date:** 2026-08-22
**Tasks:** `docs/tasks/2026-08-22-macos-share-extension.md`
**Precedent:** `src-tauri/ios/` — the iOS Share Extension this mirrors

## Problem

Capture on iOS is a share away. On the Mac — where most reading and all
writing actually happens — there is no capture path at all. You find something
in Safari, and the options are to copy the URL and paste it into a note, or to
leave it and hope you remember.

The asymmetry is the point: the same person, the same library, the same
article, and the good workflow is on the device they use less for this.

## Goals / Non-Goals

### Goals

- Notesage appears in the macOS **Share** menu (Safari, Finder, Photos, Notes).
- Captures land in the same `Inbox/` in the same library, in the same format —
  one library, not a desktop one and a phone one.
- Reuses `notesage-capture` unchanged. Article extraction, picture flattening,
  the X path and note formatting are already written and tested; a second
  implementation would drift from the first.
- Ships through the existing signed-and-notarised release pipeline.

### Non-Goals

- **A Services menu item.** Considered and rejected as the primary: it is far
  cheaper, but it lives in a submenu people forget exists, and the whole value
  here is that Share is where the hand already goes. It remains a cheap
  fallback if the extension proves impractical.
- **A Safari extension.** The only way to obtain the *rendered* DOM on macOS
  (see Constraints), but a separate project with its own review surface.
- Desktop parity for the image sweep. That runs in the iOS app; the desktop
  path can inherit it later.

## Constraints, and one that costs us something real

**No rendered DOM on macOS.** iOS gives share extensions
`NSExtensionJavaScriptPreprocessingFile`, which is how build 7 fixed
lazy-loaded images — Safari runs our script in the page and hands back the DOM
it rendered. **macOS share extensions have no equivalent.** Desktop capture
therefore falls back to fetching the URL, and inherits exactly the placeholder
problem iOS just escaped: a site with lazy-loaded images will save with 40px
placeholders.

This is not a detail to discover during implementation. It means desktop
capture is *worse* than iOS capture on image-heavy sites, permanently, unless
we later add a Safari extension. Worth saying out loud before building.

**Extensions are sandboxed even though the host app is not.** Notesage ships
Developer ID, unsandboxed. A macOS app extension is sandboxed regardless, so it
cannot simply write to `~/Notesage`. Same answer as iOS: an App Group plus a
security-scoped bookmark — with the macOS twist that the group identifier must
be Team-ID-prefixed (`M39TDQ2D7L.group.com.notesage.app`).

**Tauri owns the signing step.** `tauri-bundler` produces and signs the `.app`.
An extension embedded afterwards invalidates that signature, and one embedded
before does not exist yet. Resolving this ordering is the main unknown, and
task #0 exists to answer it before anything is built on top.

## Technical Approach

| Layer | Reuse | New |
| --- | --- | --- |
| Capture logic | `notesage-capture` staticlib, via the same C ABI iOS links | — |
| Library access | Design mirrors `LibraryAccess.swift` | AppKit/macOS port |
| Share UI | Design mirrors `ShareViewController` | AppKit rewrite — the iOS one is UIKit |
| Build | Existing notarisation pipeline | Compile, embed into `Contents/PlugIns/`, sign |

The UI surface is small — preview, format picker, save — so the AppKit rewrite
is bounded. The valuable half (extraction, formatting, dedupe, the X path) is
already written and stays shared.

## Phases

**0 — Spike the build.** Can a minimal, signed extension inside a
Tauri-produced `.app` be loaded by macOS at all? Everything else is wasted if
not. No product code.

**1 — Library access.** App Group, security-scoped bookmark, coordinated write
into the granted library. Ported from iOS.

**2 — The share UI.** AppKit: preview, format picker, save, error states.

**3 — Wire the capture.** Link the staticlib; article / markdown / link
formats behave as on iOS.

**4 — Ship it.** Fold embedding and signing into `release.yml`, ahead of
notarisation.

## Open questions

1. **Does Tauri let us in before signing?** If `beforeBundleCommand` cannot
   reach the assembled `.app`, we take over signing entirely — embed, sign the
   whole bundle, then notarise. That is well-trodden but moves a step Tauri
   currently owns into our workflow.
2. **Does the grant survive?** iOS resolves a security-scoped bookmark at
   every use. macOS bookmark semantics differ enough
   (`withSecurityScope`) that this needs verifying rather than assuming.
3. **One grant or two?** The desktop app already reads the library directly,
   unsandboxed. The extension needs its own bookmark, so the user may have to
   point at the library a second time — acceptable, but it should be asked for
   once and clearly.

## Success criteria

- Share from Safari on the Mac; the note appears in `Inbox/` and opens on the
  phone.
- Formats match iOS for the same URL.
- A capture with no library grant explains itself rather than failing silently.
- The release build stays notarised and Gatekeeper-clean with the extension
  embedded.
