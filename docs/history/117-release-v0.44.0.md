# Release v0.44.0

**Date:** 2026-05-14
**Previous version:** 0.43.1
**Channel:** Stable

Promotes the v0.44.0 alpha to stable — HTML viewer security toggles, durable block formatting on charts / drawings / link-previews / images, PDF zoom, visible research and templates folders, a smoother Settings → Updates flow, and assorted editor fixes.

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

## Known limitations

A few rough edges shipped knowingly so the cumulative v0.44.0 work doesn't keep waiting on them. Each has a tracking issue.

- **Image hover toolbar doesn't appear in production builds** (#219). Width / alignment work via markdown attribute comments and via the hover popover on charts / drawings / link-previews — images currently need the markdown attribute path until this lands.

- **Toolbar alignment chord (`Cmd+Shift+L/E/R`) doesn't align embedded blocks** (#220). Use the per-block hover popover for charts / drawings / link-previews to set alignment.

- **Empty HTML files render as a blank pane with no signal** (#218). A file containing real content renders normally; a 0-byte file just shows white.

## Under the hood

This release promotes the cumulative v0.44.0-alpha.0 → alpha.3 work to stable. Same code, same Tauri commands, same signed artifact pipeline. No new architecture lands here that wasn't already exercised during the alpha line.

The v0.43.1 patch (channel-isolation hard guarantee + real in-app alpha install via `UpdaterBuilder`) is already in users' hands; v0.44.0 inherits those guards.

### Files Changed (cumulative since v0.43.0)

~80+ files across alpha.0–alpha.3. Notable adds: HTML viewer security toggles + DOMPurify sanitiser, block-size persistence on four node types, `alpha_update` Rust command, and assorted regression locks (Tooltip-provider sweep, channel-isolation parser, perf-budget linter).
