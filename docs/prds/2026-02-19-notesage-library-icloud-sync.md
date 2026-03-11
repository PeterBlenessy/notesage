# PRD: Notesage Library & iCloud Sync (Phase 5.5)

**Status:** ✅ Complete (v0.11.0)

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
- As a user, I want to preview the migration before it happens, so I understand what will change.

### Visual indicators

- As a user, I want to see a cloud badge on synced files and folders in the sidebar, so I know which content is in iCloud.

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

Tauri command to detect iCloud availability:

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

Tauri commands for moving projects between local and iCloud:

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

Implementation: `refreshNotesTree()` in `src/lib/refresh-notes-tree.ts` reads from both locations and merges the file lists. Local files take priority on filename collision. New notes go to whichever location is active based on the `syncQuickNotes` toggle. Migration of existing loose `.md` files is handled by a dedicated `migrate_quick_notes` Tauri command.

### State management

**settings-store.ts** — added:

```typescript
interface SettingsState {
  // ... existing
  notesRootPath: string;          // existing — ~/Notesage
  icloudAvailable: boolean;       // detected on startup
  icloudNotesagePath: string | null; // resolved iCloud path or null
}
```

**New: sync-store.ts** — iCloud sync state (disk-persisted, not localStorage):

```typescript
interface SyncState {
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjectPaths: string[];   // projects currently in iCloud
  migrating: string | null;       // path of project currently being migrated
  loaded: boolean;                // whether settings have been loaded from disk

  // Persistence
  loadSettings: (notesagePath: string) => Promise<void>;
  saveSettings: (notesagePath?: string) => Promise<void>;

  // Actions
  setICloudEnabled: (enabled: boolean) => void;
  setSyncQuickNotes: (enabled: boolean) => void;
  addSyncedProject: (path: string) => void;
  removeSyncedProject: (path: string) => void;
  setSyncedProjectPaths: (paths: string[]) => void;
  setMigrating: (path: string | null) => void;
  updateProjectPath: (oldPath: string, newPath: string) => void;

  // Queries
  isProjectSynced: (path: string) => boolean;
  isMigrating: () => boolean;
}
```

This store persists to `~/Notesage/.notesage/sync-settings.json` via Tauri commands (`read_sync_settings` / `write_sync_settings`) — not localStorage. This ensures settings survive app reinstalls and are tied to the library, not the browser context.

**workspace-store.ts** — modifications:

- `updateProjectPath(oldPath, newPath)` for path updates after migration
- `setNotesTree()` accepts merged tree from `refreshNotesTree()`

### Path migration utility

`migrateProjectPath()` in `src/lib/migrate-project-path.ts` updates all store references after a project folder moves:

- workspace-store: updates project path
- editor-store: updates open tab paths and active file
- project-metadata-store: re-keys metadata under new path
- git-store: re-keys repo data under new path

### New project creation flow

Updated `NewProjectDialog.tsx`:

1. **Location defaults to** `~/Notesage` (shown as "\~/Notesage" in UI)
2. User can click "Choose other location..." to override via folder picker
3. If iCloud is enabled, a **"Sync to iCloud"** checkbox appears (checked by default)
4. If checked, project is created directly in `iCloud/Notesage/` instead of `~/Notesage` — location display shows "iCloud Drive/Notesage"
5. Choosing a custom location disables the iCloud checkbox (custom locations can't sync)

### Startup flow

Updated `App.tsx` initialization:

1. Resolve `~/Notesage` (existing)
2. Call `get_icloud_path()` → store in settings
3. Load `sync-settings.json` from `~/Notesage/.notesage/`
4. If iCloud enabled:
   - Verify iCloud folder still exists (if not, disable sync with toast notification)
   - Load file trees from synced project paths, add each to workspace-store
   - Remove stale synced paths (projects that no longer exist on disk)
5. Call `refreshNotesTree()` to merge Quick Notes from both local and iCloud locations

## UI/UX

### Design decision: "configure then apply" pattern

During implementation, the original design of immediate-action checkboxes with AlertDialog confirmations was replaced with a **"configure then apply" pattern**. This matches the persona selection UX elsewhere in the app and provides a less intrusive experience:

1. User toggles projects on/off — changes are **pending**, no migration happens yet
2. An info bar shows what will change (e.g., "2 to sync, 1 to unsync") with a visual path flow (from → to)
3. User clicks **"Apply Changes"** to execute all migrations at once, or **"Discard"** to revert
4. A spinner shows during migration with all controls disabled

This pattern is used in both the Sync settings tab and the per-project settings.

### Settings Dialog — "Sync" tab

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
│  │   📁 ~/Notesage → ☁ iCloud │    │  ← Path flow (pending)
│  │ ☑ Writing Portfolio         │    │
│  │ ☐ Local Scratch Pad         │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 1 to sync  [Discard] [Apply]│    │  ← Apply bar (when changes pending)
│  └─────────────────────────────┘    │
│                                     │
│  All workspace projects shown.      │
│                                     │
└─────────────────────────────────────┘
```

**States:**

- **iCloud unavailable** (not macOS, or iCloud not signed in): Toggle disabled, helper text: "iCloud sync is available on macOS with iCloud Drive enabled."
- **iCloud enabled, no projects**: Show "No projects in your library. Create a project to get started."
- **Pending changes**: Apply bar appears at bottom with summary, Discard and Apply Changes buttons
- **Migration in progress**: Spinner with "Applying..." text, all controls disabled

**Path display:** Raw filesystem paths are formatted for readability using `formatDisplayPath()` — iCloud paths show as "iCloud Drive/Notesage/..." and home-relative paths as "\~/Notesage/...". Path icons are clickable to reveal the folder in Finder.

**Project list:** Shows all workspace projects (both library and non-library), not just library projects. Non-library projects that aren't in `~/Notesage` or `iCloud/Notesage` can still be synced — they will be moved to the iCloud folder on sync.

### Sidebar — cloud badge icon

Synced files and folders show a **cloud badge** overlaid on the file/folder icon, rather than a separate trailing icon. The `SyncedIcon` component (`src/components/sidebar/SyncedIcon.tsx`) renders the base lucide icon with a small filled cloud badge in the bottom-right corner:

- Badge: 9px cloud icon inside an 11px white circle
- Color: `text-muted-foreground/70`, `fill-muted-foreground/70`, `strokeWidth={0}` (filled, not stroked)
- Position: `-bottom-[2px]` for files, `-bottom-[1px]` for folders (slightly different to account for icon shapes)
- Non-synced items render the plain icon without badge

Used in both `FileTreeItem` (individual files/folders) and `ProjectItem` (project root folders).

### Project Settings — sync toggle

The existing Project Settings dialog (opened via the cog icon on a project name in the sidebar) includes a "Sync" section:

- **Switch toggle:** "Sync to iCloud" (on/off)
- **Visible when:** iCloud is globally enabled and iCloud is available on the system
- **Available for all projects** — not restricted to library projects
- **Pending state:** Toggling shows a preview of the migration with a visual path flow (from → to), "Discard" and "Enable/Disable Sync" buttons
- **Migration:** On apply, project folder is moved and all store references updated via `migrateProjectPath()`
- **Folder rename on disk:** If the project display name is changed in settings, the filesystem folder is also renamed on blur

### New Project Dialog — updated

- Location shows "\~/Notesage" by default
- When iCloud is enabled: checkbox "Sync to iCloud" (checked by default) — location changes to "iCloud Drive/Notesage"
- When iCloud is disabled or unavailable: no checkbox shown
- Choosing a custom location via folder picker disables the iCloud checkbox

## Data Model

### Tauri commands

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
pub async fn migrate_quick_notes(
    from_path: String,
    to_path: String,
) -> Result<(), String>;

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

### TypeScript interfaces

```typescript
// Defined inline in sync-store.ts (not a separate types file)

interface SyncSettings {
  version: number;
  icloud_enabled: boolean;     // snake_case to match Rust serde
  sync_quick_notes: boolean;
  synced_projects: string[];
}
```

### Stores

**sync-store.ts** — see State Management section above.

**workspace-store.ts:**

- `updateProjectPath(oldPath, newPath)` — re-keys project entry after migration
- Notes tree set via `setNotesTree()` from merged `refreshNotesTree()` output

**settings-store.ts:**

- `icloudAvailable: boolean` — detected on startup
- `icloudNotesagePath: string | null` — resolved iCloud Notesage path

### Utility modules

- `src/lib/migrate-project-path.ts` — `migrateProjectPath()` updates all stores after folder move
- `src/lib/refresh-notes-tree.ts` — `refreshNotesTree()` merges local + iCloud Quick Notes trees
- `src/lib/utils.ts` — `formatDisplayPath()` converts raw paths to user-friendly display

## Dependencies

### Rust crates

- `fs_extra` — recursive directory copy for cross-volume fallback (migration commands)

### Existing infrastructure used

- `dirs::home_dir()` — home directory resolution (already used)
- `@tauri-apps/plugin-dialog` — folder picker (already used)
- shadcn/ui `Switch`, `Checkbox`, `Tooltip`, `Collapsible` — all already installed
- lucide-react `Cloud`, `FolderOpen`, `ArrowRight`, `Loader2` icons — already available

### No new frontend dependencies required.

## Quality Gates

### Functional

- [x] `~/Notesage` is auto-created on first launch

- [x] New Project dialog defaults location to `~/Notesage`

- [x] User can still choose a custom location for new projects

- [x] iCloud path correctly detected on macOS (`~/Library/Mobile Documents/com~apple~CloudDocs/`)

- [x] iCloud toggle disabled on non-macOS platforms with explanation text

- [x] Enabling iCloud creates `Notesage/` folder in iCloud Drive

- [x] Selecting a project for sync moves it to iCloud/Notesage and updates all references (open tabs, metadata, workspace-store)

- [x] Deselecting a project copies it back to local `~/Notesage` and deletes the iCloud copy

- [x] Migration preview shown before applying changes (configure-then-apply pattern)

- [x] Quick Notes sync toggle moves loose files between local and iCloud

- [x] Cloud badge appears on synced files and folders in sidebar

- [x] Migration handles errors gracefully (disk full, permissions, iCloud unavailable mid-migration)

- [x] App starts correctly when iCloud was enabled but is now unavailable (disables sync with toast)

- [x] Sync settings persist across app restarts (stored in `sync-settings.json`, not localStorage)

- [x] Open tabs referencing a migrated project update their paths automatically

- [x] Project metadata (`.notesage/`) survives migration intact

- [x] Comments survive migration (keyed by UUID, not path)

- [x] Sync can be enabled/disabled from both Sync settings tab and per-project settings

- [x] Project folder rename on disk when display name changes in Project Settings

### Design

- [x] Sync tab in Settings follows existing tab design pattern

- [x] Cloud badge on sidebar icons is subtle (filled `muted-foreground/70`, 9px, white circle background)

- [x] Migration preview uses inline path flow visualization (not intrusive AlertDialog)

- [x] Migration progress indicator is clear but non-intrusive (spinner + disabled controls)

- [x] iCloud unavailable state is clearly communicated (disabled toggle + explanation text)

- [x] New Project dialog location field is clean — shows "\~/Notesage" or "iCloud Drive/Notesage"

- [x] All new UI works in both light and dark mode

- [x] Path display uses `formatDisplayPath()` for user-friendly labels throughout

## Design Decisions Made During Implementation

### "Configure then apply" over AlertDialog

The PRD originally specified AlertDialog confirmation popups when toggling sync on/off for each project. During implementation, this was replaced with a **pending-state pattern**: toggles update local state only, changes are previewed with a path flow visualization, and an explicit "Apply Changes" button triggers the actual migration. This is less intrusive, lets users batch multiple changes, and matches the persona selection UX pattern used elsewhere in the app.

### Cloud badge over trailing icon

The PRD specified a small cloud icon to the right of the project name. During implementation, this was changed to a **cloud badge overlaid on the file/folder icon** — a small filled cloud in a white circle positioned at the bottom-right of the base icon. This is more compact, works for both files and folders at any nesting level, and avoids cluttering the text area.

### All projects can sync, not just library projects

The PRD originally restricted sync to projects inside `~/Notesage` or `iCloud/Notesage`. During implementation, the restriction was removed — any project can be synced to iCloud. Non-library projects are moved to the iCloud Notesage folder when synced. This provides more flexibility without added complexity.

### Disk-based persistence for sync settings

The sync-store uses Tauri commands to read/write `sync-settings.json` on disk rather than Zustand's localStorage persist middleware. This ensures settings are tied to the library folder (not the browser context) and survive app reinstalls.

### Quick Notes merge strategy

When both local and iCloud Quick Notes exist, `refreshNotesTree()` merges the file lists with local files taking priority on filename collision. This avoids duplicates while preserving content from both locations.

## Out of Scope

- **Sync conflict resolution** — deferred to iCloud's built-in conflict handling
- **Sync progress/status monitoring** — no real-time sync progress bar from iCloud
- **Selective file sync within a project** — entire project syncs or doesn't
- **Non-Apple cloud providers** — no Dropbox, Google Drive, OneDrive
- **Mobile app** — no iOS/iPadOS companion app in this phase
- **Offline indicator** — no UI for "iCloud is currently offline"
- **Storage quota warnings** — no check for iCloud storage limits