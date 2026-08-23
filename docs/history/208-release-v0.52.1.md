# Release v0.52.1

**Date:** 2026-08-23
**Previous version:** 0.52.0

Fixes the Mac Share menu, which could not save anything in v0.52.0.

## Changes

### Fixes

- **Saving from the Mac Share menu works.** In v0.52.0 sharing any web page
  reported "Nothing to save". Notesage now reads the link from the share
  regardless of which form the sending app hands it over in.
- **When a share genuinely cannot be saved, it says why.** Every failure
  previously showed the same "Nothing to save", which described none of them.

## Under the hood

- **Root cause:** the extension's `Info.plist` declared
  `NSExtensionActivationSupportsWebPageWithMaxCount`. That activation rule
  pairs with `NSExtensionJavaScriptPreprocessingFile`, which **macOS does not
  support** — the constraint the PRD had already documented. It was carried
  over from the iOS plist, where it is correct. Safari therefore activated the
  extension under the web-page rule and delivered an item shaped for
  preprocessing results. The rule is now `SupportsWebURL` only.
- URL extraction accepts `public.url`, `public.file-url`, `public.plain-text`
  and `com.apple.property-list`, and reads `NSURL`, `NSString`, `Data` or the
  property-list dictionary. It previously accepted only `public.url` cast to
  `URL`/`String`, so a link handed over as text or bytes looked like an empty
  share.
- The extension logs what it received (`[notesage-share]`, subsystem
  `com.notesage.app.ShareExtension`), so a failure names the attachment types
  instead of requiring a guess.
- **Release pipeline: the asset swap matched by `path.basename()`.** The local
  updater tarball is `Notesage.app.tar.gz`; `tauri-action` publishes it as
  `Notesage_aarch64.app.tar.gz`. Nothing matched, so the swap ADDED a second
  tarball rather than replacing the first — and `latest.json` kept the
  original's URL while carrying the new one's signature. Auto-update would
  download one file and verify it against another's signature. v0.52.0's
  assets were repaired by hand after publication.

  The swap now matches by suffix and re-uploads under the published name, so
  the manifest's URL stays valid. And it verifies the property that actually
  governs auto-update — that the file `latest.json` points at is the file whose
  signature it carries — rather than merely confirming the uploads landed,
  which is what passed while v0.52.0 was broken.

- **A capture pipeline contract, as an executable test**
  (`notesage-capture/tests/pipeline_contract.rs`). Adding a share source
  touches a chain that crosses three languages — builder → FFI → Swift → saved
  file → sweep → inliner → thumbnail — and nothing checked the chain, only the
  builders. Two contracts now do:

  1. **Reachability** — every `pub fn build_*` must name the FFI export that
     reaches it, or be explicitly waived with a reason. This catches the live
     defect it was written for: **X capture is unreachable.** `build_x_note`,
     `x_syndication_url` and `XPost` are written and unit-tested with no FFI
     export and no caller, so X posts never take the X-aware path. X articles
     still save, because generic readability extraction happens to work on X's
     server-rendered pages — but the metadata path that supplies title, author
     and cover image is never called, which is why those captures have no
     gallery thumbnail.
  2. **Discoverability** — a capture carrying an image must carry it somewhere
     the gallery can find it. This failed on first run and exposed a second
     defect: `article_lead_image` scanned only for `src="data:`, the HTML form,
     so an inlined markdown image was embedded in the file and never looked
     for. It now scans the HTML attribute, markdown inline, and markdown
     reference-definition forms.

## Known

- The macOS Share Extension remains experimental. It has no rendered DOM
  (macOS has no `NSExtensionJavaScriptPreprocessingFile`), so on lazy-loading
  sites it captures placeholder images where iOS captures the real ones.
- Markdown captures still reference remote images, so they behave differently
  from HTML captures both offline and in gallery view (#755).

## Files Changed

- macOS Share Extension (`Info.plist`, `ShareViewController.swift`), the
  release workflow's asset swap, and the capture-pipeline contract test with
  its supporting `notesage-capture` changes.
- X capture remains unreachable — recorded and enforced by the contract test,
  not yet fixed.
