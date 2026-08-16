# Screenshots

Store submission only — **TestFlight needs none**, internal or external.

## What Apple requires

You must supply one set; the rest are derived by Apple if you let them.

| Display | Size (px, portrait) | Devices | Required? |
| --- | --- | --- | --- |
| 6.9" | 1320 × 2868 | iPhone 16 Pro Max, 15 Pro Max | **Yes** — the primary set |
| 6.5" | 1242 × 2688 | iPhone 11 Pro Max, XS Max | Only if 6.9" is not supplied |
| 13" iPad | 2064 × 2752 | iPad Pro | Only if the app is offered on iPad |

Between 3 and 10 per set. The first two are what people actually see in
search results — treat those as the whole pitch.

**iPad:** if the app ships iPhone-only, no iPad screenshots are needed. Decide
this deliberately: the app runs on iPad, but the layout has had no iPad pass
(the grid is fixed at three columns), so shipping iPhone-only first is the
honest option.

## Shot list

In order. Each should show real content, not lorem ipsum — a screenshot of an
empty app sells nothing.

1. **The library, list view.** Inbox pinned at the top with a count, a few
   folders with counts beneath. Shows the shape of the whole app in one frame.
2. **A note open.** A markdown note with a heading, a callout, and a code
   block — the rendering is the product.
3. **Gallery view.** The grid of note thumbnails; visually the most
   distinctive screen.
4. **The share sheet capture card.** Sharing a link from Safari, format picker
   visible. This is the feature nobody expects and everybody likes.
5. **The long-press preview menu.** Preview card with the action panel below.
6. *(optional)* **A PDF or a mermaid diagram**, to make "reads everything in
   your library" concrete.

## Capturing them

The 6.9" set needs an iPhone 16 Pro Max — the simulator is fine and gives
exactly the right pixel size:

```bash
xcrun simctl list devices | grep "16 Pro Max"
xcrun simctl boot <udid>
xcrun tauri ios build --debug --target aarch64-sim   # or the release build
xcrun simctl install <udid> src-tauri/gen/apple/build/arm64-sim/Notesage.app
xcrun simctl io <udid> screenshot shot-1.png
```

Seed the simulator's library with real-looking notes first — the folder is
under
`~/Library/Developer/CoreSimulator/Devices/<udid>/data/Containers/Shared/AppGroup/*/File Provider Storage/`
once you have granted a folder in the app.

Check the status bar before submitting: `xcrun simctl status_bar <udid>
override --time "9:41" --batteryLevel 100 --cellularBars 4` gives the clean
Apple-style bar.

## Rules worth knowing

- No device frames with rounded corners drawn on — Apple wants the raw screen.
- No "Download now" style overlays or pricing.
- The screenshots must show the app as submitted. A screenshot of a feature
  the build does not have is a rejection.
