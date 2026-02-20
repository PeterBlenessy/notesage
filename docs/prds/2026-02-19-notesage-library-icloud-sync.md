# PRD: Notesage Library & iCloud Sync (Phase 5.5)

## Problem

Notesage currently has no opinionated default location for projects. Users must manually pick a folder every time they create a project, leading to projects scattered across the filesystem. There is no way to sync notes or projects across Apple devices, which is a core expectation for a macOS-native writing app.

The `~/Notesage` library folder exists for Quick Notes but is underutilized — projects can live anywhere. Users who work across a MacBook and iMac (or Mac and iPad in the future) have no built-in way to keep their writing in sync.

## Goals

1. **Establish** `~/Notesage` **as the default project location** — reduce friction in project creation
2. **Enable selective iCloud sync** — users choose which projects sync via iCloud Drive
3. **Support disabling sync** — projects can be copied back to local storage at any time
4. **Provide visual sync status** — users can see at a glance which projects are synced
5. **Maintain cross-platform compatibility** — home directory resolution works on macOS, Windows, Linux (iCloud is macOS-only)

## Non-Goals

- **Real-time collaboration** — this is file-based sync, not CRDT/multiplayer editing
- **Conflict resolution UI** — iCloud handles file conflicts; we don't build a merge tool
- **Non-Apple cloud providers** — no Dropbox, Google Drive, OneDrive integration in this phase
- **iOS/iPadOS app** — sync prepares for this, but no mobile app is built
- **Syncing Explorer folders** — only library projects and Quick Notes can sync

## User Stories

### Library as default

- As a user, I want new projects to default to `~/Notesage` so I don't have to pick a folder every time.
- As a user, I want the option to choose a different location if I prefer, so I'm not locked in.

### Enabling iCloud sync

- As a user, I want to enable iCloud sync in Settings so my notes are available on all my Apple devices.
- As a user, I want to see a list of my projects and select which ones to sync, so I have control over what goes to iCloud.
- As a user, I want Quick Notes to sync when iCloud is enabled, so my loose notes are also available everywhere.

### Disabling sync

- As a user, I want to deselect a project from iCloud sync in the sync settings (or in Project Settings), so it moves back to my local `~/Notesage` folder.
- As a user, I want a confirmation dialog before disabling sync, so I don't accidentally move a project.

### Visual indicators

- As a user, I want to see a cloud icon next to synced projects in the sidebar, so I know which projects are in iCloud.

### New project creation

- As a user creating a new project with iCloud enabled, I want a checkbox to sync it immediately, so it goes straight to iCloud/Notesage.

## Technical Approach

### Folder structure

```
~/Notesage/                          # Local library (always exists)
├── .notesage/                       # Library-level metadata
│   ├── sync-settings.json           # iCloud sync configuration
│   └── comments/                    # Quick Notes comments (existing)
├── quick-note-1.md                  # Quick Notes (loose files)
├── my-project/                      # Local project
│   ├── .notesage/
│   └── ...
└── ...

~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/   # iCloud library (macOS only)
├── quick-note-2.md                  # Synced Quick Notes
├── synced-project/                  # Synced project
│   ├── .notesage/
│   └── ...
└── ...
```

When iCloud sync is enabled, the app manages two library locations:

- **Local**: `~/Notesage` — always present, default for non-synced content
- **iCloud**: `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/` — created when sync is first enabled

### iCloud folder detection

New Tauri command to detect iCloud availability:

```rust
#[tauri::command]
pub async fn get_icloud_path() -> Result<Option<String>, String>
```

Returns `Some(path)` on macOS if `~/Library/Mobile Documents/com~apple~CloudDocs/` exists, `None` on other platforms or if iCloud is not configured.

### Sync settings

Stored in `~/Notesage/.notesage/sync-settings.json`:

```json
{
  "version": 1,
  "icloudEnabled": false,
  "syncQuickNotes": true,
  "syncedProjects": [
    "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage/my-project"
  ]
}
```

This file lives in the local library (not in iCloud) so it's always accessible even if iCloud is unavailable.

### Project migration commands

New Tauri commands for moving projects between local and iCloud:

```rust
/// Move a project folder to iCloud Notesage directory.
/// Uses atomic rename when on the same volume, falls back to copy+verify+delete cross-volume.
#[tauri::command]
pub async fn migrate_to_icloud(
    project_path: String,
    icloud_notesage_path: String,
) -> Result<String, String>  // Returns new path in iCloud

/// Move a project folder from iCloud back to local Notesage directory.
/// Uses atomic rename when on the same volume, falls back to copy+verify+delete cross-volume.
#[tauri::command]
pub async fn migrate_from_icloud(
    project_path: String,
    local_notesage_path: String,
) -> Result<String, String>  // Returns new path in local
```

Migration strategy: **atomic rename first, copy+verify+delete as fallback**. On a standard Mac, `~/Notesage` and `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/` are on the same APFS volume, so `std::fs::rename()` is atomic, instant, and preserves all file metadata (creation dates, extended attributes, Finder tags, iCloud version history). If rename fails with `EXDEV` (cross-device), fall back to recursive copy → verify file count → delete source. The fallback uses `fs_extra` for recursive directory copy.

### Quick Notes sync

When iCloud sync is enabled and `syncQuickNotes` is true:

- Quick Notes are stored in the iCloud Notesage folder instead of local
- The `notesRootPath` in settings-store points to the iCloud folder for Quick Notes
- If iCloud is disabled, notes are migrated back to local `~/Notesage`

Implementation: the app reads from both locations and merges the file tree. New notes go to whichever location is active.

### State management

**settings-store.ts** — add:

```typescript
interface SettingsState {
  // ... existing
  notesRootPath: string;          // existing — ~/Notesage
  icloudAvailable: boolean;       // detected on startup
  icloudNotesagePath: string | null; // resolved iCloud path or null
}
```

**New: sync-store.ts** — iCloud sync state:

```typescript
interface SyncState {
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjectPaths: string[];   // projects currently in iCloud
  migrating: string | null;       // path of project currently being migrated

  // Actions
  enableICloud: () => void;
  disableICloud: () => void;
  syncProject: (localPath: string) => Promise<void>;
  unsyncProject: (icloudPath: string) => Promise<void>;
  setSyncQuickNotes: (enabled: boolean) => void;
}
```

This store persists to `~/Notesage/.notesage/sync-settings.json` via a custom persist implementation (not localStorage — must survive app reinstalls and be tied to the library, not the browser context).

**workspace-store.ts** — modifications:

- `addProject` updated to track whether the project is in the iCloud folder
- `notesTree` merges trees from both local and iCloud when sync is enabled
- New helper: `isProjectSynced(path: string): boolean`

### New project creation flow

Updated `NewProjectDialog.tsx`:

1. **Location defaults to** `~/Notesage` (shown as "Notesage Library" in UI)
2. User can click "Choose other location..." to override via folder picker
3. If iCloud is enabled, a **"Sync to iCloud"** checkbox appears (checked by default)
4. If checked, project is created directly in `iCloud/Notesage/` instead of `~/Notesage`

### Startup flow

Updated `App.tsx` initialization:

1. Resolve `~/Notesage` (existing)
2. Call `get_icloud_path()` → store in settings
3. Load `sync-settings.json` from `~/Notesage/.notesage/`
4. If iCloud enabled:
   - Verify iCloud folder still exists (user may have signed out)
   - Load file trees from both local and iCloud locations
   - Merge Quick Notes trees if `syncQuickNotes` is true
5. Populate workspace-store with project list from both locations

## UI/UX

### Settings Dialog — new "Sync" tab

```
┌─────────────────────────────────────┐
│  General  │  AI  │  Projects  │ Sync│
├─────────────────────────────────────┤
│                                     │
│  iCloud Sync                        │
│  ┌─────────────────────────────┐    │
│  │ ○ Enable iCloud Sync        │    │  ← Toggle switch
│  └─────────────────────────────┘    │
│                                     │
│  When enabled, selected projects    │
│  sync to iCloud Drive.              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ ☑ Sync Quick Notes          │    │  ← Checkbox
│  └─────────────────────────────┘    │
│                                     │
│  Projects                           │
│  ┌─────────────────────────────┐    │
│  │ ☑ My Research Project       │    │  ← Checkbox per project
│  │ ☑ Writing Portfolio         │    │
│  │ ☐ Local Scratch Pad         │    │
│  └─────────────────────────────┘    │
│                                     │
│  Only projects in your Notesage     │
│  library can be synced.             │
│                                     │
└─────────────────────────────────────┘
```

**States:**

- **iCloud unavailable** (not macOS, or iCloud not signed in): Toggle disabled, helper text: "iCloud sync is available on macOS with iCloud Drive enabled."
- **iCloud enabled, no projects**: Show "No projects in your library. Create a project to get started."
- **Migration in progress**: Show progress indicator on the project being moved, disable its checkbox

### Sidebar — cloud icon

Synced projects show a small cloud icon (lucide `Cloud`, 14px, `text-muted-foreground`) to the right of the project name. Non-synced projects show no icon.

### Confirmation dialog — disable sync

When unchecking a project from the sync list (or disabling in Project Settings):

```
┌──────────────────────────────────────┐
│  Stop syncing "My Project"?          │
│                                      │
│  This project will be copied to your │
│  local Notesage library and removed  │
│  from iCloud. It will no longer sync │
│  across your devices.                │
│                                      │
│           [Cancel]  [Stop Syncing]   │
└──────────────────────────────────────┘
```

Uses shadcn/ui `AlertDialog`. "Stop Syncing" is the primary action (not destructive — data is preserved).

### Project Settings — sync toggle

Add a "Sync" section to the existing Project Settings tab:

- Toggle: "Sync to iCloud" (on/off)
- Only visible when iCloud is globally enabled
- Only visible for projects inside `~/Notesage` or `iCloud/Notesage`
- Toggling off triggers the confirmation dialog above

### New Project Dialog — updated

- Location field shows "Notesage Library" by default with a "Change..." link
- When iCloud is enabled: checkbox "Sync to iCloud" (checked by default)
- When iCloud is disabled or unavailable: no checkbox shown

## Data Model

### New Tauri commands

```rust
// src-tauri/src/commands/sync.rs

#[tauri::command]
pub async fn get_icloud_path() -> Result<Option<String>, String>;

#[tauri::command]
pub async fn migrate_to_icloud(
    project_path: String,
    icloud_notesage_path: String,
) -> Result<String, String>;

#[tauri::command]
pub async fn migrate_from_icloud(
    project_path: String,
    local_notesage_path: String,
) -> Result<String, String>;

#[tauri::command]
pub async fn read_sync_settings(
    notesage_path: String,
) -> Result<Option<SyncSettings>, String>;

#[tauri::command]
pub async fn write_sync_settings(
    notesage_path: String,
    settings: SyncSettings,
) -> Result<(), String>;
```

### New TypeScript interfaces

```typescript
// src/lib/types.ts

interface SyncSettings {
  version: 1;
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjects: string[];  // absolute paths of synced projects
}
```

### New Zustand store

```typescript
// src/stores/sync-store.ts

interface SyncState {
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjectPaths: string[];
  migrating: string | null;

  loadSettings: (notesagePath: string) => Promise<void>;
  saveSettings: (notesagePath: string) => Promise<void>;
  enableICloud: () => void;
  disableICloud: () => void;
  syncProject: (projectPath: string) => Promise<void>;
  unsyncProject: (projectPath: string) => Promise<void>;
  setSyncQuickNotes: (enabled: boolean) => void;
  isMigrating: () => boolean;
  isProjectSynced: (projectPath: string) => boolean;
}
```

### Modified stores

**workspace-store.ts:**

- `isProjectSynced(path)` helper using sync-store
- Notes tree loading accounts for iCloud location

**settings-store.ts:**

- `icloudAvailable: boolean`
- `icloudNotesagePath: string | null`

## Dependencies

### New Rust crates

- `fs_extra` — recursive directory copy for cross-volume fallback (migration commands)

### Existing infrastructure used

- `dirs::home_dir()` — home directory resolution (already used)
- `@tauri-apps/plugin-dialog` — folder picker (already used)
- shadcn/ui `AlertDialog`, `Switch`, `Checkbox`, `Tabs` — all already installed
- lucide-react `Cloud` icon — already available

### No new frontend dependencies required.

## Quality Gates

### Functional

- [ ] `~/Notesage` is auto-created on first launch (existing — verify still works)

- [ ] New Project dialog defaults location to `~/Notesage`

- [ ] User can still choose a custom location for new projects

- [ ] iCloud path correctly detected on macOS (`~/Library/Mobile Documents/com~apple~CloudDocs/`)

- [ ] iCloud toggle disabled on non-macOS platforms with explanation text

- [ ] Enabling iCloud creates `Notesage/` folder in iCloud Drive

- [ ] Selecting a project for sync moves it to iCloud/Notesage and updates all references (open tabs, metadata, workspace-store)

- [ ] Deselecting a project copies it back to local `~/Notesage` and deletes the iCloud copy

- [ ] Confirmation dialog appears when disabling sync for a project

- [ ] Quick Notes sync toggle moves loose files between local and iCloud

- [ ] Cloud icon appears in sidebar for synced projects

- [ ] Migration handles errors gracefully (disk full, permissions, iCloud unavailable mid-migration)

- [ ] App starts correctly when iCloud was enabled but is now unavailable (signed out)

- [ ] Sync settings persist across app restarts (stored in `sync-settings.json`, not localStorage)

- [ ] Open tabs referencing a migrated project update their paths automatically

- [ ] Project metadata (`.notesage/`) survives migration intact

- [ ] Comments survive migration (keyed by UUID, not path)

### Design

- [ ] Sync tab in Settings follows existing tab design pattern

- [ ] Cloud icon in sidebar is subtle (`text-muted-foreground`, 14px)

- [ ] Confirmation dialog uses shadcn/ui AlertDialog with proper copy

- [ ] Migration progress indicator is clear but non-intrusive

- [ ] iCloud unavailable state is clearly communicated (not just a disabled toggle)

- [ ] New Project dialog location field is clean and doesn't feel cluttered

- [ ] All new UI works in both light and dark mode

## Out of Scope

- **Sync conflict resolution** — deferred to iCloud's built-in conflict handling
- **Sync progress/status monitoring** — no real-time sync progress bar from iCloud
- **Selective file sync within a project** — entire project syncs or doesn't
- **Non-Apple cloud providers** — no Dropbox, Google Drive, OneDrive
- **Mobile app** — no iOS/iPadOS companion app in this phase
- **Syncing Explorer folders** — only Notesage library content can sync
- **Offline indicator** — no UI for "iCloud is currently offline"
- **Storage quota warnings** — no check for iCloud storage limits