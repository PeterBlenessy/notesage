# Release v0.44.0-alpha.3

**Date:** 2026-05-12
**Previous version:** 0.43.0 (stable) — first alpha you'll see on the Alpha channel after the v0.43.1 patch
**Channel:** Alpha

The cumulative v0.44.0 alpha pulled together — HTML viewer security toggles, durable block formatting, Print Layout polish, and a cleaner Settings → Updates flow.

## Changes

### Features

- **Block external resources in the HTML viewer.** Settings → System → HTML viewer → "Block external resources" — toggle ON to strip `https://...` URLs from `<img src>`, `<link href>`, `<source srcset>`. Local relative paths still load.

- **Allow scripts in local HTML files (opt-in).** Settings → System → HTML viewer → "Allow scripts" — toggle ON to render HTML files in an isolated `allow-scripts` iframe so same-directory `<script src="./local.js">` can execute. External CDN scripts are NOT included.

- **Unsafe preview mode (per-tab, session-only).** A toolbar button on each open HTML file shows a security acknowledgment dialog; accept and the file renders with raw HTML including CDN and inline scripts. Switching tabs resets it.

- **Allow `<form>` submissions in HTML viewer.** Settings → System → HTML viewer → "Allow forms" — keeps `<form>`, `<input>`, `<button>`, action / method attributes in the sanitised tree.

- **Width + alignment persist on charts, drawings, link-previews, and images.** Hover the block → pick 25 / 50 / 75 / 100% width and left / center / right alignment from the popover. The choice survives a save and reappears the next time you open the file.

- **`Cmd+= / Cmd+- / Cmd+0` zoom in the PDF viewer.** Markdown editor and PDF share the same shortcut.

- **Research and templates folders visible at project root.** Previously hidden under `.notesage/`; now `research/` and `templates/` are first-class folders. Existing hidden content is migrated on next launch.

### Improvements

- **HTML files open as a real rendered page.** No iframe wrapper — `.html` files render inline with the same toolbar, theme toggle, `Cmd+T`, and `Cmd+F` as every other viewer.

- **Embedded blocks have more breathing room.** Images, charts, drawings, and link-preview cards sit with a generous margin above and below.

- **Status tray completion picker is now a dropdown.** Settings → Inline Completion and the StatusTray popover show the same control.

- **Switching back from Alpha to Stable is one click.** Pick Stable in Settings → Updates → Release Channel and a clear "Switch back to Stable?" dialog appears with the version you'll move to. Decline and you stay on the alpha until a stable release exceeds your version.

- **Checking for updates fires automatically when you change channel.** No more manual "Check for updates" click after toggling between Stable and Alpha.

### Fixes

- **Width / alignment values stop disappearing after a tab-switch.** The worker that parses markdown for tab-switch now mirrors the production extensions; ProseMirror's DOMParser no longer drops those attributes during reload.

- **Editor no longer crashes when you insert a chart, drawing, or link preview.** Fixed a missing `<TooltipProvider>` that the error boundary was catching on every block render.

- **Reopening a doc no longer scrolls "a few paragraphs down" before snapping to the right place.** Restores from the live saved ratio instead of the stale viewport-cache value.

- **`Cmd+-` no longer toggles raw markdown mode on Swedish keyboards.** Source-mode chord was matching the physical key position (which is `-` on Swedish ISO). Now matches the produced character.

- **Image markdown serializer closes the block correctly.** Without a trailing `\n\n`, the next heading was concatenated and its `#` was backslash-escaped, corrupting the saved file.

## Under the hood

### Channel-isolation hard guarantee — what changed

The "stable users never get alpha" promise is now backed by four redundant layers:

1. **Workflow auto-detect** (`release.yml`): `create-release` computes `prerelease: /-(alpha|beta|rc)(\.|$)/.test(tag)`.
2. **GitHub native resolution**: `releases/latest` skips prereleases by definition.
3. **In-app stable guard**: stable channel calls `isPrereleaseVersion()` on the manifest and refuses any update whose version has a `-` segment.
4. **Rolling pointer is prerelease**: the `latest-alpha` release is flagged so `releases/latest` skips it.

Two regression-lock tests parse `release.yml` and assert the pieces stay wired up.

### Real in-app install for alpha channel

New Rust command `alpha_check(url)` (`src-tauri/src/commands/alpha_update.rs`) drives `tauri-plugin-updater::UpdaterBuilder` with the alpha rolling-pointer URL and returns a `Resource` rid that the JS-side `new Update(metadata)` wraps. Full plugin-updater install pipeline — signature verify against bundled pubkey, bundle replace, restart — same code path stable uses. No browser redirect.

### Leave-alpha flow — implementation notes

- `isLeaveAlphaDowngrade(current, manifest)` checks: current is prerelease AND manifest is stable AND the X.Y.Z triple of the manifest is strictly less than the triple of the current.
- `checkStableChannel()` passes `allowDowngrades: true` to `check()` only when the running binary is a prerelease.
- `UpdateInfo.isLeaveAlphaDowngrade?: boolean` is the discriminator that drives the dialog's switched copy.
- `useAutoUpdate` adds a `useEffect` that re-runs `checkForUpdate()` when `releaseChannel` changes.

### Files Changed (cumulative since v0.43.0)

~80+ files across all alpha.0–alpha.3 work. Notable adds include the HTML viewer security toggles, block-size persistence, the `alpha_update` Rust command, and assorted regression locks.
