# Release v0.53.0

**Date:** 2026-08-24
**Previous version:** 0.52.1

A new app icon.

## Changes

### Features

- **A new app icon.** The letterform stays; everything around it is new. The
  editor's own preview sentence sits above and below it, faint enough to read
  as texture, and the agent orb sits below — the same mark the app shows while
  something is running. The ground is darker and a touch warmer.

### On the iPhone app

Shipped to TestFlight during this cycle; part of the phone app, not the Mac
app.

- **Notes saved as Markdown keep their pictures.** They work offline and show
  their own photograph in gallery view, the way HTML captures already did.
- The phone icon carries no orb — nothing agentic runs there — and the launch
  screen finally matches the app icon instead of showing the old plain letter.
  That last one took two attempts: TestFlight build 13 shipped the new icon
  with the old splash, because the launch logo has a canonical committed source
  under `src-tauri/ios/LaunchAssets/` that the build re-applies over the
  generated catalogue every time, and the render was writing the generated copy.
  Fixed in build 14.

## Under the hood

- **Honest about the size of this one:** for someone on the Mac, this release is
  the icon. The Markdown capture work is iOS-only, and everything else since
  0.52.1 is pipeline and test infrastructure. It is a minor because the icon is
  a deliberate, visible change, not because much else moved.
- `icons/icon.svg` is now the source of truth and the 50 platform files are
  generated from it by `scripts/render-app-icon.mjs` plus `tauri icon`. The
  script inlines the bundled Source Serif 4 as a data URI before rasterising:
  the letterform is a `<text>` element, so without that the shipped icon would
  be whatever serif existed on the build machine and would differ between a
  laptop and CI.
- Three variants share one ground and one type treatment — `icon.svg` (idle
  orb), `icon-active.svg` (lit orb, for a possible runtime Dock swap, not
  wired up), `icon-ios.svg` (no orb). The two desktop files share *identical*
  orb geometry so a future swap changes colour and never shape; an icon that
  changes shape in the Dock reads as a glitch.
- The iOS asset catalogue is written from `icon-ios.svg` after `tauri icon`
  runs, because `tauri icon` writes one artwork to every platform — the
  desktop icon would otherwise land on the phone. Required sizes are read from
  `AppIcon.appiconset/Contents.json` rather than a hardcoded list.
- **A capture pipeline contract** (`notesage-capture/tests/pipeline_contract.rs`).
  A capture crosses builder → FFI → Swift → saved file → sweep → inliner →
  thumbnail, and only the builders were tested. Two contracts now cover the
  chain, and both found live defects the day they were written: `article_lead_image`
  scanned only for the HTML form of an inlined image, so a Markdown capture's
  picture sat in the file and was never looked for; and **X capture is
  unreachable** — `build_x_note` and `x_syndication_url` are written and
  unit-tested with no FFI export and no caller.

## Known

- **X posts saved as HTML get no gallery thumbnail.** X articles still save,
  because generic extraction happens to work on X's server-rendered pages, but
  the metadata path carrying the title, author and cover image is never called.
  Recorded and enforced by the contract test above; not yet fixed.
- The macOS Share Extension remains experimental, and has no rendered DOM
  (macOS has no `NSExtensionJavaScriptPreprocessingFile`), so on lazy-loading
  sites it captures placeholder images where iOS captures the real ones.
- The app icon is full-bleed to its rounded rect, matching the previous one.
  Apple's macOS template insets the art within the canvas, so it sits very
  slightly large next to its neighbours in the Dock.

## Files Changed

- The icon sources and their render script, the generated platform icon sets,
  the Markdown capture sweep, and the capture pipeline contract test.
