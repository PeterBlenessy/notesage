# PRD: System Tray & Background Intelligence

**Date:** 2026-03-11 **Phase:** 13 **Status:** Complete

---

## Problem

Notesage exists only while the main window is open. Close it, and all background activity stops — no agent task notifications, no action reminders, no quick capture. Users who rely on Notesage for daily work must keep it open and visible, or lose track of pending items.

Desktop productivity apps like Things 3, Raycast, and Bear offer persistent system tray (menu bar) presence that provides:

- At-a-glance status without switching windows
- Quick capture without opening the full app
- Notifications for completed background tasks

Notesage should feel like a first-class desktop citizen, always accessible from the menu bar.

**Why now:** The Open Actions Dashboard (PRD) creates a count of open items. Agent tasks run in the background. Auto-summarization hooks generate results asynchronously. All of these produce information the user wants to see without switching to the app.

---

## Goals

1. **Menu bar icon** — Persistent tray icon with badge count (open actions)
2. **Quick actions menu** — New note, new quick note, open recent, search
3. **Status summary** — Mini popover showing today's activity and pending items
4. **Background notifications** — Agent task completion, hook results, external changes
5. **Start at login** — Optional auto-start (Tauri autostart plugin)
6. **Window management** — Close window hides to tray (optional), click tray icon to show/hide

## Non-Goals

- **Full app in tray popover** — tray shows summary, full app for everything else
- **Custom notification sounds** — use system default
- **Multiple tray icons** — single icon only
- **Tray icon customization** — fixed icon design
- **Background AI processing when app window is closed** — local model stops with the main window (resource management)
- **Mobile push notifications** — desktop only

---

## User Stories

**Always-available writer:**

> As someone who uses Notesage throughout the day, I want the app accessible from my menu bar, so I can quickly capture a thought without hunting for the app window.

**Agent task monitor:**

> As a user who delegates research to agents, I want a notification when the agent finishes, so I don't have to keep checking the app.

**Quick capture:**

> As someone in a meeting using another app, I want to press a global shortcut and immediately start writing a new note, so I capture ideas without breaking flow.

**Action reminder:**

> As a busy professional, I want to glance at my menu bar and see how many open actions I have, so I stay on top of my work.

---

## Technical Approach

### Tauri Tray Implementation

Tauri v2 provides `TrayIcon` API for system tray support:

```rust
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "new-note", "New Note", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(app, "new-quick-note", "New Quick Note", true, None)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "open-actions", "Open Actions (12)", true, None)?,
        &MenuItem::with_id(app, "recent-1", "meeting-notes.md", true, None)?,
        &MenuItem::with_id(app, "recent-2", "research-plan.md", true, None)?,
        &MenuItem::with_id(app, "recent-3", "todo.md", true, None)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "show-window", "Show Notesage", true, None)?,
        &MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?,
    ])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Notesage — 12 open actions")
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    Ok(())
}
```

### Badge Count

The tray icon displays a badge with the open action count. On macOS, this uses the dock badge API. For the menu bar icon itself, overlay the count as a small number.

```rust
// Update badge when action count changes
#[tauri::command]
pub async fn update_tray_badge(
    app: AppHandle,
    count: u32,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        // Update tooltip
        tray.set_tooltip(Some(&format!("Notesage — {} open actions", count)))
            .map_err(|e| e.to_string())?;

        // Update menu item text
        // (Rebuild or update the "Open Actions" menu item)
    }
    Ok(())
}
```

### Notifications

Use Tauri's notification plugin for desktop notifications:

```rust
use tauri_plugin_notification::NotificationExt;

fn send_notification(app: &AppHandle, title: &str, body: &str) {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .ok();
}
```

**Notification triggers:**

| Event | Notification |
| --- | --- |
| Agent task completed | "Agent completed: \[task summary\]" |
| Agent task error | "Agent failed: \[error summary\]" |
| Hook completed with changes | "Hook \[name\]: updated \[file\]" |
| External file change (dirty tab) | "External change: \[file\] modified" |

### Window Management

**Close-to-tray behavior** (optional, off by default):

```rust
// In window event handler
fn handle_close_requested(event: &WindowEvent) {
    if settings.close_to_tray {
        event.window().hide().ok();
        event.prevent_close();
    }
    // Otherwise: default close behavior (quit or hide per macOS convention)
}
```

**Click tray icon:**

- If window is hidden → show and focus
- If window is visible but not focused → focus
- If window is focused → hide (toggle behavior)

### Start at Login

Use `tauri-plugin-autostart`:

```rust
// In setup
app.handle().plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    None,
))?;
```

Frontend toggle in Settings:

```typescript
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

async function toggleAutoStart(enabled: boolean) {
  if (enabled) await enable();
  else await disable();
}
```

### Global Shortcut (Quick Capture)

Register a global keyboard shortcut for quick note capture:

```rust
use tauri_plugin_global_shortcut::GlobalShortcutExt;

app.global_shortcut().register("CmdOrCtrl+Shift+Space", |app, shortcut, event| {
    if event.state == ShortcutState::Pressed {
        // Show quick capture window
        show_quick_capture(app);
    }
})?;
```

**Quick capture window** — small, focused floating window:

```
┌─────────────────────────────────────────┐
│  Quick Note                        [×]  │
│─────────────────────────────────────────│
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Type your note here...          │    │
│  │                                 │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Save to: [Quick Notes ▾]   [Save]      │
│                                         │
└─────────────────────────────────────────┘
```

- Appears centered on screen with focus
- Auto-generates filename from first line or timestamp
- Saves to Quick Notes folder (default) or selected project
- Dismisses with Escape or Save
- Minimal UI — just a text area and save button

---

## UI/UX

### Tray Menu

macOS menu bar (right side):

```
┌──────────────────────────────────────┐
│  📝 ▾                                │  ← Notesage icon in menu bar
├──────────────────────────────────────┤
│  New Note                    ⌘N      │
│  New Quick Note                      │
│  ──────────────────────────────────  │
│  Open Actions (12)                   │
│  ──────────────────────────────────  │
│  Recent                              │
│    meeting-notes.md                  │
│    research-plan.md                  │
│    todo.md                           │
│  ──────────────────────────────────  │
│  Show Notesage               ⌘1      │
│  ──────────────────────────────────  │
│  Start at Login         [✓]          │
│  ──────────────────────────────────  │
│  Quit Notesage               ⌘Q      │
└──────────────────────────────────────┘
```

### Settings → General

New options in Settings &gt; General:

```
┌─────────────────────────────────────────────────────┐
│  System Tray                                        │
│                                                     │
│  [■] Show in menu bar                               │
│      Keep Notesage accessible from the menu bar     │
│                                                     │
│  [ ] Close window to tray                           │
│      Closing the window hides it instead of         │
│      quitting the app                               │
│                                                     │
│  [ ] Start at login                                 │
│      Launch Notesage automatically when you log in  │
│                                                     │
│  Notifications                                      │
│                                                     │
│  [■] Agent task completion                          │
│  [■] Hook results                                   │
│  [ ] External file changes                          │
│                                                     │
│  Quick Capture                                      │
│                                                     │
│  Global shortcut: [ ⌘⇧Space          ]  [Change]   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Notification Design

Follow macOS notification conventions — Tauri's notification plugin handles native presentation.

---

## Data Model

### Settings Store Extension

```typescript
interface SettingsStore {
  // Existing...

  // Tray settings (NEW)
  showInTray: boolean;                // default: true
  closeToTray: boolean;               // default: false
  startAtLogin: boolean;              // default: false
  quickCaptureShortcut: string;       // default: "CmdOrCtrl+Shift+Space"

  // Notification settings (NEW)
  notifyAgentCompletion: boolean;     // default: true
  notifyHookResults: boolean;         // default: true
  notifyExternalChanges: boolean;     // default: false
}
```

### Recent Files

Read from existing `editor-store` tab history — no new storage needed.

---

## Dependencies

### New Tauri Plugins

| Plugin | Purpose | Crate |
| --- | --- | --- |
| `tauri-plugin-notification` | Desktop notifications | `tauri-plugin-notification` |
| `tauri-plugin-autostart` | Start at login | `tauri-plugin-autostart` |
| `tauri-plugin-global-shortcut` | Quick capture shortcut | `tauri-plugin-global-shortcut` |

### Frontend

- No new npm dependencies

---

## Quality Gates

### Functional

- [x] Tray icon appears in macOS menu bar

- [x] Tray menu shows correct items (New Note, Quick Note, Open Actions, Recent, Show, Quit)

- [x] Clicking "New Note" opens new note dialog (shows main window if hidden)

- [x] Clicking "Open Actions" opens the actions dashboard

- [x] Recent files list shows last 3 opened files

- [x] Badge count updates when action count changes

- [x] Clicking tray icon toggles main window visibility

- [x] Close-to-tray keeps app running in background

- [x] Start at login works correctly

- [x] Global shortcut opens quick capture window

- [x] Quick capture saves note to selected destination

- [x] Agent completion notification appears

- [x] Clicking notification shows main window and navigates to relevant content

- [x] Notification preferences are respected (can disable per type)

- [x] Quit from tray menu fully exits the app (including local AI server)

### Performance

- [x] Tray icon and menu render instantly

- [x] Badge count updates in &lt; 100ms

- [x] Quick capture window appears in &lt; 300ms after shortcut

### Design

- [x] Tray icon fits macOS menu bar aesthetic (template image for dark/light)

- [x] Tray menu follows macOS HIG conventions

- [x] Quick capture window is minimal and focused

- [x] Notifications follow macOS notification style

---

## Files Created/Modified

### New Files

- `src/components/QuickCapture.tsx` — quick capture floating window
- `src-tauri/src/tray.rs` — tray setup and event handling

### Modified Files

- `src-tauri/src/lib.rs` — tray setup, plugin registration, window close handler
- `src-tauri/Cargo.toml` — add notification, autostart, global-shortcut plugins
- `src-tauri/tauri.conf.json` — add plugin permissions
- `src/stores/settings-store.ts` — tray and notification settings
- `src/components/settings/SettingsDialog.tsx` — tray settings section

---

## Out of Scope

- **Mini app in popover** — tray shows menu, not embedded UI
- **Background AI when window closed** — llama-server stops with main window
- **Custom notification actions** — standard notifications only
- **Windows/Linux tray behavior** — macOS first
- **Tray icon animation** — static icon with badge
- **Multiple windows** — single main window + quick capture