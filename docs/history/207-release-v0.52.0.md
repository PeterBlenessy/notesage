# Release v0.52.0

**Date:** 2026-08-22
**Previous version:** 0.51.0

Notesage speaks Swedish, and it can now be added to the Mac's Share menu.

## Changes

### Features

- **Notesage in Swedish.** The whole interface — menus, settings, the editor —
  is translated. It follows your Mac's language automatically, or you can pick
  it yourself in Settings → Appearance.
- **Notesage in the Mac Share menu.** Save a page from Safari on your Mac the
  way you already can on your phone. This is experimental — turn it on in
  System Settings → General → Login Items & Extensions → Sharing.

### On the iPhone app

These shipped to TestFlight during this cycle. They are part of the phone app,
not the Mac app, and are listed here so the two stay in step.

- **Saved articles keep their images.** Share an article and the pictures are
  downloaded into it, so it still reads properly on a plane or years later when
  the original site has reorganised. Choose how large they are saved in the
  library's "..." menu, or switch it off there.
- **Saved pages look like themselves.** In gallery view an article now shows its
  own photograph instead of a shrunken page.
- **X posts save with their title and picture** rather than as a bare link,
  including X's long-form Articles.
- Pictures come from the page as you were viewing it, so they arrive at full
  quality instead of the blurry placeholder some sites load first.
- Pull down to refresh in the library and the spinner actually spins.
- Thumbnails follow your light or dark theme.
- Fixed: sharing a link from Messages or Mail could fail with "nothing to save".
- Fixed: saved articles from some sites lost their images when offline.
- Fixed: browsing a large library gradually used more memory than it needed to.

## Under the hood

- **Swedish UI** across desktop chrome, Settings and the editor. `sv` joins `en`
  in `SUPPORTED_LOCALES`; `settings.locale` of `null` follows the OS.
- **macOS Share Extension**: phases 0–4 of
  `docs/prds/2026-08-22-macos-share-extension.md`. Reuses `notesage-capture`
  through the same C ABI iOS links; the AppKit UI is new. No App Group — on
  Developer ID that needs an embedded provisioning profile the pipeline does not
  produce, so the extension holds its own security-scoped bookmark.
- **The release pipeline now embeds and signs the extension.** `tauri-bundler`
  assembles and signs the `.app` in one pass and derives the `.dmg` and updater
  tarball from it, and `beforeBundleCommand` runs before any `.app` exists — so
  there is no seam. `scripts/macos-release-embed.sh` therefore embeds into the
  finished bundle and regenerates everything downstream of it: signature,
  notarisation ticket, `.dmg`, updater tarball, updater `.sig`, and
  `latest.json`'s inline signature. It runs *after* tauri-action has uploaded,
  so a failure in the embed leaves the previously-published, correctly-signed
  (extension-less) artifacts in place. The asset swap itself cannot be atomic
  (GitHub has no atomic replace), so it prepares everything before mutating
  anything, retries, verifies by re-listing, and logs an explicit
  DO-NOT-PUBLISH warning if it still ends up half-applied — the release stays a
  draft in that case, since `publish-release` is skipped when the job fails.
  **This path has not yet run on a real tag** — the Developer ID certificate
  exists only in CI.
- The regenerated `.dmg` is a plain UDZO image with an `/Applications` symlink
  rather than Tauri's default window layout. It installs identically; it looks
  plainer on first open.
- `NSExtensionJavaScriptPreprocessingFile` on iOS — capture now receives the DOM
  Safari rendered rather than re-fetching, which is what fixes lazy-loaded
  images. **macOS has no equivalent**, so desktop capture inherits the
  placeholder problem permanently, short of a Safari extension.
- Eight code-review findings fixed (#751), including a data race on a timed-out
  image download and an unrevoked blob URL per evicted thumbnail.
- Self-contained articles: phases 1–2 of
  `docs/prds/2026-08-21-self-contained-articles.md`. Phases 3 (retroactive
  sweep) and 4 (`BGProcessingTask`) are unshipped.
- `RELEASE_OFF_MAIN` removed from `scripts/ios-testflight.sh` after being used
  to ship build 9 from a branch.
- 17 npm advisories cleared via bounded overrides.
- Perf suite: three `cmdbar` benchmarks had been crashing on mount rather than
  measuring, and CI's `continue-on-error` on the perf step reported it as green.
  Mock fixed; `scripts/perf-ci-guard.mjs` now fails the job when a benchmark
  throws instead of overrunning, while still tolerating shared-runner timing
  noise.
- Known: markdown captures still reference remote images, so they behave
  differently from HTML captures both offline and in gallery view (#755).

## Files Changed

- 18 commits since v0.51.0.
