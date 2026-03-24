# Local AI Not Starting in Production — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Complete |
| **Bug report** | [local-ai-not-starting-production](../bugs/2026-03-24-local-ai-not-starting-production.md) |
| **Total** | 9 tasks: 3S, 4M, 2L |
| **Suggested order** | Diagnostics (#1) → Backend (#2) → Frontend (#3-#6) → Cleanup & diagnostics (#7-#9) |

**Risks:**

- Root cause is uncertain — the bug report identifies 3 possible failure points. Task #1 (diagnostics) must run first to narrow down the actual cause.
- Binary bundling issues may require Tauri build config changes that need a full production build to verify.

---

## Task 1: Add diagnostic logging to auto-start decision

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useLocalAI.ts` |

**Description**:The auto-start hook already has logging for most skip conditions (added in a prior fix), but confirm all branches log clearly. Ensure the following are logged at `info` level when auto-start is skipped:

- `startupReady` is false
- `hasLocalAIConnection` is false (with list of connections for context)
- `activeModelId` is null
- `binaryStatus` value when not `available`
- Model not found in catalog or not downloaded (with `models.length` for context)
- Server already running/starting

Also log a summary line when all conditions pass and auto-start proceeds, including: `binaryStatus`, `activeModelId`, `models.length`.

**Acceptance criteria:**

- Running a production build with Local AI configured produces log entries showing exactly which condition prevented (or allowed) auto-start
- No logging when `startupReady` is false (avoid noise before startup completes)

---

## Task 2: Verify sidecar binary bundling in production build

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/tauri.conf.json`, `src-tauri/src/commands/local_inference.rs` |

**Description**:Verify the `check_llama_server_available()` resolution works in a production `.app` bundle:

1. Build a production release (`pnpm tauri build`)
2. Inspect the `.app/Contents/MacOS/` directory for the sidecar binary and its `lib/` directory
3. Run the production build and check the log output from task #1
4. If the binary is missing: fix `tauri.conf.json` `bundle.externalBin` or sidecar configuration
5. If the binary is present but not found by the check: fix path resolution in `check_llama_server_available()` — the `!is_dev || dir.join("lib").exists()` guard may incorrectly filter out the production binary

Add a log line in `check_llama_server_available()` showing each path checked and whether it exists, at `debug` level.

**Acceptance criteria:**

- Production `.app` bundle includes `llama-server` sidecar and its `lib/` dylibs
- `check_llama_server_available()` returns `available: true` in production builds
- Debug log shows the resolution path taken

---

## Task 3: Add manual Start/Stop button to Local AI settings

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/settings/LocalAISettings.tsx`, `src/hooks/useLocalAI.ts` |

**Description**:Add a manual Start/Stop/Restart control to the Local AI settings panel so users can start the server even when auto-start fails.

**UI spec:**

- Add a button group or single button near the server status indicator in LocalAISettings
- When server is `stopped` or `error`: Show "Start" button (enabled only if binary is available AND a model is downloaded)
- When server is `starting`: Show "Starting..." with spinner (disabled)
- When server is `running`: Show "Restart" button
- Button should call the same `startServer()` function used by auto-start
- On failure: show the error message inline (not just a toast) so the user can see what went wrong

**Implementation:**

- Export `startServer()` from `useLocalAI.ts` (or create a `startLocalAIServer()` function in the store) so LocalAISettings can call it
- The button should be disabled with a tooltip explaining why when prerequisites aren't met (e.g., "Download AI engine first", "Select a model first")

**Acceptance criteria:**

- User can manually start the server from settings when auto-start fails
- Clear error feedback when start fails
- Button states match server lifecycle

---

## Task 4: Surface failure reason in connection status

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #1 |
| **Files** | `src/stores/local-ai-store.ts`, `src/hooks/useLocalAI.ts`, `src/components/settings/ConnectionsSettings.tsx` |

**Description**:Replace the generic amber dot with a specific failure reason so users know what to fix.

**Current behavior:** When auto-start fails, the connection shows as `expired` (amber) with no explanation.

**New behavior:** Store a `statusReason` string alongside the connection status. Display it as a subtitle or tooltip on the connection card.

Possible status reasons:

- "AI engine not found — download it in Settings → Local AI"
- "No model selected — choose a model in Settings → Local AI"
- "Model not downloaded — download it in Settings → Local AI"
- "Server failed to start: {error message}"
- "Starting..." (while starting)

**Implementation:**

- Add `serverStatusReason: string | null` to `local-ai-store` (non-persisted)
- Set it alongside `updateConnectionStatus()` calls in `useLocalAI.ts`
- Display it in the Local AI connection card in ConnectionsSettings

**Acceptance criteria:**

- Connection card shows the specific reason for amber/red status
- Reason updates when conditions change (e.g., user downloads binary → reason clears)

---

## Task 5: Add startup diagnostics export for Local AI

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #1 |
| **Files** | `src/hooks/useLocalAI.ts` |

**Description**:After the startup check completes, log a single structured diagnostic summary at `info` level:

```
Local AI startup diagnostics:
  connection: true/false
  activeModelId: "gemma-3-4b" / null
  binaryStatus: available/not_found/unknown
  binaryPath: /path/to/binary / null
  modelsLoaded: 18
  modelDownloaded: true/false
  serverStatus: stopped/running/error
  autoStartResult: started / skipped (reason)
```

This gives a single log entry to diagnose issues without requiring step-by-step trace reading.

**Acceptance criteria:**

- Single structured diagnostic log entry appears after startup sequence completes
- Contains all relevant state for debugging auto-start failures

---

## Task 6: Add integration test for binary resolution paths

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | Depends on #2 |
| **Files** | `src-tauri/src/commands/local_inference.rs` |

**Description**:Add Rust unit tests for `check_llama_server_available()` to verify each resolution path:

1. Bundled sidecar path (with triple suffix)
2. Dev binaries directory
3. `~/.notesage/bin/` user install
4. System PATH fallback
5. No binary found at any location

Use a testable helper that accepts a base directory rather than relying on `std::env::current_exe()`, or use `#[cfg(test)]` conditional paths.

**Acceptance criteria:**

- Tests cover all 4 resolution paths + the not-found case
- Tests pass in CI (don't depend on actual binary presence)

---

## Task 7: Remove legacy binary download path and fix "not found" messaging

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | Depends on #2 |
| **Files** | `src/components/settings/LocalAISettings.tsx`, `src/stores/local-ai-store.ts`, `src-tauri/src/commands/local_inference.rs` |

**Description:** The binary is always bundled as a Tauri sidecar (`externalBin` in `tauri.conf.json`). There is no legitimate scenario where a user needs to download it separately. However, legacy code still exists:

- `download_llama_server_binary()` Tauri command downloads to `~/.notesage/bin/`
- `downloadBinary()` / `cancelBinaryDownload()` in `local-ai-store`
- The "AI engine not installed — Download" banner in LocalAISettings
- `binaryStatus: 'downloading'` state + progress bar UI

This dead code is actively harmful: when the bundled sidecar fails to resolve (the actual bug), the UI misleads the user into downloading a duplicate binary to `~/.notesage/bin/`.

**Fixes:**

1. Remove `download_llama_server_binary`, `cancel_llama_server_download` Tauri commands and the `~/.notesage/bin/` resolution path from `check_llama_server_available()` (keep bundled sidecar + system PATH as the only resolution paths)
2. Remove `downloadBinary`, `cancelBinaryDownload`, `binaryDownloadProgress` from `local-ai-store`
3. Replace the download banner with an error message: "AI engine not found — try reinstalling Notesage" when `binaryStatus === 'not_found'`
4. Remove the download progress UI

**Acceptance criteria:**

- No binary download functionality remains
- When binary is not found, user sees a clear reinstall message instead of a download button
- `~/.notesage/bin/` resolution path removed from `check_llama_server_available()`

---

## Task 8: Add cleanup for stale `~/.notesage/bin/` leftovers

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #7 |
| **Files** | `src-tauri/src/commands/local_inference.rs`, `src-tauri/src/commands/logging.rs` |

**Description:** After removing the download path in task #7, users who previously downloaded the binary to `~/.notesage/bin/` will have stale files. Clean them up.

**Implementation:**

1. On startup (in `check_llama_server_available()` or a new init function), if `~/.notesage/bin/llama-server*` or `~/.notesage/bin/lib/` exists, log a warning with the total size
2. Include stale `~/.notesage/bin/` contents in the diagnostics export (task #9)
3. Add `*.tmp` / `*.part` file detection in `~/.notesage/models/llm/` (interrupted model downloads) to the diagnostics export as well

Keep this lightweight — just detection and reporting. No auto-deletion, no UI for cleanup (users can delete `~/.notesage/bin/` manually if they see it in diagnostics).

**Acceptance criteria:**

- Stale `~/.notesage/bin/` files logged at startup as a warning
- Stale files included in diagnostics export

---

## Task 9: Enrich diagnostics export with Local AI state

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | both |
| **Dependencies** | Depends on #1, #7 |
| **Files** | `src-tauri/src/commands/logging.rs`, `src-tauri/src/commands/local_inference.rs`, `src/components/settings/SettingsDialog.tsx` |

**Description**:The existing diagnostics export (`collect_diagnostics` in `logging.rs`) only includes `local_server_running` and `local_server_port`. Enrich it with the full Local AI state needed to debug startup failures.

**Backend — add to** `DiagnosticDump` **/** `collect_diagnostics()`**:**

- `local_ai_binary_status`: result of `check_llama_server_available()` — available/not_found, location, path
- `local_ai_active_model`: the currently configured model ID
- `local_ai_models_dir`: path to `~/.notesage/models/llm/` and whether it exists
- `local_ai_models_on_disk`: list of model files found on disk (name + size, no content)
- `local_ai_bin_dir`: path to `~/.notesage/bin/` — whether it exists and list of files (detects stale leftovers from removed download feature)
- `local_ai_stale_files`: `*.tmp` / `*.part` files in models dir, leftover `~/.notesage/bin/` contents

**Frontend — add to diagnostics dump:**

- `localAI.activeModelId`, `localAI.binaryStatus`, `localAI.serverStatus`, `localAI.serverError`
- `localAI.contextLength`, `localAI.gpuLayers`

**Acceptance criteria:**

- Diagnostics JSON includes comprehensive Local AI section
- All file paths included but no file contents
- Export still works when Local AI is not configured (null/empty values)