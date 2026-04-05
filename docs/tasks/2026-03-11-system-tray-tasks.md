# System Tray & Background Intelligence — Implementation Tasks

**PRD:** `docs/prds/2026-03-11-system-tray.md`**Date:** 2026-03-13 **Total:** 13 tasks — 4S, 6M, 3L **Suggested order:** Backend plugins (#1-3) → tray core (#4-5) → window management (#6) → settings UI (#7) → notifications (#8) → badge/recent (#9-10) → quick capture (#11-12) → autostart (#13)

**Risks / Open Questions:**

- `tauri-plugin-global-shortcut` may conflict with system-level shortcuts on some macOS configs — needs user-configurable shortcut
- Quick capture requires a second Tauri window — verify multi-window works with current `titleBarStyle: "Overlay"` setup
- Badge count depends on Open Actions Dashboard (separate PRD) — can stub with 0 initially
- `tauri-plugin-notification` requires notification permission on macOS — handle permission denied gracefully

---

## 1. Add Tauri tray/notification/autostart/global-shortcut plugin dependencies ✅

**Complexity:** S | **Category:** backend | **Dependencies:** None

**Description**:Add the four new Tauri plugin crates to `Cargo.toml` and register them in `lib.rs`. Update `capabilities/default.json` with required permissions.

**Acceptance criteria:**

- `tauri-plugin-notification`, `tauri-plugin-autostart`, `tauri-plugin-global-shortcut` added to `Cargo.toml`
- Plugins registered in `tauri::Builder` chain in `lib.rs`
- Capabilities file updated with notification, autostart, and global-shortcut permissions
- App still compiles and runs with `pnpm tauri dev`

**Files:**

- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`

---

## 2. Add frontend npm dependencies for new Tauri plugins ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description**:Install the JavaScript bindings for the new Tauri plugins.

**Acceptance criteria:**

- `@tauri-apps/plugin-notification`, `@tauri-apps/plugin-autostart`, `@tauri-apps/plugin-global-shortcut` installed via pnpm
- Imports work without errors

**Files:**

- `package.json`

---

## 3. Create tray icon assets ✅

**Complexity:** S | **Category:** both | **Dependencies:** None

**Description**:Create a macOS template image for the menu bar tray icon. Must be a monochrome template image (macOS automatically handles light/dark menu bar). Use the existing app icon as a base, simplified to work at 18x18 / 36x36 (2x) size.

**Acceptance criteria:**

- `src-tauri/icons/tray-icon.png` (18x18) and `tray-icon@2x.png` (36x36) created
- Icons are monochrome template images (black with alpha channel)
- Icons are visually recognizable as Notesage at small size

**Files:**

- `src-tauri/icons/tray-icon.png` (new)
- `src-tauri/icons/tray-icon@2x.png` (new)

---

## 4. Implement tray module with menu and event handling ✅

**Complexity:** L | **Category:** backend | **Dependencies:** #1, #3

**Description**:Create `src-tauri/src/tray.rs` with tray setup, menu construction, and event handlers. Wire it into `lib.rs` setup.

**Menu structure:**

- New Note (⌘N)
- New Quick Note
- Separator
- Open Actions (count)
- Separator
- Recent submenu (last 3 files)
- Separator
- Show Notesage
- Separator
- Quit Notesage (⌘Q)

**Event handling:**

- `new-note` → emit `tray-new-note` event to frontend
- `new-quick-note` → emit `tray-quick-note` event to frontend
- `open-actions` → emit `tray-open-actions` event to frontend
- `recent-N` → emit `tray-open-file` event with path
- `show-window` → show and focus main window
- `quit` → exit app
- Left-click tray icon → toggle window visibility

**Tauri commands:**

- `update_tray_badge(count: u32)` — update tooltip and "Open Actions" menu item text
- `update_tray_recent(files: Vec<RecentFile>)` — rebuild recent files submenu
- `set_tray_visible(visible: bool)` — show/hide tray icon

**Acceptance criteria:**

- Tray icon appears in macOS menu bar
- All menu items render correctly
- Click events dispatch to frontend
- Show/Quit work correctly
- Badge count and recent files update dynamically

**Files:**

- `src-tauri/src/tray.rs` (new)
- `src-tauri/src/lib.rs` (wire up tray + register commands)
- `src-tauri/src/commands/mod.rs` (re-export tray commands if needed)

---

## 5. Wire tray events to frontend actions ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Description**:Listen for tray events in `App.tsx` and dispatch appropriate actions (open new note dialog, open quick capture, navigate to file, etc.).

**Acceptance criteria:**

- `tray-new-note` → opens New Note dialog (shows window if hidden)
- `tray-quick-note` → opens Quick Capture window
- `tray-open-actions` → opens actions dashboard (shows window if hidden)
- `tray-open-file` → opens file in editor (shows window if hidden)
- Window is shown and focused before any dialog opens

**Files:**

- `src/App.tsx` (add tray event listeners)
- `src/hooks/useTrayEvents.ts` (new — encapsulate tray event handling)

---

## 6. Implement close-to-tray window management ✅

**Complexity:** M | **Category:** both | **Dependencies:** #4

**Description**:Add close-to-tray behavior: when enabled, closing the main window hides it instead of quitting. Clicking the tray icon toggles visibility. Quit from tray menu fully exits (including stopping local AI server, ACP agents, etc.).

**Backend:**

- Handle `CloseRequested` window event in `lib.rs` — check setting via frontend event or managed state
- If close-to-tray enabled: `window.hide()` + `event.prevent_close()`
- If disabled: default behavior

**Frontend:**

- Add `closeToTray` setting to settings-store
- Emit setting to backend on change

**Acceptance criteria:**

- With `closeToTray: false` (default): closing window quits the app normally
- With `closeToTray: true`: closing window hides it, tray icon click shows it again
- "Quit" from tray menu always fully exits regardless of setting
- All child processes cleaned up on quit (ACP, MCP, llama-server)

**Files:**

- `src-tauri/src/lib.rs` (window close handler)
- `src-tauri/src/tray.rs` (quit handler ensures full cleanup)
- `src/stores/settings-store.ts` (add `closeToTray`)

---

## 7. Add tray & notification settings to Settings dialog ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #6

**Description**:Add a "System Tray" section to Settings &gt; General with toggles for:

- Show in menu bar (default: true)
- Close window to tray (default: false)
- Start at login (default: false)
- Notification toggles: agent completion (default: true), hook results (default: true), external file changes (default: false)
- Quick capture shortcut display

Follow existing settings pattern — use shadcn/ui Switch components, consistent with other settings sections.

**Acceptance criteria:**

- All settings render correctly and persist across restarts
- Toggles invoke the correct backend APIs (tray visibility, autostart)
- Settings section matches the design system (consistent spacing, labels, descriptions)
- Works in both light and dark mode

**Files:**

- `src/stores/settings-store.ts` (add all new settings fields)
- `src/components/settings/SettingsDialog.tsx` (add System Tray section)

---

## 8. Implement desktop notifications ✅

**Complexity:** M | **Category:** both | **Dependencies:** #1, #2, #7

**Description**:Add notification support using `tauri-plugin-notification`. Create a notification utility and trigger notifications for:

- Agent task completion (from `activity-store` task status changes)
- Agent task errors
- External file changes on dirty tabs (already handled in `useFileWatcher`)

**Frontend utility:**

- `src/lib/notifications.ts` — wraps `@tauri-apps/plugin-notification` with settings checks
- `sendNotification(type, title, body)` — checks `settings-store` notification preferences before sending

**Integration points:**

- `useAgentTaskOperations.ts` — notify on task completion/error
- `useFileWatcher.ts` — notify on external change (if enabled)

**Acceptance criteria:**

- Notifications appear as native macOS notifications
- Notification preferences are respected (disabled types don't fire)
- Clicking a notification brings the app to focus
- Permission denied is handled gracefully (no crash, silent degradation)

**Files:**

- `src/lib/notifications.ts` (new)
- `src/hooks/useAgentTaskOperations.ts` (add completion notification)
- `src/hooks/useFileWatcher.ts` (add external change notification)

---

## 9. Sync tray badge with open action count ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Description**:Keep the tray badge count in sync with the current open action count. When the action count changes, call `update_tray_badge` to update the tooltip and menu item.

**Implementation:**

- Create `useTraySync` hook mounted in `App.tsx`
- Watch relevant stores (activity-store for pending tasks, comment-store for open comments, etc.)
- On change, invoke `update_tray_badge` Tauri command
- Initially stub with activity-store task count; expand when Open Actions Dashboard is implemented

**Acceptance criteria:**

- Tray tooltip shows current count (e.g., "Notesage — 3 open actions")
- "Open Actions" menu item shows count in parentheses
- Count updates within 100ms of state change

**Files:**

- `src/hooks/useTraySync.ts` (new)
- `src/App.tsx` (mount hook)

---

## 10. Sync tray recent files from editor-store ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** #4, #9

**Description**:Keep the tray "Recent" submenu in sync with recently opened files from `editor-store`. Show the last 3 files with their filenames.

**Implementation:**

- In `useTraySync` hook, watch `editor-store` tabs
- On change, invoke `update_tray_recent` with last 3 unique file paths
- Extract filename from path for display

**Acceptance criteria:**

- Recent files submenu shows last 3 opened files
- Clicking a recent file opens it in the editor
- List updates when tabs change

**Files:**

- `src/hooks/useTraySync.ts` (extend)

---

## 11. Create Quick Capture window (backend) ✅

**Complexity:** M | **Category:** backend | **Dependencies:** #1

**Description**:Add Tauri command to create/show/hide a secondary "quick-capture" window. Register the global shortcut to trigger it.

**Window config:**

- Small floating window (480x320)
- Centered on screen
- Always on top
- No title bar decorations (or minimal)
- `WebviewUrl::App("quick-capture.html")` or route-based

**Global shortcut:**

- Default: `CmdOrCtrl+Shift+Space`
- Shows quick capture window if hidden, hides if shown

**Tauri commands:**

- `show_quick_capture()` — create or show the quick capture window
- `hide_quick_capture()` — hide the window
- `register_quick_capture_shortcut(shortcut: String)` — register/update global shortcut

**Acceptance criteria:**

- Global shortcut opens quick capture window
- Window appears centered, small, and focused
- Escape hides the window
- Window doesn't appear in dock or app switcher

**Files:**

- `src-tauri/src/tray.rs` (or new `src-tauri/src/quick_capture.rs`)
- `src-tauri/src/lib.rs` (register commands + shortcut)

---

## 12. Create Quick Capture window (frontend) ✅

**Complexity:** L | **Category:** frontend | **Dependencies:** #11

**Description**:Build the Quick Capture UI — a minimal floating window with a text area and save controls.

**UI:**

- Title: "Quick Note"
- Text area (auto-focused, full width)
- Footer: "Save to" dropdown (Quick Notes default, or select project) + Save button
- Escape to dismiss, Cmd+Enter to save

**Behavior:**

- Auto-generates filename from first line (or timestamp if empty)
- Saves as `.md` file to selected destination via `write_file` Tauri command
- Shows toast on success, closes window
- Resets content on each open

**Design:**

- Follows design system: neutral palette, shadcn/ui components
- Minimal chrome — just the essentials
- Works in both light and dark mode

**Acceptance criteria:**

- Quick capture window renders correctly
- Text can be entered and saved to Quick Notes
- Destination can be changed to a project folder
- Window dismisses on Escape or after save
- File is created with correct content and auto-generated name

**Files:**

- `src/components/QuickCapture.tsx` (new)
- `src/quick-capture.tsx` (new — entry point for second window, or route-based)
- `index.html` (or separate `quick-capture.html`)

---

## 13. Implement start-at-login via autostart plugin ✅

**Complexity:** L | **Category:** both | **Dependencies:** #1, #2, #7

**Description**:Wire up `tauri-plugin-autostart` for launch-at-login functionality. The plugin uses `LaunchAgent` on macOS.

**Backend:**

- Register autostart plugin in `lib.rs` with `MacosLauncher::LaunchAgent`

**Frontend:**

- In settings UI, toggle calls `enable()` / `disable()` from `@tauri-apps/plugin-autostart`
- On settings load, check `isEnabled()` to sync UI state
- Store user preference in `settings-store` (`startAtLogin`)

**Acceptance criteria:**

- Enabling "Start at login" creates a LaunchAgent
- Disabling removes it
- Setting persists and UI reflects actual state on restart
- App starts correctly from LaunchAgent (no path issues)

**Files:**

- `src-tauri/src/lib.rs` (register plugin)
- `src/stores/settings-store.ts` (add `startAtLogin`)
- `src/components/settings/SettingsDialog.tsx` (wire toggle)