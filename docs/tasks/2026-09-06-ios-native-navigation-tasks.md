# Tasks: Native navigation for the iOS shell

PRD: [2026-09-06-ios-native-navigation](../prds/2026-09-06-ios-native-navigation.md)

Ordered so the app is never worse than it was: the stack goes in behind a
flag, the web layer learns to follow it, and only then does the flag flip.

## 1. The stack — `NativeNavShell.swift` ✅

Replaces `NativeShellSpike.swift`.

- `NavShellPresenter`: one `UINavigationController` added as a child of the
  app's root controller, over the web view's container.
- `ScreenController`: one per level. Holds either the LIVE web view or a
  snapshot of it, and knows which.
- Snapshot cache, keyed by screen id, taken on the way out of a screen.
- `push(id, title)` / `popTo(depth)` / `setTitle` / `dismiss`.
- The live web view moves to whichever controller is on top; every other
  controller shows its snapshot.

## 2. Bridge ✅

- Plugin: `navShellPresent`, `navShellPush`, `navShellPop`, `navShellSetTitle`,
  `navShellSetMenu`, `navShellDismiss`.
- Events back: `didPop(depth)` — the only one that matters, since the system
  owns the gesture.

## 3. The web layer follows ✅

- `useNativeNavShell`: mirrors `folderStack` + `openDoc` into pushes, and
  applies `didPop` to the store.
- While active: the web shell renders ONE screen (the top of the stack) and
  runs no transition of its own.
- Disable `useEdgeSwipeBack` and the report's native strip while active —
  one navigation system, not two.

## 4. Chrome moves to the navigation bar ✅

- Title ← breadcrumb.
- Back ← system.
- Right bar button opens the existing "…" `UIMenu`, unchanged.
- Search island, player and recorder stay where they are (they are not
  navigation).
- `ChromeManager` islands hidden while the stack is up.

## 5. Parity pass 🚧

Walk the PRD checklist in the simulator, every state, both view modes.

**Blocked overnight, and this is why the flag ships off.** The Mac's screen
locked while this was being built, so the Simulator had no window and could
not be driven — `simctl` reads the framebuffer either way, which is how the
presentation was checked, but nothing can tap. Every push and pop in this
change is therefore unexercised.

Verified without interaction:

- the stack presents: bar, title and the mirrored "…" render, with the live
  web view inside it;
- the web breadcrumb island is correctly gone;
- no spurious back item at the root;
- the app launches, lists and renders exactly as before with the flag off.

## 6. Review ✅

Two passes over the whole diff. Fixed:

- the web view sized from a rectangle about to change (pushed controllers are
  not laid out yet) — pinned with constraints instead;
- a lost `rendered` freezing a screen for ever — bounded by a two-second
  fallback thaw;
- `ios_nav_shell_pop` not compiling for iOS, which `cargo check` on macOS
  cannot see because it never compiles `#[cfg(target_os = "ios")]`;
- overlapping reconciles racing each other into a false drift, and the drift
  recovery then collapsing the stack to the root under a user who merely
  tapped twice — runs are serialised;
- the root-push race and the title-driven teardown, both found by reading
  rather than running.

## 7. Ship 🚧

Tester notes written, TestFlight build cut. Flag ships **off** — see task 5:
shipping an unexercised navigation rewrite as the default would risk exactly
what the brief forbids, an app with fewer working features than the last one.
It flips on once somebody has swiped it.
