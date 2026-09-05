# PRD: Notifications on iOS — badge, background refresh, and the Mac's side

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | ✅ Implemented (2026-09-05); device verification pending |
| **Priority** | Medium |
| **Impact** | The phone's app icon carries the unread Inbox count and, best effort, announces items that arrived from the Mac; the Mac announces captures that arrived from the phone. |
| **Tasks** | [ios-notifications-tasks](../tasks/2026-09-05-ios-notifications-tasks.md) |
| **Precedent** | `docs/features/inbox.md` (the shared read-later state), `docs/features/mobile.md` (the native plugin, `integrate-share-extension.py`) |
| **Related** | `docs/prds/2026-09-05-ios-recordings.md` (phone recordings in `Recordings/`, transcribed by the Mac — see "Two consequences" and Decision 11) · `docs/prds/2026-09-05-icloud-container-library.md` (changes how the root resolves; this PRD only ever goes through `LibraryAccess.resolveRoot`, so it inherits that change) — both drafted in parallel, neither a dependency |

The ask, verbatim: *"add notifications, eg new inbox item, new recording,
transcription done,…"*

## Problem

The Inbox is a two-device read-later list, but each device only learns what
the other did when the user goes looking. On the phone, a capture filed from
the Mac — or a transcript the Mac finished for a file the phone shared — sits
in the Inbox until the app is opened; nothing on the home screen says there is
anything to read. On the Mac, a link shared from the phone lands in `Inbox/`
silently: the sidebar badge updates (the folder is watched), but only if the
sidebar is showing and the user happens to look at it.

The honest constraint, stated up front so the design is built on it rather
than discovered by it: **Notesage has no server.** There is nothing that can
push to the phone. The phone can only announce what it observes for itself,
and iOS lets an app observe things while backgrounded only on the system's
schedule, in short bursts, and never at all in some states. Every claim below
is graded against that.

## What the phone can and cannot know

| Mechanism | What it gives | When it runs | Verdict |
| --- | --- | --- | --- |
| **`BGAppRefreshTask`** (Background App Refresh) | ~30 s of execution to list the Inbox and compare it with what the user last saw. | When iOS decides — typically minutes to hours after the app was last used, more often for apps used daily, never in Low Power Mode, never when the user disabled Background App Refresh for the app, and **never after the user force-quit the app** until they launch it again. | **Ship it, as best effort.** It is the only background execution an app without a server gets, and it is enough to update a badge and post "3 new in Inbox" some time after the Mac did something. It is not a delivery guarantee and the UI must never imply one. |
| **iCloud Drive itself** | The new file's *metadata* (a `.name.icloud` placeholder) appears in the granted folder without our app doing anything — `bird` syncs iCloud Drive independently of Notesage. `LibraryAccess.children` already presents placeholders under their real names. | Continuously, on the system's own network/power policy. | **Relied on.** A background listing sees new items as placeholders without downloading them; counting is enough. Whether metadata sync is itself throttled while our app is inactive is the one thing a spike must measure (task #1), not assume. |
| **`NSMetadataQuery`** with `NSMetadataQueryAccessibleUbiquitousExternalDocumentsScope` | Live change events for document-picker-granted iCloud folders. | **Only while the app process is alive** — it cannot wake the app. | **Not for notifications.** Worth a later phase for a live Inbox listing while the app is in the foreground (today `visibilitychange` reloads on return). Out of scope here. |
| `NSUbiquitousKeyValueStore` | Key-value sync between devices. | Foreground only; no wake. | Not applicable. |
| APNs / CloudKit subscriptions | The only *reliable* wake: a silent push. | Whenever the sender says. | **Non-goal.** Needs a server — CloudKit is Apple's server, but the Mac would have to write a `CKRecord` per capture and the phone would need a push entitlement. That is a different product decision; recorded so nobody re-derives it. |
| `UNUserNotificationCenter` local notifications | Banners and badge, posted by the app process or by an app extension. | Any time the posting process runs. | **Ship it.** The background task and the Share Extension both post/update through it. |
| App icon badge (`setBadgeCount`, iOS 16+) | A number on the icon. | Any time; **usable from the Share Extension too**, which is what keeps the badge right after the phone's own capture. | **Ship it.** The badge is the unread Inbox count read from disk, so it is correct whenever it is refreshed and merely stale in between. |

Two consequences that shape everything:

1. **"New item from the Mac" and "Mac finished transcribing" cannot wake the
   phone reliably.** They show as a badge and a banner *when the next
   background refresh happens to run*, and otherwise on next open. This is
   the platform, not a gap in the implementation.
2. **Everything the Mac produces for the phone is a file arriving in a
   shared folder, seen by the same diff.** A capture filed from the Mac, a
   document dropped into `Inbox/` from Finder, a transcript the Mac writes
   back beside a phone recording (`docs/prds/2026-09-05-ios-recordings.md`
   puts those in `Recordings/<bundle>/transcript.md`, not in `Inbox/`) — all
   are "a file the user has not seen". Phase 1 diffs `Inbox/` only, because
   that is where the badge's number comes from; the seen-set mechanism is
   written so that adding `Recordings/` to the diff, once that PRD ships, is
   a second folder in the same loop — not a second notification system.
   There is no per-kind notification.

## Goals / Non-Goals

### Goals

- **The app icon shows the unread Inbox count** — the same number the Mac
  sidebar badge shows, computed from the same file, refreshed at every
  opportunity the phone gets (foreground, listing, the phone's own capture,
  background refresh).
- **Items that arrive while the phone is away are announced once**, as "N new
  in Inbox", by a background refresh — best effort, honestly labelled, never
  stacked, never repeated for the same items.
- **The Mac announces new Inbox arrivals** through its existing notification
  path, whether they came from the phone or from its own Share Extension, and
  clicking the notification opens the Inbox.
- **Permission is asked when it means something**: never on first launch,
  only after the Inbox has received its first item, from a pre-prompt the user
  can decline without burning the one system prompt iOS allows.
- **Every toggle is where the app keeps preferences**: the phone's root
  `UIMenu`, the Mac's Settings → System → Notifications.

### Non-Goals

- A server, APNs, or CloudKit push (see the table).
- A "Saved to Inbox" banner from the Share Extension. The sheet already
  confirms the save (`finish()` closes it; documents show "✓"); a banner for
  something the user did one second ago is noise, and Apple's own Notes and
  Reminders post none. The extension updates the **badge** instead, silently.
- A notification when read-aloud finishes. Audio stopping is its own signal,
  and the lock-screen plate goes idle; a banner would compete with the player
  that just ended.
- A notification for a transcript that arrived from the Mac *observed on
  foreground* — by definition the user is already looking. The badge and the
  Inbox's unread marker carry it.
- A Mac Dock badge for unread Inbox items. The sidebar badge exists; a Dock
  number for read-later items nags. Reconsider only if asked.
- Provisional authorization (quiet delivery without a prompt). "3 new in
  Inbox" delivered silently into a Notification Center nobody opens is the
  worst of both, and it grants no badge.
- Live foreground updates via `NSMetadataQuery` (a later phase).
- Any per-item or per-kind notification (per capture, per transcript); the
  batch summary is the whole design.

## User Stories

- As a phone user, I want the app icon to show how many unread items my Inbox
  holds, so that I know there is something to read without opening the app.
- As a phone user who shares a link from Safari, I want the badge to go up
  immediately, so that the number is right the moment I return to the home
  screen — and I do **not** want a banner telling me what I just did.
- As a phone user, I want to be told "3 new in Inbox" some time after my Mac
  filed three things, so that I can read them on the train — and I accept
  that "some time" is up to iOS.
- As a phone user, I want the first permission prompt to appear only once
  something has landed in my Inbox, with a sentence explaining what it is for,
  so that I am not asked to allow notifications from an app I have not used
  yet.
- As a phone user, I want to turn the badge and the banners on and off
  separately, from the same menu every other preference lives in.
- As a Mac user, I want a notification when a capture arrives from my phone,
  so that a link I shared on the way home is one click away when I sit down —
  unless I am already looking at the Inbox.
- As a Mac user, I want to switch that off in Settings like the other
  notifications.

## Technical Approach

### Own the notification layer natively — and unregister Tauri's on iOS

`lib.rs` registers `tauri_plugin_notification::init()` on every platform. Its
iOS Swift (`NotificationManager.swift`, v2.3.3) takes over
`UNUserNotificationCenter.current().delegate` at init and, in both
`willPresent` and `didReceive`, resolves the notification through
`notificationsMap[request.identifier]!` — a force-unwrap of a map that holds
only the notifications *that plugin* scheduled in *this* process lifetime. A
banner posted by our background task, one posted by the Share Extension, or a
tap on any notification after a relaunch would crash the app in that delegate.

Therefore:

- The `.plugin(tauri_plugin_notification::init())` registration becomes
  `#[cfg(not(target_os = "ios"))]`. The Cargo dependency stays (its permission
  files are still generated, so `capabilities/default.json` keeps validating);
  nothing on the iOS frontend imports `@tauri-apps/plugin-notification`
  (`src/lib/notifications.ts` is desktop-only, reached through desktop hooks).
  A source-shape test locks the cfg, in the style of
  `ios_library.rs`'s `every_ios_command_sanitizes_its_path`.
- The notification layer lives in `tauri-plugin-notesage-ios`'s Swift package,
  beside `SpeechPlayer.swift`, and is the sole `UNUserNotificationCenterDelegate`.

### One Swift source of truth, compiled into both targets

`InboxState.swift` — added to the plugin package **and** to the Share
Extension target by `integrate-share-extension.py`, exactly as
`LibraryAccess.swift` is — answers three questions from disk, with no
JavaScript running:

- `names()` — the files in `Inbox/` (placeholder-aware, dotfiles excluded,
  directories excluded — the desktop's `load()` counts files only).
- `unreadCount()` — names whose sidecar entry is missing, a tombstone, or has
  `openedAt: null`. This is `isUnread` from `src/lib/reading-progress-file.ts`
  transcribed; a vitest source-shape test keeps the two rules in step, since
  there is no XCTest harness in the repo (#590).
- `unseen()` — names not in the **seen set**, the list of Inbox names the user
  is known to have had in front of them.

The seen set and the two preferences live in the App Group `UserDefaults`
(`group.com.notesage.app`), the store the extension already shares with the
app for the bookmark, so all three processes — app, background task,
extension — read one truth.

### The background refresh

- **Identifier** `com.notesage.app.inbox-refresh`; Info.plist gains
  `BGTaskSchedulerPermittedIdentifiers` and `UIBackgroundModes: fetch`, both
  written by `integrate-share-extension.py` next to the existing `audio` mode
  (the app's plist is generated; the script is the one place it can be
  patched durably).
- **Registration** must complete before the app finishes launching. The plugin's
  `load(webview:)` runs inside tao's launch transition on iOS
  (`did_finish_launching` → `StartCause::Init` → Tauri `setup` → webview →
  plugin load), which *should* be early enough; task #1 proves it on a device
  and, if iOS asserts, falls back to a load-time constructor in the plugin
  crate that calls a `@_cdecl` Swift registration before `UIApplicationMain`.
- **Scheduling**: a `BGAppRefreshTaskRequest` with `earliestBeginDate` 15 min
  out is submitted on `UIApplication.didEnterBackgroundNotification` and again
  at the end of every run. iOS ignores anything earlier and may run it much
  later.
- **The run**, under an expiration handler and a 20 s self-imposed budget:
  resolve the grant (`LibraryAccess.resolveRoot`; a stale bookmark ends the run
  cleanly) → `InboxState` → if the badge preference is on, `setBadgeCount(unread)`
  → if the banner preference is on and `unseen` is non-empty and differs from
  what was last announced, post **one** notification with the fixed identifier
  `inbox-new` (so a later run *replaces* it rather than stacking) → record what
  was announced → `setTaskCompleted(success:)`. The seen set is **not** updated
  by the task — the user has not seen anything yet; it is updated when the app
  is next in the foreground, which is also when the delivered `inbox-new`
  notification is removed from Notification Center.
- **Logging** under `subsystem com.notesage.app, category refresh`, readable
  with `idevicesyslog` the way `SpeechPlayer` is, so a run that did nothing
  can say why (no grant, refresh denied, nothing unseen).

### The badge is refreshed wherever the truth can change

| Moment | Who refreshes | How |
| --- | --- | --- |
| App foreground / root or Inbox listing | frontend → `ios_inbox_unread_count` | native recount from disk; marks all current names seen; removes the delivered `inbox-new` notification |
| After the phone's progress push (`pushInboxProgress`) | frontend → the same command | the sidecar just changed |
| After delete / move of an Inbox item | frontend → the same command | the listing just changed |
| Share Extension capture written | extension, natively | `setBadgeCount` + adds its own name to the seen set, so the next refresh does not announce the item the user just shared |
| Background refresh | task, natively | as above |

The Mac marking an item read (or unread) reaches the phone's badge at the next
of these — stale in between, which is the documented limit.

### Permission timing and the pre-prompt

- Never on first launch, never on an empty Inbox. When the Inbox listing is
  shown with at least one item, authorization is `.notDetermined`, and the
  pre-prompt has not been declined, a card at the top of the Inbox listing
  offers **Turn on** / **Not now**. Only **Turn on** calls
  `requestAuthorization([.badge, .alert])` — no `.sound`; a read-later list
  should not ding. **Not now** is remembered (persisted) and never re-shown
  automatically; the menu rows remain.
- A grant turns both preferences on. A denial leaves the menu showing
  "Notifications are off in Settings" as a row that opens the Settings app
  (`UIApplication.openSettingsURLString`); iOS will not show the system prompt
  twice.
- Background App Refresh off (`backgroundRefreshStatus == .denied`) is shown
  the same way — a row, not an alert — because it silently disables the whole
  "while away" half and the user should be able to see that from the app.

### The Mac's side

The desktop already watches `Inbox/` and reloads on `file-changed-batch`
(`InboxSection.tsx`), but that listener lives in the sidebar, which unmounts on
⌘⇧L — the surface-scoped-listener class of bug. The watch and the listener
move to an always-mounted `useInboxArrivals` hook in `App.tsx`
(`project_always_mounted_listeners`); `InboxSection` keeps only rendering.

The hook diffs `inbox-store.items` across loads. The first load is the
baseline (startup must not announce a backlog); every later load that adds
names produces **one** notification through `notify("inbox_capture", …)` in
`src/lib/notifications.ts` — "New in Inbox: *Title*" for one, "3 new in Inbox"
for several — gated on a new `notifyInboxCaptures` setting (default **on**:
arrivals are rare and wanted, unlike external-change chatter), and suppressed
when the window is focused *and* the Inbox view is open. Clicking it calls
`openInbox()` and focuses the window through the existing `onAction`
pattern in `useSessionManager`. The Mac's own Share Extension captures are
indistinguishable from the phone's on disk and are announced too — a deliberate
choice: the desktop sheet closes at once, and "it landed" is worth one banner.

## UI/UX

**Phone — Inbox listing, pre-prompt card** (only when the conditions above
hold): a `bg-muted/60` rounded card matching `InboxCard`'s geometry — title
"Know when new items arrive", one line "A badge on the app icon, and a notice
when something arrives from your Mac", two text buttons *Turn on* (accent) /
*Not now* (muted). No system prompt until *Turn on*. Both strings in `en` and
`sv` (`src/lib/i18n.ts`).

**Phone — root top-right `UIMenu`**, new section after the image rows:

- *Badge unread count* — checkmark row.
- *Notify about new items* — checkmark row.
- When authorization is `.denied`: a single row *Notifications are off in
  Settings…* replacing both, opening Settings.
- When Background App Refresh is off: an informational row *Background
  refresh is off in Settings…*, opening Settings, shown beneath the two.

Tapping either checkmark row while authorization is `.notDetermined` requests
it (this is the "from Settings" route the ask names).

**Phone — `InboxCard`**: the right-hand number becomes the **unread** count in
`--color-accent-primary` when it is greater than zero, else the total in muted
— the same number as the icon badge, from the same native call.

**Phone — the banner**: title *New in Inbox*; body the item's title for one,
"*Title A*, *Title B* and 3 more" for several. Tapping opens the app on the
Inbox (warm: a `notesage:notification` `CustomEvent` → `jumpToFolder`; cold:
the native side keeps the route until the frontend consumes it after the grant
resolves). Banner text is localized by the **frontend**, which owns the
translation table (#705 pattern): the templates are handed to native with the
preferences and stored beside them, so the background task and the extension
can post in the user's language without a resource bundle in the plugin.

**Mac — Settings → System → Notifications**: a third `SettingsRow` *New Inbox
items* under the existing two, same `Switch`.

**Mac — the notification**: title *New in Inbox*, body as above; click opens
the Inbox.

States: no grant → nothing (no badge, no task work); refresh denied → the row;
authorization denied → the row; empty Inbox → badge 0 (cleared) and no
pre-prompt.

## Data Model

App Group `UserDefaults` (`group.com.notesage.app`), all keys prefixed
`notesage.notify.`:

| Key | Type | Meaning |
| --- | --- | --- |
| `badge` | Bool | Badge preference |
| `newItems` | Bool | Banner preference |
| `seen` | [String] | Inbox names the user has had in front of them |
| `announced` | [String] | Names covered by the currently delivered `inbox-new` notification |
| `templates` | [String: String] | Localized banner strings from the frontend (`title`, `one`, `many`) |

Tauri commands (iOS-only seams in `ios_library.rs`, desktop stubs error as
the rest do; registered in both `generate_handler!` lists; added to
`mobile-app.test.tsx`'s `ALLOWED` set; documented in `docs/tauri-commands.md`):

```rust
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    pub authorization: String,      // "notDetermined" | "denied" | "authorized"
    pub background_refresh: String, // "available" | "denied" | "restricted"
    pub badge: bool,
    pub new_items: bool,
}

ios_notification_status() -> NotificationStatus
ios_notification_request() -> NotificationStatus            // the system prompt
ios_notification_set_prefs(badge: Option<bool>, new_items: Option<bool>,
                           templates: Option<HashMap<String, String>>) -> NotificationStatus
ios_inbox_unread_count() -> u32   // recounts from disk, refreshes the badge, marks seen
ios_consume_launch_route() -> Option<String>  // "inbox" once, then None
ios_open_settings() -> ()
```

`mobile-store` (persisted parts marked): `notifications: NotificationStatus |
null`, `unreadInbox: number`, `notificationPrePromptDismissed: boolean`
(persisted), and the actions `refreshNotificationStatus`,
`requestNotifications`, `setNotificationPref`, `refreshUnread`.

`settings-store` (desktop): `notifyInboxCaptures: boolean` (default `true`,
migration sets it when absent, like `notifyPermissionRequest`);
`NotificationType` in `src/lib/notifications.ts` gains `inbox_capture`.

## Dependencies

- iOS 16 deployment target (already: `Package.swift`, `tauri.ios.conf.json`)
  for `UNUserNotificationCenter.setBadgeCount(_:)` from the extension.
- `integrate-share-extension.py` for both plist keys and for compiling
  `InboxState.swift` into the extension target.
- A physical device with Xcode attached for background-task verification:
  the simulator never runs `BGAppRefreshTask`; runs are forced with
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.notesage.app.inbox-refresh"]`.
- No new entitlements: local notifications need none; there is no
  `aps-environment` because there is no push. The App Store privacy answer
  ("Data Not Collected", `docs/app-store/app-privacy.md`) is unchanged.

## Quality Gates

Outcome-shaped — run the scenario, on a device, before calling any of it done
(`feedback_outcome_shaped_criteria`, `feedback_verify_ios_in_simulator_first`
for everything the simulator can show, a device for the rest).

**Phone**

- [ ] Fresh install, first launch, grant the folder, browse: **no** permission
      prompt and no pre-prompt appears anywhere (App Review demo path,
      `docs/features/mobile.md` → "App Review notes", stays prompt-free).
- [ ] Share one link from Safari, open the app, open the Inbox: the pre-prompt
      card is there. *Not now* → it is gone, and stays gone across relaunches;
      the menu still offers the two rows.
- [ ] *Turn on* → the system prompt, once. Allow → both menu rows are checked,
      the icon badge shows the unread count within a second of returning to
      the home screen.
- [ ] Share a second link: the badge increments **before** the app is opened,
      and no banner appears for it (the extension's own capture is seen, not
      announced).
- [ ] Read one item to the end on the phone → badge drops by one within ~2 s of
      leaving the article (after the sidecar push).
- [ ] Mark an item unread on the Mac, foreground the phone → badge rises by
      one.
- [ ] File two captures from the Mac, lock the phone, force a background run
      from Xcode: exactly **one** banner, "2 new in Inbox" with both titles;
      badge = unread count. Force a second run with nothing new: no second
      banner. File a third, force again: the banner is *replaced* by "3 new in
      Inbox", not stacked.
- [ ] Tap the banner with the app killed → the app launches on the Inbox. Tap
      it with the app in the background → the Inbox, no relaunch. In both
      cases the banner is cleared from Notification Center and the seen set
      catches up (a further forced run announces nothing).
- [ ] Deny the system prompt → the menu shows the single *off in Settings…*
      row, which opens the Settings app; badge stays clear; a forced background
      run logs `authorization denied` and posts nothing.
- [ ] Turn Background App Refresh off for Notesage in Settings → the menu shows
      the refresh row; a submitted task never runs (log shows the
      `denied` status at scheduling); turning it back on resumes.
- [ ] Turn *Badge unread count* off → badge clears immediately; *Notify about
      new items* off → a forced run updates nothing but the badge.
- [ ] Revoke the folder grant (Onboarding re-pick path) → the forced run ends
      cleanly with `no grant`, no crash, badge untouched.
- [ ] Every one of the above with the device in Swedish shows Swedish strings
      in the card, the menu and the banner.

**Mac**

- [ ] App running, sidebar hidden (⌘⇧L), Safari frontmost: share a link from
      the phone → one notification "New in Inbox: *Title*" arrives when the
      file syncs; clicking it focuses Notesage with the Inbox open.
- [ ] Inbox open and window focused: the same share produces **no**
      notification; the list updates.
- [ ] Startup with 12 items already in the Inbox → no notification.
- [ ] Three captures syncing within the watcher's debounce → one notification,
      "3 new in Inbox".
- [ ] Settings → System → Notifications → *New Inbox items* off → nothing,
      list still updates.

**Code**

- [ ] `pnpm typecheck`, `pnpm test`, `cargo check` (with the pkg-config stubs)
      green; the new commands are in `ALLOWED` and the iOS `generate_handler!`
      list; `mobile-app.test.tsx` proves the pre-prompt does not render on an
      empty Inbox.
- [ ] A source-shape test fails if `tauri_plugin_notification::init()` is
      ever registered on iOS again, and another if `InboxState.swift`'s unread
      rule drifts from `isUnread`.
- [ ] `pipeline_contract.rs`-style check: every capture writer in
      `LibraryCapture.swift` records its own capture as seen.
- [ ] The built `.app`'s Info.plist contains `fetch` and the task identifier
      (asserted by the integration script, not eyeballed — an absent key
      fails silently at runtime).
- [ ] Docs updated: `docs/features/mobile.md` (a "Notifications" section and
      the App Review "Permissions" paragraph, which currently states no
      notification permission exists), `docs/features/inbox.md`,
      `docs/tauri-commands.md`, `docs/app-store/testflight-whats-new.md`.
- [ ] A TestFlight build is cut with the feature
      (`feedback_ship_testflight_dont_ask_for_testing`).

## Decisions

1. **Own the iOS notification layer; unregister `tauri-plugin-notification`
   on iOS.** Its delegate force-unwraps a map it alone fills; any notification
   posted natively or tapped after a relaunch would crash. Cargo dependency
   stays so the capability file keeps validating.
2. **Ship `BGAppRefreshTask`, labelled best effort.** It is the only
   background execution available without a server; the PRD, the docs and the
   UI copy never call it reliable. Force-quit, Low Power Mode and a disabled
   Background App Refresh all silently stop it, and the menu shows the last.
3. **No server, no push, no CloudKit** — the only reliable route, and a
   separate product decision. Recorded, not planned.
4. **The badge is the unread count read from disk**, by one Swift helper
   compiled into the app and the extension, so the icon, the `InboxCard` and
   the Mac sidebar all show the same number for the same file.
5. **One banner per batch, replaced not stacked**, fixed identifier
   `inbox-new`, body from a cumulative *unseen* set; the seen set advances only
   when the user has the app in front of them, and the delivered banner is
   cleared then.
6. **The Share Extension posts no "Saved" banner.** It updates the badge and
   marks its own capture seen, so the next refresh never announces something
   the user just shared.
7. **Permission is asked from a pre-prompt on the Inbox listing, after the
   first item, or from the menu — never on first launch.** *Not now* is
   permanent; a denial shows a Settings row instead of a second attempt.
   Authorization is `[.badge, .alert]` only — no sound.
8. **No notification for read-aloud finishing, for a transcript observed on
   foreground, or per item.** Everything from the Mac is an Inbox arrival;
   the batch summary and the badge cover it, including the planned
   transcript-return path, with no special case.
9. **Preferences and seen state live in the App Group `UserDefaults`**, the
   store the extension already shares; banner strings come from the frontend's
   translation table (#705 pattern) rather than a resource bundle in the
   plugin package.
10. **The Mac notifies on every new Inbox arrival**, its own extension's
    included, unless the Inbox is open in the focused window; default on; the
    watcher moves out of the sidebar into an always-mounted hook. No Dock
    badge.
11. **"New recording" and "transcription done" are not phone-side events
    today** — recording and Whisper are desktop-only. The parallel
    `ios-recordings` PRD adds phone capture into `Recordings/` with the Mac
    transcribing; when it lands, a finished recording needs no notification
    (the user just stopped it), and a transcript arriving from the Mac is
    observed on next foreground (its status flips in the bundle — a banner
    then would be pointless) or, best effort, by extending the background
    diff to `Recordings/` under this PRD's seen-set rule. That extension is
    that PRD's follow-up, not part of Phase 1, and the icon badge stays the
    unread **Inbox** count either way.
12. **The root is always resolved through `LibraryAccess.resolveRoot`** —
    in the app, the background task and the extension — so the parallel
    `icloud-container-library` PRD's change of what the root *is* needs no
    change here. One caveat it introduces is budgeted for in the task (#5):
    a first `url(forUbiquityContainerIdentifier:)` call can block for
    seconds, and a background run has 30.

## Out of Scope

- Live Inbox updates in the foreground via `NSMetadataQuery`
  (`NSMetadataQueryAccessibleUbiquitousExternalDocumentsScope`) — the
  `visibilitychange` reload covers the return-to-app case; a later phase.
- Notification actions ("Mark all read" from the banner), rich previews with
  the lead image, grouped threads per source site.
- Badge on the Mac Dock; Mac notifications for reading progress, filing,
  deletion.
- Android.
- A `BGProcessingTask` for the image sweep (`useInlineSweep`) — tempting once
  the scheduler exists, but a different feature with its own budget and
  network questions.

## Open questions — to be closed by the spike (task #1), not by assumption

1. Does `BGTaskScheduler.register` succeed from the plugin's `load(webview:)`
   under Tauri's launch sequence, or does iOS assert that launch has finished?
   Fallback designed (a load-time constructor in the plugin crate), chosen
   only if the assertion fires.
2. Does a capture written on the Mac appear as a placeholder in the granted
   folder's listing during a background run, without the app having been
   foregrounded since? Measure with real captures and forced runs at 5, 15 and
   60 minutes; the answer bounds what "best effort" means in the docs.
3. Does `setBadgeCount` from the Share Extension apply with `[.badge, .alert]`
   authorization granted to the containing app? Expected yes on iOS 16+;
   verified, not assumed.
