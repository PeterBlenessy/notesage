# Tasks: Native navigation for the iOS shell

PRD: [2026-09-06-ios-native-navigation](../prds/2026-09-06-ios-native-navigation.md)

Ordered so the app is never worse than it was: the stack goes in behind a
flag, the web layer learns to follow it, and only then does the flag flip.

## 1. The stack — `NativeNavShell.swift` 🚧

Replaces `NativeShellSpike.swift`.

- `NavShellPresenter`: one `UINavigationController` added as a child of the
  app's root controller, over the web view's container.
- `ScreenController`: one per level. Holds either the LIVE web view or a
  snapshot of it, and knows which.
- Snapshot cache, keyed by screen id, taken on the way out of a screen.
- `push(id, title)` / `popTo(depth)` / `setTitle` / `dismiss`.
- The live web view moves to whichever controller is on top; every other
  controller shows its snapshot.

## 2. Bridge ⬜

- Plugin: `navShellPresent`, `navShellPush`, `navShellPop`, `navShellSetTitle`,
  `navShellSetMenu`, `navShellDismiss`.
- Events back: `didPop(depth)` — the only one that matters, since the system
  owns the gesture.

## 3. The web layer follows ⬜

- `useNativeNavShell`: mirrors `folderStack` + `openDoc` into pushes, and
  applies `didPop` to the store.
- While active: the web shell renders ONE screen (the top of the stack) and
  runs no transition of its own.
- Disable `useEdgeSwipeBack` and the report's native strip while active —
  one navigation system, not two.

## 4. Chrome moves to the navigation bar ⬜

- Title ← breadcrumb.
- Back ← system.
- Right bar button opens the existing "…" `UIMenu`, unchanged.
- Search island, player and recorder stay where they are (they are not
  navigation).
- `ChromeManager` islands hidden while the stack is up.

## 5. Parity pass ⬜

Walk the PRD checklist in the simulator, every state, both view modes.

## 6. Review ⬜

Full review of the diff; fix everything Critical/High; review again until
clean.

## 7. Ship ⬜

Flag on by default, tester notes, TestFlight.
