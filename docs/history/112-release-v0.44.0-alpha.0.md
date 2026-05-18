# Release v0.44.0-alpha.0

**Date:** 2026-05-10
**Previous version:** 0.43.0
**Channel:** Alpha

A first alpha cutting in the post-v0.43 stack of fixes for the previous wave of PRs (#169, #173, #181, #188). Width and alignment now actually survive a save / tab-switch on charts, drawings and link-previews; the HTML viewer renders inline; the completion picker matches Settings; PDF and the markdown editor share the zoom chord; and the 494 KB book opens in ~3 seconds again after a brief regression that snuck in during this branch.

## Changes

### Features

- **Width + alignment now persist on charts, drawings, and link-previews.** Hover the block → pick 25 / 50 / 75 / 100% width and left / center / right alignment from the popover. The choice survives a save and reappears the next time you open the file. Saved as a small metadata comment at the end of the markdown line so you can edit the value by hand if you want to.

- **`Cmd+=` / `Cmd+-` / `Cmd+0` zoom now also works in the PDF viewer.** Markdown editor and PDF zoom share the same shortcut.

### Improvements

- **HTML files open as a real rendered page.** Notesage no longer wraps `.html` files in an isolated iframe — the body renders inline, the toolbar is always visible with a Source / Rendered toggle, `Cmd+T` theme toggling and `Cmd+F` find work straight away. `<script>` and other risky tags are stripped before rendering.

- **Embedded blocks have more breathing room.** Images, charts, drawings, and link-preview cards now sit with a generous margin above and below so they don't visually crowd the surrounding text.

- **Status tray completion picker is now a dropdown.** Settings → Inline Completion and the StatusTray popover now show the same control — a dropdown with a status dot per provider — instead of a segmented toggle.

- **The 494 KB book opens in ~3 seconds again.** A regression introduced during this branch (the editor's CSS `zoom` property was applied unconditionally and put every descendant in a slow layout-containment path) is fixed. The conditional zoom only applies when actually zoomed.

### Fixes

- **Width / alignment values stop disappearing after a tab-switch.** The worker that parses markdown for tab-switch and file-load was missing the `blockWidth` / `align` attribute slots on its chart, drawing, and link-preview shims, so ProseMirror's DOMParser silently dropped those attributes during reload. Schemas now mirror the production extensions; new regression test catches future drift.

- **Editor no longer crashes when you insert a chart, drawing, or link preview.** PR #173 shipped a `<Tooltip>` outside any `<TooltipProvider>` — the editor's error boundary caught it on every block render. New design-system rule documents that every `<Tooltip>` must be inside a `<TooltipProvider>`, with a regression test that covers the four reference implementations.

- **Reopening a doc no longer scrolls "a few paragraphs down" before snapping to the right place.** The viewport cache only captured `scrollY` 5 seconds after an *edit*, so if you scrolled to the top without editing, the cache restored the old pre-scroll position on reopen. Now restores from the live saved ratio (tracked on every scroll, debounced 150 ms).

- **`Cmd+-` no longer toggles raw markdown mode on Swedish keyboards.** The source-mode chord was matching the physical key position (`event.code === "Slash"`), which on Swedish ISO is the `-` key. Now matches the produced character; Nordic `Shift+7` fallback for true `Cmd+/` preserved.

- **Image markdown serializer closes the block correctly.** Without the trailing `\n\n`, the next heading was concatenated to the same line and its `#` got backslash-escaped — corrupting the saved file.

## Known issues — deferred to next alpha

- **Image hover toolbar.** Width / alignment can't be set on images yet via hover controls; markdown round-trip works, but the popover doesn't appear on hover. We're investigating why the editor-level `mouseover` listener isn't firing on the image NodeView in production builds despite passing isolated tests.

- **Toolbar `Cmd+Shift+L/E/R` doesn't align embedded blocks (chart / drawing / image / link-preview).** A clean unification on the TextAlign extension's `textAlign` attribute caused the streaming-hydrate regression, so toolbar align is currently scoped to text nodes only. We're planning a custom command (no global `addAttributes` expansion) for the next alpha.

## Under the hood

PRs / commits since v0.43.0 on branch `fix/post-merge-test-findings`:

- `0da4b00f` chart/drawing/link-preview block-size persistence + worker shim fix (#173)
- `0d5ba65` zoom chord scope, Swedish keyboard collision, embedded-block breathing room (#188)
- `33e1ef59` HtmlViewer rewrite — sanitised inline render via DOMPurify (#169)
- `799582ae` StatusTray completion picker → dropdown (#181)
- `408f1894` image block-size hover controls + persistence (later partially reverted for perf)
- `f1548d4e` image alignment auto-default width
- `c2d6f55` unified alignment via TextAlign expansion (later reverted for perf)
- `ad8d1362` perf: conditional CSS zoom + image vanilla DOM revert
- `2c9eb9f1` scroll-restore-from-saved-ratio fix
- `ba4fe785` revert TextAlign expansion (perf bisect — confirmed cause of 494 KB book slowdown)
- `19b9fdb5` revert image React NodeView restore (perf bisect — confirmed contribution to slowdown)
- `20707bdc` image markdown serializer adds trailing block separator

### Performance bisect — large file regression

The 494 KB Swedish investment book regressed from ~3 s to ~12 s during this branch. Two contributing causes were identified by manual bisect:

1. **CSS `zoom` applied unconditionally** on the editor wrapper. WebKit treats `zoom: 1` as a transform context and switches every descendant into a slower layout-containment path. Fixed in `ad8d1362` by spreading the style only when the value is actually != 1.
2. **TextAlign extension's `addGlobalAttributes` expansion to include image / chart / drawing / linkPreview** added a `textAlign` attribute slot to those types schema-wide, which inflated the parsed JSON shape and slowed `streamingHydrate`'s `setContent` calls. Reverted in `ba4fe785`.

Confirmed by the user's perf logs going from `streamMs: 12054` → `streamMs: 2186` after the partial revert, and back to ~12 s when the image React NodeView was briefly restored in `43997b4f` (also reverted in `19b9fdb5`).

### Files Changed

~22 files across 14 commits.
