# Tasks: Notifications on iOS — badge, background refresh, and the Mac's side

|  |  |
| --- | --- |
| **Date** | 2026-09-05 |
| **Status** | Not started |
| **PRD** | [ios-notifications](../prds/2026-09-05-ios-notifications.md) |
| **Total** | 17 tasks: 3S, 12M, 2L |
| **Suggested order** | De-risk (#1–#2) → Native core (#3–#8) → Phone UI (#9–#13) → Mac (#14–#15) → Ship (#16–#17) |

Legend: ✅ done · 🚧 in progress · (blank) pending.

## Risks and things to settle before building on them

- **#1 gates #5, #6 and #12.** If `BGTaskScheduler.register` cannot run from
  the plugin's `load(webview:)`, the fallback (a load-time constructor in the
  plugin crate) changes where #5's registration lives, not what it does. Do
  not start #5 until #1 has an answer from a device.
- **The simulator never runs a background refresh.** Every "forced run"
  below means a device with Xcode attached and
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.notesage.app.inbox-refresh"]`
  in the debugger. Budget device time into #1, #5, #8 and #17.
- **Two notification stacks cannot coexist on iOS** (PRD → "Own the
  notification layer"). #2 is small but must land before any native
  notification is posted, or a tap will crash the app in Tauri's delegate.
- **Swift has no test harness in this repo (#590).** Every Swift rule that
  mirrors a TypeScript rule is locked by a vitest/Rust *source-shape* test,
  as `ios_library.rs` and `pipeline_contract.rs` already do. Those tests are
  part of the task that introduces the rule, not a follow-up.
- **The App Review notes must stay true.** `docs/features/mobile.md` → "App
  Review notes" currently promises that no notification permission is
  declared. After #10 that is false; #16 rewrites the paragraph, and #10 must
  keep the first-launch demo path prompt-free.
- **Concurrent work in `mobile-store.ts`** (per-folder views landed while this
  was drafted). #9 adds a slice; rebase onto whatever the store looks like
  then rather than onto the shape quoted in the PRD.
- **Two sibling PRDs drafted the same day** — `ios-recordings` (a
  `Recordings/` folder the Mac writes transcripts into) and
  `icloud-container-library` (the root becomes the app's own container).
  Neither is a dependency: #3 diffs `Inbox/` only and every task resolves the
  root through `LibraryAccess.resolveRoot`. If `ios-recordings` ships first,
  its "transcript arrived" case is a second folder in #3/#5's diff — file it
  as a follow-up against that PRD, do not fold it into Phase 1.

---

## Phase 0 — De-risk

### #1 Spike: `BGAppRefreshTask` under Tauri iOS, measured on a device

**Description.** Answer the PRD's three open questions with evidence, then
delete the throwaway code.

1. Add `fetch` + `BGTaskSchedulerPermittedIdentifiers`
   (`com.notesage.app.inbox-refresh`) to the app plist through
   `integrate-share-extension.py` (the real change — keep it; it becomes #6).
2. In `NotesageIosPlugin.load(webview:)`, call
   `BGTaskScheduler.shared.register(forTaskWithIdentifier:using:launchHandler:)`
   with a handler that lists `Inbox/` via `LibraryAccess.listDirectory("Inbox")`
   and logs the names, then completes. Launch on a device from Xcode: does
   registration succeed, or does iOS assert that launch already finished?
   Record the verdict and, if it asserts, prove the fallback: a
   `#[ctor]`-style constructor in `tauri-plugin-notesage-ios/src/lib.rs`
   calling a `@_cdecl("notesage_register_background_tasks")` Swift function
   before `UIApplicationMain`.
3. Submit a `BGAppRefreshTaskRequest` on `didEnterBackground`; file a capture
   from the Mac; force a run from the debugger at 5, 15 and 60 minutes with the
   app never foregrounded in between. Does the listing show the new file (as a
   `.icloud` placeholder or downloaded)? Record what appeared and when.
4. From the Share Extension (a temporary line in `LibraryCapture.writeCapture`),
   call `UNUserNotificationCenter.current().setBadgeCount(1)` after the write
   with `[.badge, .alert]` authorization granted to the app. Does the icon
   badge change? Record it.

**Acceptance.** A "Findings" subsection appended under this task (in this
file) with the three verdicts, the log lines that prove them, and the iOS
version. The plist change stays; the handler and the extension line are
reverted.

- **Complexity:** L
- **Category:** backend (Swift + Python)
- **Dependencies:** —
- **Files:** `src-tauri/ios/integrate-share-extension.py`,
  `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/NotesageIosPlugin.swift`
  (throwaway), `src-tauri/ios/LibraryCapture.swift` (throwaway),
  this file.

### #2 Unregister `tauri-plugin-notification` on iOS, with a lock

**Description.** Wrap `.plugin(tauri_plugin_notification::init())` in
`src-tauri/src/lib.rs` so it is registered only `#[cfg(not(target_os =
"ios"))]` — the builder is already reassigned under `#[cfg(desktop)]` a few
lines below; follow that shape. Keep the Cargo dependency (its permission
files must still be generated for `capabilities/default.json` to validate).
Add a Rust source-shape test beside `every_ios_command_sanitizes_its_path` in
`ios_library.rs` that `include_str!`s `lib.rs` and asserts the registration
line sits inside a `not(target_os = "ios")` block, with a comment naming the
force-unwrap in `NotificationHandler.toActiveNotification` as the reason.
Confirm nothing reachable from `MobileApp.tsx` imports
`@tauri-apps/plugin-notification` — extend `telemetry-unreachable.test.ts`'s
import walk (or add a sibling) to assert it.

**Acceptance.** `cargo check` with the stubs; the iOS simulator build
(`tauri ios build --target aarch64-sim --debug`) still links; the new tests
fail if either guard is removed.

- **Complexity:** S
- **Category:** backend
- **Dependencies:** —
- **Files:** `src-tauri/src/lib.rs`, `src-tauri/src/commands/ios_library.rs`
  (tests), `src/components/mobile/__tests__/telemetry-unreachable.test.ts`.

---

## Phase 1 — Native core (compiled into app and extension)

### #3 `InboxState.swift` — the disk truth, shared by three processes

**Description.** A new file in the plugin package, also added to the Share
Extension target's `sources` in `integrate-share-extension.py` (beside
`LibraryAccess.swift`). Pure functions over the resolved root:

- `names(root:)` — files directly under `Inbox/`: not directories, not
  dotfiles, `.name.icloud` placeholders reported under their real name (reuse
  the rule in `LibraryAccess.children`, factored out rather than copied).
- `unreadCount(root:)` — names whose entry in
  `Inbox/.notesage/reading-progress.json` is absent, has `deleted == true`, or
  has `openedAt == null`. Tolerant parse: an unreadable or malformed file is an
  empty one, as `parseReadingProgress` does. Nothing else in the file is
  interpreted.
- `NotificationPrefs` — typed access to the App Group `UserDefaults` keys
  `notesage.notify.{badge,newItems,seen,announced,templates}` (PRD → Data
  Model), with `markSeen([String])`, `recordOwnCapture(name)`, `unseen(of:)`.

Lock the unread rule with a vitest source-shape test
(`src/lib/__tests__/inbox-unread-rule.test.ts`): read `InboxState.swift`,
assert it checks exactly `openedAt`, `deleted` and absence, and that
`isUnread` in `reading-progress-file.ts` checks the same three — so a change
to either fails the test naming the other.

**Acceptance.** Extension and app targets both compile with the file; the
test exists and passes; `integrate-share-extension.py` is idempotent with
the new source entry.

- **Complexity:** M
- **Category:** backend (Swift)
- **Dependencies:** —
- **Files:** `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift`
  (new), `LibraryAccess.swift` (factor the placeholder rule),
  `src-tauri/ios/integrate-share-extension.py`,
  `src/lib/__tests__/inbox-unread-rule.test.ts` (new).

### #4 `Notifier.swift` — the app's one `UNUserNotificationCenterDelegate`

**Description.** In the plugin package. Owns:

- `status()` → authorization (`notDetermined | denied | authorized`; treat
  `.provisional`/`.ephemeral` as `authorized` for display) and
  `UIApplication.shared.backgroundRefreshStatus` mapped to
  `available | denied | restricted`.
- `request()` → `requestAuthorization(options: [.badge, .alert])`, resolving
  the new status. No `.sound` — a read-later list does not ding.
- `setBadge(_ count: Int)` via `setBadgeCount` (iOS 16+), honouring the
  `badge` preference (off → 0).
- `announce(unseen: [String])` → one `UNNotificationRequest` with identifier
  `inbox-new`, `threadIdentifier` `inbox`, title/body from the stored
  templates (fallback English when absent), replacing any delivered one; then
  `announced = unseen`. Posts nothing when `unseen` equals `announced`.
- `clearAnnounced()` → `removeDeliveredNotifications(["inbox-new"])` +
  `announced = []`.
- Delegate: `willPresent` → `[.banner, .badge]` (the app is foregrounded only
  if the extension posted, which it never does — keep the branch honest but
  simple); `didReceive` for `inbox-new` → set `pendingRoute = "inbox"` and
  dispatch `window.dispatchEvent(new CustomEvent('notesage:notification',
  {detail:{route:'inbox'}}))` through `webViewRef` if it exists (same JSON
  bridge as `emitSpeech`). Installed as `UNUserNotificationCenter.current().delegate`
  in `load(webview:)`.

**Acceptance.** Compiles; with #2 landed, tapping a notification the app
posted from a debug button (temporary) no longer crashes and reaches the JS
event; the delegate is the plugin's, verified by logging
`UNUserNotificationCenter.current().delegate` at load.

- **Complexity:** M
- **Category:** backend (Swift)
- **Dependencies:** #2, #3
- **Files:** `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/Notifier.swift`
  (new), `NotesageIosPlugin.swift` (delegate install, `webViewRef` reuse).

### #5 `BackgroundRefresh.swift` — register, schedule, run

**Description.** Registration where #1 proved it works. Scheduling: submit a
`BGAppRefreshTaskRequest(identifier:)` with `earliestBeginDate = now + 15 min`
on `UIApplication.didEnterBackgroundNotification` (observer installed with the
keyboard observers' pattern, tokens removed in `deinit`) and at the end of
every run; log the `submit` error when it throws (`.unavailable` is what a
disabled Background App Refresh looks like). The run:

1. `task.expirationHandler` marks the run cancelled; a 20 s `DispatchWorkItem`
   does the same so the work never reaches iOS's 30 s wall.
2. `LibraryAccess.resolveRoot()`; on `noGrant`/`staleBookmark` log and
   complete `success: true` (nothing to do is not a failure). Call it off the
   main thread and inside the 20 s budget: if the parallel
   `icloud-container-library` PRD lands first, the resolver's first
   `url(forUbiquityContainerIdentifier:)` call in a fresh process can block
   for seconds, and a background launch *is* a fresh process.
3. `InboxState.names` + `unreadCount`; if `badge` pref → `Notifier.setBadge`.
4. If `newItems` pref and authorization is `authorized` → `unseen =
   prefs.unseen(of: names)`; `Notifier.announce(unseen:)` (which itself skips
   an unchanged set).
5. Schedule the next run; `setTaskCompleted(success: true)`.

Never touch the seen set here. Log every branch under `subsystem
com.notesage.app, category refresh`.

**Acceptance.** On a device: a forced run after two Mac captures produces one
banner naming both and the right badge; a second forced run with nothing new
posts nothing; a third after one more capture replaces the banner with "3 new
in Inbox"; with the grant cleared the run logs `no grant` and completes;
Background App Refresh off in Settings → `submit` logs the error and no run
occurs. Each verified with `idevicesyslog`.

- **Complexity:** L
- **Category:** backend (Swift)
- **Dependencies:** #1, #3, #4
- **Files:** `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/BackgroundRefresh.swift`
  (new), `NotesageIosPlugin.swift` (observer + registration call).

### #6 Plist keys through the integration script, asserted in the built app

**Description.** Keep #1's plist change and finish it: `UIBackgroundModes`
gains `fetch` beside `audio` (same idempotent append),
`BGTaskSchedulerPermittedIdentifiers = ["com.notesage.app.inbox-refresh"]`.
Add an assertion at the end of `main()` mirroring the existing App Group
check. Note where the truth lives: the app's `Info.plist` is written at
*build* time by Tauri from `project.yml`'s `info.properties`, so there is no
generated plist to read after `xcodegen generate` — assert on `project.yml`
after patching (both properties present), **and** state in the script's
docstring that the built `.app`'s `Info.plist` must be checked with
`plutil -p` in #17, because an absent key fails silently at runtime (the same
reasoning as the `share-preprocess.js` resource comment).

**Acceptance.** Running the script twice yields identical `project.yml`; the
assertion fails when either key is removed from `SHARE_TARGET`'s sibling
app-info patch.

- **Complexity:** S
- **Category:** backend (Python)
- **Dependencies:** #1
- **Files:** `src-tauri/ios/integrate-share-extension.py`.

### #7 Commands: plugin methods → Rust seams → `ios-api.ts`

**Description.** Six commands, following `ios_speech_state` end to end
(Swift `@objc` method → `run_mobile_plugin` in the plugin crate → `ios_impl`
seam → `#[tauri::command]` in `ios_library.rs` → desktop stub that errors →
both `generate_handler!` lists in `lib.rs` → typed wrapper in `ios-api.ts`):

| Command | Returns | Notes |
| --- | --- | --- |
| `ios_notification_status` | `NotificationStatus` | PRD → Data Model |
| `ios_notification_request` | `NotificationStatus` | the one system prompt |
| `ios_notification_set_prefs(badge?, newItems?, templates?)` | `NotificationStatus` | `badge: false` clears the badge at once; `templates` stored beside the prefs |
| `ios_inbox_unread_count` | `u32` | recount from disk; `Notifier.setBadge`; `prefs.markSeen(names)`; `Notifier.clearAnnounced()` |
| `ios_consume_launch_route` | `Option<String>` | `"inbox"` once, then `None` |
| `ios_open_settings` | `()` | `UIApplication.open(openSettingsURLString)` |

Add all six to `ALLOWED` in `mobile-app.test.tsx` with a one-line reason
each (the file's convention), and to the "iOS Library & Capture Operations"
table in `docs/tauri-commands.md`. `ios_inbox_unread_count` needs no path
argument, so the sanitizer source-shape test is unaffected; say so in a
comment where the list of sanitized commands lives.

**Acceptance.** `pnpm typecheck`; `cargo check` (stubs); `mobile-app.test.tsx`
passes; the iOS simulator build links.

- **Complexity:** M
- **Category:** both
- **Dependencies:** #4
- **Files:** `NotesageIosPlugin.swift`,
  `src-tauri/crates/tauri-plugin-notesage-ios/src/lib.rs`,
  `src-tauri/src/commands/ios_library.rs`, `src-tauri/src/lib.rs`,
  `src/lib/ios-api.ts`, `src/components/mobile/__tests__/mobile-app.test.tsx`,
  `docs/tauri-commands.md`.

### #8 Share Extension: badge up, own capture marked seen, no banner

**Description.** In `LibraryCapture.swift`, one funnel
`LibraryAccess.didWriteCapture(relPath:)` called after every successful
coordinated write in each `write*` function (`writeCapture`,
`writeArticleCapture`, the X, video, link-card and document writers): it calls
`InboxState.NotificationPrefs.recordOwnCapture(name)` and, when the badge
preference is on, `UNUserNotificationCenter.current().setBadgeCount(
InboxState.unreadCount(root:))` (the count from disk, not `+1` — two shares in
a row must not drift). Never a banner. Extend
`src-tauri/crates/notesage-capture/tests/pipeline_contract.rs` with a
word-boundary text scan asserting every `static func write` in
`LibraryCapture.swift` that performs a coordinated write reaches
`didWriteCapture` — the "a perfect writer nobody invokes" failure the contract
exists for.

**Acceptance.** On a device with authorization granted: share a link, return
to the home screen — badge incremented, no banner; a forced background run
afterwards announces nothing (the capture is seen). The contract test fails
when any writer's call is removed.

- **Complexity:** M
- **Category:** backend (Swift + Rust test)
- **Dependencies:** #3
- **Files:** `src-tauri/ios/LibraryCapture.swift`,
  `src-tauri/crates/notesage-capture/tests/pipeline_contract.rs`.

---

## Phase 2 — Phone UI

### #9 `mobile-store` notification slice

**Description.** `notifications: NotificationStatus | null`, `unreadInbox:
number`, `notificationPrePromptDismissed: boolean` (persisted — add to
`partialize`), actions `refreshNotificationStatus()`,
`requestNotifications()` (→ on `authorized`, `setNotificationPref({badge:
true, newItems: true, templates})`), `setNotificationPref(patch)`,
`refreshUnread()` (→ `ios_inbox_unread_count`, stores the number; swallows
rejection off-iOS so the vitest shell keeps working, as `iosContentReady` does),
`dismissNotificationPrePrompt()`. `templates` come from `t("notify.title")`,
`t("notify.one")`, `t("notify.many")` — new keys in `en` and `sv` — and are
re-sent on every `setNotificationPref` and on `refreshNotificationStatus`, so a
language change reaches the background task.

**Acceptance.** Unit tests for the slice (grant → status; request →
prefs on; dismissal persisted; `refreshUnread` tolerates rejection).

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #7
- **Files:** `src/stores/mobile-store.ts`, `src/lib/i18n.ts`,
  `src/stores/__tests__/` (new test).

### #10 Pre-prompt card on the Inbox listing

**Description.** `NotificationPrePrompt.tsx` rendered by `LibraryBrowser`
above the Inbox folder's rows only when: `currentRelPath === INBOX_NAME`,
`state.entries.length > 0`, `notifications?.authorization ===
"notDetermined"`, and `!notificationPrePromptDismissed`. Geometry mirrors
`InboxCard` (`bg-muted/60`, `rounded-xl`, the 8+8 inset rule). *Turn on* →
`requestNotifications()`; *Not now* → `dismissNotificationPrePrompt()`.
Strings `notify.prePromptTitle`, `notify.prePromptBody`, `notify.turnOn`,
`notify.notNow` in `en`/`sv`. Copy per the PRD's UI/UX section.

**Acceptance.** `mobile-app.test.tsx`: no card on first launch (empty Inbox,
`notDetermined`); card once the Inbox has an item; *Not now* hides it and it
stays hidden after a store rehydrate; no card when `authorized` or `denied`;
the App Review demo-path describe block still passes unchanged.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #9
- **Files:** `src/components/mobile/NotificationPrePrompt.tsx` (new),
  `src/components/mobile/LibraryBrowser.tsx`, `src/lib/i18n.ts`,
  `src/components/mobile/__tests__/mobile-app.test.tsx`.

### #11 Menu rows: badge, banners, and the two Settings escapes

**Description.** In `LibraryBrowser`'s root top-right `UIMenu` spec
(`useNativeChrome`), a new section (`sectionBreak: true`) after the image
rows:

- authorization `authorized` → `notify-badge` (checkmark = `badge`,
  icon `app.badge`) and `notify-new` (checkmark = `newItems`, icon `bell`);
  handlers toggle through `setNotificationPref`.
- `notDetermined` → the same two rows unchecked; tapping either calls
  `requestNotifications()` first, then applies the toggle on grant.
- `denied` → one row `notify-settings` ("Notifications are off in
  Settings…", icon `gear`) → `ios_open_settings`.
- `backgroundRefresh !== "available"` → an extra row `notify-refresh`
  ("Background refresh is off in Settings…", icon `arrow.clockwise`) →
  `ios_open_settings`.

`refreshNotificationStatus()` on mount and on `visibilitychange` (the user
may have just returned from Settings). Web-island fallback (`Chrome.tsx`)
gets the same entries so the vitest shell renders them.

**Acceptance.** `useNativeChrome.test.ts` / `mobile-app.test.tsx` assert the
spec for all four states; strings in `en`/`sv`.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #9
- **Files:** `src/components/mobile/LibraryBrowser.tsx`,
  `src/components/mobile/Chrome.tsx`, `src/lib/i18n.ts`, tests.

### #12 Badge refresh points, `InboxCard` unread count, launch route

**Description.**

- Call `refreshUnread()` from: `LibraryBrowser.load` when `currentRelPath` is
  `""` or `INBOX_NAME`; `MobileApp`'s `visibilitychange` → visible (a root-level
  effect, since the browser unmounts while reading); `pushInboxProgress` after
  a successful write (in `inbox-progress-sync.ts`); the delete and move
  handlers when the item is under `Inbox/`.
- `InboxCard` takes `unread?: number` and shows it in
  `text-[var(--color-accent-primary)]` when `> 0`, else the existing muted
  total.
- Launch route: in `MobileApp`, after `grantState` becomes `granted`, call
  `ios_consume_launch_route`; `"inbox"` → `jumpToFolder({relPath: INBOX_NAME,
  name: INBOX_NAME})`. Subscribe once at the root to the
  `notesage:notification` `CustomEvent` for warm taps (same shape as
  `startSpeechEvents`), same action.

**Acceptance.** Tests: card shows the accent unread count; the route consumer
jumps to Inbox and is a no-op on `null`; `inbox-progress-sync.test.ts` asserts
the refresh call after a push.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #7, #9
- **Files:** `src/components/mobile/LibraryBrowser.tsx`,
  `src/components/mobile/InboxCard.tsx`, `src/MobileApp.tsx`,
  `src/lib/inbox-progress-sync.ts`, `src/lib/ios-api.ts` (event subscriber),
  tests.

### #13 Phone tests sweep + surface lock

**Description.** The tests named in #9–#12 written as part of those tasks;
this task is the audit pass (`feedback_thorough_audit`): confirm each PRD
phone gate that can be expressed in vitest has a test, that `ALLOWED` is the
full new surface and `FORBIDDEN` still lists nothing we added, and that no
test mocks the notification layer away in a way that would hide a crash (the
`Tooltip` anti-pattern in `docs/design-system.md`). Run `pnpm typecheck`
after — vitest does not.

**Acceptance.** A checklist in the PR body mapping PRD gates → test names,
with the gaps that only a device can close listed for #17.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #9, #10, #11, #12
- **Files:** `src/components/mobile/__tests__/*`, `src/lib/__tests__/*`.

---

## Phase 3 — The Mac

### #14 `useInboxArrivals` — always-mounted watch + one notification per batch

**Description.** New hook mounted in `App.tsx` beside `useStartWatchers`.
Move the `watchDirectory` effect and the `file-changed-batch` listener out of
`InboxSection.tsx` into it verbatim (the sidebar unmounts on ⌘⇧L —
`project_always_mounted_listeners`); `InboxSection` keeps the first-load
effect and rendering only. Subscribe to `useInboxStore` `items`: keep the
previous name set; the first non-empty load after the root resolves is the
baseline (no notification); on each later change compute `added = next −
prev`; if non-empty and `settings.notifyInboxCaptures` and not
(`document.hasFocus()` && `inbox.open`), call `notify("inbox_capture",
title, body)` — one call per change, "New in Inbox: *Title*" (the filename
stem; the `meta` title when already cached) or "N new in Inbox". Pass `extra:
{ inbox: true }` — extend `notify` (or add `notifyInbox`) in
`src/lib/notifications.ts` to accept `extra`, keeping `deliverNotification`'s
silent degradation. Register an `onAction` handler (the `useSessionManager`
pattern) that opens the Inbox and focuses the window when `extra.inbox` is
set. Settings: `notifyInboxCaptures` (default `true`, with the
`notifyPermissionRequest`-style rehydrate default), setter, a `SettingsRow` in
`SystemSettings.tsx` → Notifications, keys `settings.inboxCaptures` /
`settings.inboxCapturesDesc` in `en`/`sv`; `NotificationType` gains
`inbox_capture` in `TYPE_TO_SETTING`.

**Acceptance.** Manually per the PRD's Mac gates; automated in #15.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** —
- **Files:** `src/hooks/useInboxArrivals.ts` (new), `src/App.tsx`,
  `src/components/sidebar/quiet/InboxSection.tsx`, `src/lib/notifications.ts`,
  `src/stores/settings-store.ts`,
  `src/components/settings/v2/SystemSettings.tsx`, `src/lib/i18n.ts`.

### #15 Mac tests

**Description.** `useInboxArrivals.test.ts`: baseline load notifies nothing;
a later load adding one name notifies once with the title; adding three
notifies once with "3 new in Inbox"; focused window + open Inbox suppresses;
setting off suppresses; the `onAction` handler opens the Inbox.
`notifications.test.ts` (extend if present, else new): `inbox_capture` gates
on `notifyInboxCaptures`; `extra` is forwarded. `settings-store` test: the
rehydrate default. `InboxSection.test.tsx` (if present) no longer asserts the
watcher.

**Acceptance.** `pnpm test` and `pnpm typecheck` green.

- **Complexity:** M
- **Category:** frontend
- **Dependencies:** #14
- **Files:** `src/hooks/__tests__/useInboxArrivals.test.ts` (new),
  `src/lib/__tests__/notifications.test.ts`, `src/stores/__tests__/*`.

---

## Phase 4 — Ship

### #16 Docs

**Description.** `docs/features/mobile.md`: a "Notifications (badge and
background refresh)" section — the mechanism table's conclusions, the seen-set
rule, the reliability statement in plain words, the debugger recipe for
forcing a run, the log category — and rewrite the App Review "Permissions"
paragraph (a notification prompt now exists, reached only after a capture or
from the menu; explainable from the UI in front of the reviewer; the demo
path stays prompt-free). `docs/features/inbox.md`: the Mac notification and the
moved watcher. `docs/tauri-commands.md`: the six commands (done in #7; verify).
`docs/architecture.md` store table: the `mobile-store` and `settings-store`
rows. `docs/app-store/testflight-whats-new.md`: rewritten for the build
(one screen: turn notifications on from the Inbox card, share from the Mac,
watch the badge; say plainly that the banner comes "when iOS gets around to
it"). `docs/app-store/app-privacy.md`: a line confirming local notifications
change nothing ("Data Not Collected" stands; no push entitlement).

- **Complexity:** S
- **Category:** docs
- **Dependencies:** #5, #7, #14
- **Files:** as listed.

### #17 Device verification and a TestFlight build

**Description.** Run every phone gate in the PRD on a device in both English
and Swedish, and every Mac gate on the desktop build, and record the results
here as a "Verified" subsection (build number, iOS version, dates, deviations).
Check the built `.app`'s `Info.plist` with `plutil -p` for `fetch` and the task
identifier (#6). Then cut the TestFlight build with
`scripts/ios-testflight.sh` — do not ask whether to
(`feedback_ship_testflight_dont_ask_for_testing`). Any gate that fails goes
back to its task, not into a follow-up.

- **Complexity:** M
- **Category:** both
- **Dependencies:** #1–#16
- **Files:** this file (Verified section), `docs/app-store/ios-release-notes.md`.

---

## Out of scope (from the PRD, so nobody re-adds them mid-phase)

Server / APNs / CloudKit push · "Saved to Inbox" banner from the extension ·
read-aloud-finished notification · Mac Dock badge · provisional authorization
· `NSMetadataQuery` live listing · notification actions and rich previews ·
`BGProcessingTask` for the image sweep.
