# PRD: In-App Auto-Update

**Date:** 2026-02-23 **Status:** ✅ Complete (v0.15.2) **Author:** Claude

## Problem

Users currently have no way to update Notesage without manually downloading a new build from GitHub Releases. This means:

- Users don't know when a new version is available
- Updating requires navigating to GitHub, finding the right asset, downloading, and replacing the app
- No guarantee users are running the latest version with bug fixes and security patches
- Friction discourages adoption of new features

The release CI already signs artifacts with Tauri update keys (`TAURI_SIGNING_PRIVATE_KEY`), so the signing infrastructure is in place — the app just doesn't use it yet.

## Goals

1. **Seamless updates:** Users can update to the latest version without leaving the app
2. **Non-disruptive:** Update checks happen silently; the user is only notified when an update is ready
3. **Transparent:** Users see what version they're on and what's new before updating
4. **Secure:** Updates are cryptographically verified using Tauri's built-in signature verification
5. **Cross-platform:** Works on macOS, Windows, and Linux using the same mechanism

## Non-Goals

- Delta/incremental updates (full replacement is fine for the app's size)
- Auto-update without user consent (always require explicit "Install" action)
- Update channels (beta/stable) — single release channel for now
- Self-hosted update server — GitHub Releases is the distribution mechanism
- Rollback to previous versions

## User Stories

**US-1:** As a user, I want to be notified when a new version of Notesage is available, so that I can stay up to date.

**US-2:** As a user, I want to install updates from within the app with one click, so that I don't have to manually download anything.

**US-3:** As a user, I want to see what's changed in the new version before updating, so that I can decide whether to update now.

**US-4:** As a user, I want to manually check for updates from Settings, so that I don't have to wait for the automatic check.

**US-5:** As a user, I want the update to apply on restart, so that my current work isn't interrupted.

## Technical Approach

### Tauri Updater Plugin

Use `@tauri-apps/plugin-updater` (Tauri v2's official updater). This plugin:

- Checks a remote endpoint for update manifests
- Verifies update signatures against a public key embedded in the app
- Downloads and installs updates (platform-native: `.app` replacement on macOS, NSIS on Windows, AppImage on Linux)
- Supports GitHub Releases as the update endpoint natively via `tauri-action`

### Update Endpoint

The `tauri-apps/tauri-action` GitHub Action (already used in `release.yml`) automatically generates platform-specific update manifests (`latest.json`) and uploads them to the GitHub Release when configured. This manifest contains:

```json
{
  "version": "0.16.0",
  "notes": "Release notes here",
  "pub_date": "2026-02-23T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/.../Notesage.app.tar.gz"
    },
    "darwin-x86_64": { ... },
    "linux-x86_64": { ... },
    "windows-x86_64": { ... }
  }
}
```

The updater plugin fetches this manifest from a configured URL pointing to the latest GitHub Release.

### Update Flow

1. **App launch:** Check for updates silently (after a short delay to not slow startup)
2. **Update available:** Show a subtle, non-modal notification in the status bar or as a toast
3. **User clicks notification:** Dialog shows version number, release notes, and "Install & Restart" button
4. **Download:** Progress indicator while downloading the update
5. **Install:** User confirms restart; app closes, update applies, app relaunches
6. **Manual check:** Settings &gt; General &gt; "Check for Updates" button + current version display

### Signature Verification

The Tauri updater plugin verifies every downloaded update against a public key embedded in `tauri.conf.json`. The corresponding private key (`TAURI_SIGNING_PRIVATE_KEY`) is already configured as a GitHub Actions secret and used during the release build. No additional signing infrastructure is needed.

## UI/UX

### Status Bar Update Indicator

When an update is available, a subtle indicator appears in the editor status bar (left side, near the existing indicators):

- Icon: `ArrowUpCircle` (lucide) or similar, with a badge dot
- Tooltip: "Update available: v0.16.0"
- Click opens the update dialog

### Update Dialog

A centered dialog (shadcn/ui `Dialog`, max-width 480px) with:

- **Header:** "Update Available" with new version number
- **Body:** Release notes (rendered markdown, scroll area if long, max \~200px height)
- **Current version** displayed as muted text (e.g., "Current: v0.15.1 → v0.16.0")
- **Footer actions:**
  - "Install & Restart" primary button
  - "Later" secondary button (dismisses, indicator remains in status bar)
- **Download state:** Progress bar replaces the footer buttons during download, with cancel option
- **Error state:** Toast on failure with "Retry" option

### Settings Integration

In Settings &gt; General (or a new "About" section):

- Current version display: "Notesage v0.15.1"
- "Check for Updates" button — triggers manual check
- "Automatically check for updates" toggle (default: on, persisted in settings-store)
- Last checked timestamp as muted text

### States

| State | UI |
| --- | --- |
| No update | Settings shows "You're up to date" with check timestamp |
| Checking | Settings button shows spinner, "Checking..." |
| Update available | Status bar indicator + toast notification |
| Downloading | Dialog with progress bar and percentage |
| Ready to install | Dialog with "Install & Restart" enabled |
| Error | Toast with error message and retry link |
| Update dismissed | Status bar indicator persists, no repeated toasts until next launch |

## Data Model

### Settings Store Extension

```typescript
// Extend existing settings-store.ts
interface SettingsState {
  // ... existing fields
  autoCheckUpdates: boolean;     // default: true
  lastUpdateCheck: string | null; // ISO timestamp
  dismissedVersion: string | null; // version string dismissed by user (don't re-notify for same version)
}
```

No new Zustand store needed — extend `settings-store`.

### Tauri Configuration

```jsonc
// tauri.conf.json additions
{
  "plugins": {
    "updater": {
      "pubkey": "<TAURI_PUBLIC_KEY>",
      "endpoints": [
        "https://github.com/PeterBlenessy/notesage/releases/latest/download/latest.json"
      ]
    }
  }
}
```

### Frontend Hook

```typescript
// src/hooks/useAutoUpdate.ts
interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'error';
  version: string | null;
  notes: string | null;
  progress: number | null; // 0-100 during download
  error: string | null;
}

function useAutoUpdate(): {
  state: UpdateState;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
}
```

### Tauri Capability

Add updater permission to `src-tauri/capabilities/default.json`:

```json
"updater:default"
```

## Dependencies

### New Dependencies

| Dependency | Purpose |
| --- | --- |
| `tauri-plugin-updater` (Rust) | Tauri updater plugin backend |
| `@tauri-apps/plugin-updater` (npm) | Frontend API for checking/installing updates |

### Existing Infrastructure (No Changes Needed)

- `tauri-apps/tauri-action` in `release.yml` — already generates signed artifacts; needs `updaterJsonPreferNsis: true` (Windows) and `updaterJsonKeepUniversal: true` (macOS) args for manifest generation
- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` GitHub secrets — already configured
- GitHub Releases — already used for distribution

### CI Changes

The `release.yml` workflow needs minor adjustments:

1. Ensure `tauri-action` generates `latest.json` (may already happen with update signing keys present — verify)
2. Set `updaterJsonPreferNsis: true` if not already set for Windows builds
3. The `publish-release` job should ensure `latest.json` is attached to the published release

### Generate Tauri Key Pair (If Not Done)

If the public key hasn't been generated yet:

```bash
pnpm tauri signer generate -w ~/.tauri/notesage.key
```

The public key goes in `tauri.conf.json`, the private key stays as a GitHub secret.

## Implementation Plan

### Task 1: Add Tauri Updater Plugin

- Add `tauri-plugin-updater` to `Cargo.toml`
- Add `@tauri-apps/plugin-updater` to `package.json`
- Register plugin in `lib.rs` builder
- Add updater config to `tauri.conf.json` (public key + GitHub endpoint)
- Add `updater:default` to capabilities

### Task 2: Create useAutoUpdate Hook

- Implement `useAutoUpdate` hook using `@tauri-apps/plugin-updater` API
- `check()` → returns update info or null
- `downloadAndInstall()` → downloads with progress events, then prompts restart
- Integrate with `settings-store` for auto-check preference and dismissed version tracking
- Auto-check on app launch (5-second delay, only if `autoCheckUpdates` is true)

### Task 3: Update Dialog Component

- `UpdateDialog.tsx` — shadcn/ui Dialog with version info, release notes, progress bar
- Render release notes as markdown (use existing `react-markdown` dependency)
- Download progress state with cancel support
- Error handling with retry

### Task 4: Status Bar Integration

- Add update indicator to `StatusBar.tsx` (conditional, only when update available)
- Click opens UpdateDialog
- Subtle animation to draw attention without being annoying

### Task 5: Settings Integration

- Add "About" or extend "General" section in SettingsDialog
- Version display, check button, auto-check toggle
- "Check for Updates" triggers manual check with inline feedback

### Task 6: CI Verification

- Verify `tauri-action` generates `latest.json` with current config
- Test that the endpoint URL resolves correctly after a release
- If needed, add `updaterJsonPreferNsis` or other action params

## Quality Gates

### Functional

- [x]App checks for updates on launch (after 5s delay) when auto-check is enabled

- [x]"Check for Updates" in Settings triggers a manual check and shows result

- [x]Update available notification appears in status bar and as toast

- [x]Update dialog shows correct version number and release notes

- [x]Download progress is displayed accurately

- [x]"Install & Restart" downloads, installs, and relaunches the app

- [x]"Later" dismisses the dialog; status bar indicator remains

- [x]Dismissed version is not re-notified on subsequent app launches

- [x]Next new version after dismissed one triggers notification again

- [x]Update signature verification works (tampered updates are rejected)

- [x]No update check when auto-check is disabled

- [x]Works on macOS (primary), with CI building for Windows and Linux

- [x]App startup is not delayed by update check (async, post-delay)

- [x]No console errors during update flow

### Design

- [x]Update indicator in status bar is subtle and consistent with existing indicators

- [x]Update dialog follows design system (neutral palette, consistent spacing, backdrop blur)

- [x]Progress bar uses shadcn/ui `Progress` component

- [x]Release notes are readable in both light and dark mode

- [x]All interactive elements have hover/active/focus states

- [x]Transitions are smooth (dialog open/close, progress bar animation)

## Out of Scope

- **Beta/canary channels:** Single release channel only; channels can be added later by switching the endpoint URL
- **Background silent updates:** Always require user to click "Install & Restart"
- **Update scheduling:** No "remind me later" or scheduled installs
- **Rollback:** No mechanism to revert to a previous version
- **Delta updates:** Full binary replacement; file size is manageable (\~30-50MB)
- **Custom update server:** GitHub Releases is sufficient; self-hosted can be added by changing the endpoint URL
- **Release notes editing in-app:** Notes come from GitHub Release body as-is