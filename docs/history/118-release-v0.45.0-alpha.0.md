# Release v0.45.0-alpha.0

**Date:** 2026-05-15
**Previous version:** 0.44.0
**Channel:** Alpha

First alpha after v0.44.0 stable. **Closes all 6 open security alerts**, modernizes the dependency surface, fixes the long-standing image hover toolbar regression on production builds, and improves the in-app changelog and update-dialog experience.

## Changes

### Features

- **Update dialog renders markdown.** "Update available" and "Switch back to Stable?" dialogs now render markdown (bold, bullets, links) instead of plain text. Release notes for v0.45.0 onwards arrive formatted.

- **In-app changelog respects your channel.** Stable users now see only stable releases in the "What's new" view. Alpha users see the full list including alphas. Each channel fetches its own feed so a stable user no longer scrolls past alpha entries they never had.

### Improvements

- **MicButton stays in sync across instances.** Clicking the dictation button in the StatusTray and the Toolbar now share a single source of truth — clicking one to start, then clicking the other to stop, works as expected. Previously the second instance was unaware the first had started a session.

- **Image hover toolbar works in production builds.** Hovering an image in a release / production build now shows the width and alignment popover. Previously the popover only fired in dev mode — a long-standing regression tracked in `docs/history/112-release-v0.44.0-alpha.0.md` as a known issue.

- **Empty HTML files show a placeholder.** Opening a 0-byte or whitespace-only `.html` file now displays "This HTML file is empty" instead of a blank pane.

- **Multi-line table cells survive export.** Cells containing `<br>`-separated lines now round-trip through PDF, DOCX, and HTML export without flattening to a single line.

- **Editor scroll-restore is more reliable.** Reopening a doc with a zero-height collapsed cursor no longer fails to scroll to position.

- **Build infrastructure: 22 frontend deps and 10 Rust deps refreshed.** Tiptap 3.22 → 3.23, React 19.2.5 → 19.2.6, Vite 8.0.8 → 8.0.13, tokio 1.49 → 1.52, pdfjs-dist 5.6 → 5.7, and the rest of the patch-version drift since v0.43.0. Frontend test suite ran clean against the new versions; existing functionality is unaffected.

### Fixes

- **mermaid security alerts (4) closed.** mermaid 11.14.0 → 11.15.0 closes Dependabot alerts about Gantt-chart DoS, classDef HTML injection, configuration CSS injection, and classDef CSS injection. If you embed mermaid diagrams in your documents, this is a meaningful security pickup.

- **rand low-severity alert closed (transitive).** A Rust dependency that pulls in the `rand` crate was advanced; the unsoundness with custom loggers no longer applies.

- **Tauri IPC Origin Confusion alert closed.** Tauri framework advanced from 2.10.2 to 2.11.1 (Rust crate) + matching `@tauri-apps/*` JS package alignment. Closes Dependabot alert #57. The bump was a side effect of `cargo update`'s global resolution within the existing `tauri = "2"` constraint; the JS-side packages were aligned to match because Tauri requires JS and Rust majors/minors to agree at build time.

## Known issues

- **Voice dictation can hang the app after extended use** (#264). Reproduce: start dictation, leave it running for a while, eventually the app becomes unresponsive and requires force-quit. Root cause not yet characterised. **Avoid extended dictation sessions on this alpha.** Will be investigated and fixed before v0.45.0 stable.

- **Image hover toolbar styling differs from chart / drawing / link-preview toolbars** (#258, #259). The functional fix landed in this alpha but visual consistency with the other block-size toolbars (and proper positioning relative to the image rather than the page) is still pending. The width and alignment behaviour is correct; it just looks slightly different.

- **Toolbar alignment chord on embedded blocks deferred.** Originally planned for this alpha, but the implementation collided with app-level chord bindings (`⌘⇧L` sidebar, `⌘⇧E` export, `⌘⇧R` recording). Tracking under #220 (toolbar-only fix) and #263 (drop Tiptap default chord). Use the per-block hover popover to align charts / drawings / images / link previews for now.

## Under the hood

### Channel-aware changelog feed

`scripts/generate-changelog.ts` now emits two files: `public/changelog.json` (stable releases only) and `public/changelog-alpha.json` (full list including alphas). The release workflow uploads the appropriate one as the release asset based on the prerelease flag; `useChangelog.ts` picks the URL pair at runtime based on `settings.releaseChannel`. Stable users hit `releases/latest/download/changelog.json`; alpha users hit `releases/latest-alpha/download/changelog-alpha.json`.

### Image hover toolbar — direct DOM listeners

The fix in #222 replaces an editor-level `mouseover` ProseMirror plugin (which fired in JSDOM and dev but not in production WebKit) with direct `addEventListener('mouseenter')` on a wrapper `<div>` around the image NodeView. Matches the pattern charts, drawings, and link-previews use. Verified end-to-end on the user's 494 KB image-heavy markdown book — the previously-load-bearing perf revert in commit `19b9fdb5` is preserved (the React-NodeView approach that regressed the parse from ~3s to ~12s is NOT re-introduced).

### Tauri 2.10 → 2.11 (security) landed via side effect

This alpha was originally intended to hold back the Tauri framework upgrade (tracked as #227/#234 pending real Tauri E2E coverage from #254/#260). Instead the Rust patch sweep #238 ran `cargo update`, which advanced `tauri` and `tauri-plugin-*` from 2.10.x to 2.11.x within the existing `tauri = "2"` constraint in `Cargo.toml`. The build broke with a JS/Rust major-minor mismatch error from `tauri-action`, forcing JS-side @tauri-apps/* alignment to 2.11 as well. Net result: alert #57 closes, Tauri framework upgraded, no manual real-E2E smoke-test performed yet. Worth a close eye on this alpha's IPC behaviour.

A future-proofing note for #238's pattern: when running `cargo update`, the Cargo.toml's loose version constraints determine what `update` will reach for. To intentionally hold back a major-or-minor of a specific crate, pin it explicitly (e.g. `tauri = "=2.10.2"` instead of `tauri = "2"`).

### Files Changed

37 files across 6 PRs (#214, #221, #222, #237, #238, #241) since v0.44.0. Plus the channel-aware changelog commit (`1847aa94`).
