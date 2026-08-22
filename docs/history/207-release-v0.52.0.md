# Release v0.52.0

**Date:** 2026-08-22
**Previous version:** 0.51.0

Saved web pages keep their pictures now, and Notesage can be added to the Mac's
Share menu.

## Changes

### Features

- **Notesage in the Mac Share menu.** Save a page from Safari on your Mac the
  way you already can on your phone. This is experimental — turn it on in
  System Settings → General → Login Items & Extensions → Sharing.
- **Saved articles keep their images.** Share an article and the pictures are
  downloaded into it, so it still reads properly on a plane or years later when
  the original site has reorganised. Choose how large they are saved in the
  library's "..." menu, or switch it off there.
- **Saved pages look like themselves.** In gallery view an article now shows its
  own photograph instead of a shrunken page.
- **X posts save with their title and picture** rather than as a bare link,
  including X's long-form Articles.

### Improvements

- Pictures come from the page as you were viewing it, so they arrive at full
  quality instead of the blurry placeholder some sites load first.
- Pull down to refresh in the library and the spinner actually spins.
- Thumbnails follow your light or dark theme.

### Fixes

- Sharing a link from Messages or Mail could fail with "nothing to save".
- Saved articles from some sites lost their images when offline.
- Browsing a large library gradually used more memory than it needed to.

## Under the hood

- macOS Share Extension: phases 0–4 of
  `docs/prds/2026-08-22-macos-share-extension.md`. Reuses `notesage-capture`
  through the same C ABI iOS links; AppKit UI is new. No App Group — on
  Developer ID that needs an embedded provisioning profile the pipeline does
  not produce, so the extension holds its own security-scoped bookmark.
  **Embed-and-sign is unproven end to end**; the Developer ID certificate lives
  only in CI.
- Self-contained articles: phases 1–2 of
  `docs/prds/2026-08-21-self-contained-articles.md`. Phases 3 (retroactive
  sweep) and 4 (`BGProcessingTask`) are unshipped.
- `NSExtensionJavaScriptPreprocessingFile` on iOS — capture now receives the
  DOM Safari rendered rather than re-fetching, which is what fixes lazy-loaded
  images. **macOS has no equivalent**, so desktop capture inherits the
  placeholder problem permanently, short of a Safari extension.
- Eight code-review findings fixed (#751), including a data race on a timed-out
  image download and an unrevoked blob URL per evicted thumbnail.
- `RELEASE_OFF_MAIN` removed from `scripts/ios-testflight.sh` after being used
  to ship build 9 from a branch.
- Known: markdown captures still reference remote images, so they behave
  differently from HTML captures both offline and in gallery view.

## Files Changed

- 18 commits since v0.51.0.
