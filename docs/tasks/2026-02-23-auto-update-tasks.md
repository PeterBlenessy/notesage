# Auto-Update — Implementation Tasks

**PRD:** `docs/prds/2026-02-23-auto-update.md`**Status:** ✅ Complete **Total tasks:** 7 (2S, 4M, 1L) — all implemented **Estimated effort:** \~5-6 hours

## Summary

The implementation is straightforward — Tauri's updater plugin handles the heavy lifting (download, verify, install). The key pair already exists (`~/.tauri/Notesage.key`), the CI already signs artifacts, and `tauri-action` will auto-generate `latest.json` once the plugin is configured. Most of the work is frontend: a hook, a dialog, and wiring into the status bar and settings.

**Suggested order:** #1 → #2 → #3 → #4 → #5 → #6 → #7 (strictly sequential — each depends on the prior)

**Risk:** The update flow can only be fully end-to-end tested after a real release is published with the `latest.json` manifest. Local dev can verify the plugin initializes and the UI renders, but the actual download+install cycle requires a signed release on GitHub.

---

## Task 1: Add Tauri updater plugin and configure endpoint ✅

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/Cargo.toml` — add `tauri-plugin-updater`
- `src-tauri/src/lib.rs` — register `.plugin(tauri_plugin_updater::Builder::new().build())`
- `src-tauri/tauri.conf.json` — add `plugins.updater` with pubkey and GitHub endpoint
- `src-tauri/capabilities/default.json` — add `"updater:default"`

**Description:**

1. Add `tauri-plugin-updater = "2"` to `[dependencies]` in `Cargo.toml`

2. Register the plugin in `lib.rs` builder chain: `.plugin(tauri_plugin_updater::Builder::new().build())` — place it after the existing plugins

3. Add updater config to `tauri.conf.json`:

   ```json
   "plugins": {
     "updater": {
       "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJGREFFNzhEODNBOEJEM0QKUldROXZhaURqZWZhdnhzNG0xS0k0MmFZc3FJYjB3L1kvTzJDVGxZSzNtQTZTMFduOVJsODUzU2YK",
       "endpoints": [
         "https://github.com/PeterBlenessy/notesage/releases/latest/download/latest.json"
       ]
     }
   }
   ```

4. Add `"updater:default"` to the permissions array in `capabilities/default.json`

**Acceptance criteria:**

- App compiles and starts without errors
- No runtime errors related to the updater plugin in console

---

## Task 2: Install frontend dependency and extend settings store ✅

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:**

- `package.json` — add `@tauri-apps/plugin-updater`
- `src/stores/settings-store.ts` — add `autoCheckUpdates`, `lastUpdateCheck`, `dismissedVersion`

**Description:**

1. Run `pnpm add @tauri-apps/plugin-updater`
2. Add three fields to the `SettingsStore` interface and initial values:
   - `autoCheckUpdates: boolean` — default `true`, persisted
   - `lastUpdateCheck: string | null` — default `null`, persisted (ISO timestamp)
   - `dismissedVersion: string | null` — default `null`, persisted
3. Add corresponding setters: `setAutoCheckUpdates`, `setLastUpdateCheck`, `setDismissedVersion`

**Acceptance criteria:**

- Settings store compiles with new fields
- Fields persist to localStorage and survive app restart

---

## Task 3: Create `useAutoUpdate` hook ✅

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:**

- `src/hooks/useAutoUpdate.ts` — new file

**Description:**

Implement the core update logic hook using `@tauri-apps/plugin-updater`:

```typescript
interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'error';
  updateInfo: UpdateInfo | null;
  progress: number | null; // 0-100
  error: string | null;
}
```

**Hook behavior:**

1. `checkForUpdate()`: Call `check()` from the updater plugin. If an update is available and the version hasn't been dismissed, set status to `available`. Update `lastUpdateCheck` timestamp in settings-store. If no update, set status back to `idle`.

2. `downloadAndInstall()`: Call `update.downloadAndInstall()` with an `onChunk` callback that calculates download progress percentage. On completion, the plugin handles restart. Set status through `downloading` states.

3. `dismiss()`: Set `dismissedVersion` to the current update version, reset status to `idle`.

4. **Auto-check on mount**: If `autoCheckUpdates` is true, use `setTimeout` with 5-second delay to call `checkForUpdate()`. Only run once on mount (not on every re-render). The hook should hold a ref to the `Update` object returned by `check()` so `downloadAndInstall` can use it.

5. **Error handling**: Catch errors from `check()` and `downloadAndInstall()`, set status to `error` with message.

**Acceptance criteria:**

- Hook compiles and can be mounted in App.tsx
- `checkForUpdate()` calls the plugin API (will return "no update" in dev — that's expected)
- Progress state updates during download
- Dismissed version prevents re-notification

---

## Task 4: Create `UpdateDialog` component ✅

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:**

- `src/components/UpdateDialog.tsx` — new file

**Description:**

Build the update dialog using shadcn/ui `Dialog`. Follow the existing `ExportDialog.tsx` pattern for structure.

**States:**

1. **Available state** (default when opened):

   - Header: "Update Available"
   - Version line: "v{current} → v{new}" in muted text
   - Release notes rendered via `react-markdown` (already a dependency) inside a `ScrollArea` (max-h-48)
   - Footer: "Install & Restart" primary button + "Later" outline button

2. **Downloading state**:

   - Same header/body
   - Footer replaced with shadcn/ui `Progress` bar showing percentage + "Cancel" text button
   - Install the `progress` shadcn/ui component if not already present: `pnpm dlx shadcn@latest add progress`

3. **Error state**:

   - Toast via sonner with error message
   - Dialog stays open with "Retry" button

**Props:**

```typescript
interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: { version: string; notes: string | null; date: string | null } | null;
  status: 'available' | 'downloading' | 'error';
  progress: number | null;
  onInstall: () => void;
  onDismiss: () => void;
}
```

**Design requirements:**

- Max-width 480px, follows design system neutral palette
- Backdrop blur on overlay (consistent with other dialogs)
- Smooth transitions on open/close
- Release notes readable in both light and dark mode
- No chromatic accent colors

**Acceptance criteria:**

- Dialog renders correctly in all three states
- "Later" calls `onDismiss`, "Install & Restart" calls `onInstall`
- Progress bar animates smoothly during download
- Looks polished in both light and dark mode

---

## Task 5: Add update indicator to StatusBar ✅

**Complexity:** M **Category:** frontend **Dependencies:** #3, #4 **Files:**

- `src/components/editor/StatusBar.tsx` — add update indicator
- `src/components/editor/Editor.tsx` or `src/App.tsx` — wire hook and pass props

**Description:**

Add an update-available indicator to the **left zone** of the status bar (after the git branch, before the spacer).

1. Add new props to `StatusBarProps`:

   ```typescript
   updateAvailable?: boolean;
   updateVersion?: string | null;
   onUpdateClick?: () => void;
   ```

2. When `updateAvailable` is true, render:

   - `ArrowUpCircle` icon (lucide, 12px, `h-3 w-3`) with tooltip "Update available: v{version}"
   - Clickable — calls `onUpdateClick` which opens the `UpdateDialog`
   - Subtle pulse animation (CSS `animate-pulse` or custom keyframe) on the icon, but restrained — once every few seconds, not constant

3. Wire in the parent component:

   - Mount `useAutoUpdate` hook at `App.tsx` level (or in the component that renders the editor + status bar)
   - Pass update state down to `StatusBar`
   - Render `UpdateDialog` controlled by local state, opened by status bar click or by the initial toast

4. Show a toast via sonner when update is first detected: "Notesage {version} is available" with an action button "View" that opens the dialog. Use stable toast `id: "update-available"` to prevent duplicates.

**Acceptance criteria:**

- Update indicator appears in status bar left zone when an update is available
- Tooltip shows version
- Click opens the UpdateDialog
- Toast fires once on first detection, not repeatedly
- Indicator persists after dismissing dialog (until app restart or version dismissed)

---

## Task 6: Add update section to Settings dialog ✅

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:**

- `src/components/settings/SettingsDialog.tsx` — add "About" tab or section to "Editor" tab

**Description:**

Add an "About" tab to the Settings dialog for version info and update controls.

1. Add a new tab entry to `TABS` array:

   ```typescript
   { id: 'about', label: 'About', icon: Info }
   ```

   Place it last in the list. Add `'about'` to the `SettingsTab` union type.

2. Tab content:

   - **App identity:** "Notesage" title + current version from `package.json` (use `__APP_VERSION__` Vite define or read from the app). Display: "Version 0.15.1"
   - **Check for updates** row (same card style as other settings):
     - Label: "Check for Updates"
     - Description: Last checked timestamp (e.g., "Last checked: 2 minutes ago") or "Never checked" — use relative time formatting
     - Action: Button "Check Now" — triggers `checkForUpdate()` from the hook
     - Loading state: Button shows spinner + "Checking..." while status is `checking`
     - Result: If update found, text changes to "Update available: v{version}" with "View" link. If up to date, shows "You're up to date" with checkmark.
   - **Auto-check toggle** row:
     - Label: "Automatically Check for Updates"
     - Description: "Check for new versions when the app starts"
     - Switch bound to `settings-store.autoCheckUpdates`

3. The `useAutoUpdate` hook needs to be accessible from Settings. Options:

   - Lift hook to `App.tsx` and pass via context or props
   - Or call the hook in Settings too (it should be safe to call `checkForUpdate` from multiple places since it's idempotent)

**Acceptance criteria:**

- "About" tab appears in Settings sidebar
- Current version is displayed correctly
- "Check Now" triggers a check and shows result
- Auto-check toggle persists across restarts
- Last checked timestamp updates after each check

---

## Task 7: Verify CI generates `latest.json` and update release workflow ✅

**Complexity:** S **Category:** both **Dependencies:** #1 **Files:**

- `.github/workflows/release.yml` — possibly add `updaterJsonPreferNsis` or verify existing config

**Description:**

The `tauri-apps/tauri-action` should automatically generate and upload `latest.json` to the GitHub Release when `TAURI_SIGNING_PRIVATE_KEY` is set and the app has the updater plugin configured. Verify this works:

1. Review the current `release.yml` — the action already receives `TAURI_SIGNING_PRIVATE_KEY` env var. With the updater plugin now configured in `tauri.conf.json`, the action should generate `latest.json` automatically.

2. If needed, add `updaterJsonPreferNsis: true` to the `with` block of the `tauri-apps/tauri-action` step (ensures Windows uses NSIS format in the manifest).

3. After the next tag push, verify:

   - `latest.json` appears as a release asset
   - The JSON contains valid platform entries with signatures and URLs
   - The endpoint URL (`https://github.com/PeterBlenessy/notesage/releases/latest/download/latest.json`) resolves correctly

4. Consider whether the `publish-release` job (which flips the release from draft to published) needs adjustment — `latest.json` must be attached before the release is published, which should already be the case since `tauri-action` uploads to the draft release.

**Acceptance criteria:**

- After a tagged release build, `latest.json` is attached to the GitHub Release
- The manifest contains entries for all built platforms
- The endpoint URL resolves to the latest manifest