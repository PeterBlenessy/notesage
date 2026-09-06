# PRD: Native navigation for the iOS shell

|  |  |
| --- | --- |
| **Date** | 2026-09-06 |
| **Status** | Shipped behind the `native-shell` flag — TestFlight build 56, 2026-09-07. The flag defaults OFF until a push and a pop have been exercised on a device. |
| **Priority** | High |
| **Impact** | Leaving a document, or a folder, looks and feels the way iOS does it — at every level, with nothing hand-built |
| **Tasks** | [ios-native-navigation-tasks](../tasks/2026-09-06-ios-native-navigation-tasks.md) |
| **Precedent** | `docs/prds/2026-06-28-ios-mobile-app.md` (the shell this replaces the navigation of), ADR 0009 (native chrome), ADR 0010 (the report's own web view — the same re-parenting trick, one screen smaller) |
| **Flag** | `native-shell` (Labs), default on once the parity checklist below is green |
| **Issues** | #950 (the transition), the spike that preceded this |

## Problem

The owner, on build 55:

> Swipe to close an article works now but the UX is still rather poor. I expect
> the list to be displayed behind the article we are swiping away to close.
> Instead the area behind the article is black … We should aim for the same UX
> as Apple Notes.

and then, one step further back:

> Is it necessary for us to keep the lists in HTML? I mean, I get that some
> parts are common with the desktop app, but the lists and gallery???

The second question is the useful one, because the first is a symptom.
`MobileApp.tsx` renders exactly one of `HomeFolders` / `Reader` /
`LibraryBrowser` at a time, so when a document slides away it uncovers the
shell's own background — there is nothing behind it to reveal. Meanwhile the
chrome (back, breadcrumb, "…") is a UIKit overlay deliberately raised above
the web view, so it stays put while the content moves.

Everything expensive about this app's reader in the last month has been
navigation, not rendering:

- an edge-swipe gesture built by hand in the web layer (#923), then found to
  never receive a touch on a captured article, then built a **second** time
  natively (#947);
- a leaving-a-document transition (#950) that has to be written from nothing:
  parallax, dimming, spring-back, and the same treatment for the back button;
- taps swallowed by hosting views, chrome raised above content, insets
  re-derived per surface.

UIKit supplies every one of those, for free, at every level of a hierarchy.
The app is already a hybrid — native chrome, native context menus, a native
report web view, a native player and recorder — and navigation is the piece
still being hand-made.

## What ships

A real `UINavigationController` **is** the mobile shell, rooted at Home:

```
UINavigationController
├── Home            the folder cards
├── Folder listing  pushed; the Inbox is one of these
└── Document        the reader
```

Push, pop, the interactive edge-pop, the parallax, the dimming, the
spring-back, the back button and its title all come from UIKit. Nothing about
the gesture is ours any more.

## The decision that shapes this: what draws each screen

The spike proved the stack works, with SwiftUI lists behind it. The obvious
next step — port every list to SwiftUI — is **not** what this ships, and the
reason is the owner's own acceptance criterion:

> It must have the same features as the current version.

The browsing surface is not thin. List and gallery views, condensed density,
sort by name or modified, five grouping modes, type-to-filter, thumbnails,
reading-progress lines, unread weight, the Listen affordance, swipe actions,
long-press menus with rename/move/pin/share/delete/home-toggle, the create
menu, image-cache settings, the library switcher, notification preferences —
roughly 3,700 lines of TypeScript with 28 test files behind it. Reimplementing
that in Swift is a project measured in weeks, and every week of it is a week
where the app has *fewer* features than the one it replaces.

So this ships the stack, and keeps the web layer drawing the screens:

- **Navigation is native.** The stack is the source of truth. It pushes and
  pops; the web layer follows.
- **Screens are still React.** Every feature keeps working because it is the
  same code that already implements it.
- **Transitions use snapshots.** A push or pop needs two screens visible at
  once, and there is only one web view. The outgoing screen is captured as a
  `UIView` snapshot the instant before the transition; the live web view moves
  into the incoming controller and renders the destination. On the way back,
  the parent's cached snapshot carries the animation and is swapped for live
  content the moment the pop commits. This is the standard hybrid technique,
  and it is exactly what ADR 0010 already does one screen smaller: the report
  gets its own web view above the app's.

The alternative — SwiftUI lists — stays on the table and gets *easier* after
this, not harder: with the stack in place, screens can migrate one at a time,
each one a self-contained change with parity preserved on either side of it.
That sequencing is the point. Doing the stack first means never shipping a
version with fewer features than the last.

## Parity checklist (the acceptance criterion)

Every one of these works with the flag on, or the flag does not go on.

**Home**
- [ ] Folder cards: Inbox (with unread count), Recordings, chosen folders
- [ ] Empty-Home invitation when no folders are chosen
- [ ] Edit Home screen
- [ ] Create menu: note, folder, recording

**Folder listing**
- [ ] List view and gallery view
- [ ] Condensed density
- [ ] Sort by name / modified
- [ ] Group by none / pinned / recent / date / type
- [ ] Type-to-filter (search island)
- [ ] Thumbnails, reading-progress line, unread weight, Listen button
- [ ] Swipe actions on a row
- [ ] Long-press menu: share, pin, delete, show/hide on Home, listen, rename, move
- [ ] Folder rows show a child count and push

**Document**
- [ ] Markdown, plain text, PDF, image, and captured HTML reports
- [ ] The reader's own chrome: find, Listen/player, "…", edit
- [ ] Reading progress recorded on scroll
- [ ] Leaving returns to the folder it was opened from

**Everything else that must not regress**
- [ ] Recording bar and the recorder's lock-screen controls
- [ ] Speech player bar and its Now Playing controls
- [ ] Notification preferences and the Inbox badge
- [ ] Share-sheet capture into `Inbox/`
- [ ] Library switching (pick a folder, switch to the container)
- [ ] Onboarding, when no library is granted

## Non-goals

- Porting list rendering to SwiftUI. Deliberately deferred, per the decision
  above; the stack makes it a per-screen change later.
- The gallery as a native collection view. Same reason.
- Changing anything the desktop app does. This is the iOS shell only.

## Rollout

Behind `native-shell` in Labs, reachable from the "…" menu at Home (Labs is a
desktop Settings panel; the phone has no settings surface yet — #949). The
flag defaults **on** once the checklist above is green, so the next TestFlight
build is the native one, with the old shell one toggle away for as long as it
takes to trust it.
