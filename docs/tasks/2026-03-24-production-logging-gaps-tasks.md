# Production Logging Gaps — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Not started |
| **Bug** | [production-logging-gaps](../bugs/2026-03-24-production-logging-gaps.md) |
| **Total** | 9 tasks: 4S, 4M, 1L |
| **Suggested order** | Log level (#1) → Logger adoption (#2-#4) → Connection logging (#5) → Routing logging (#6) → Diagnostic dump (#7-#8) → Verify (#9) |

### Already completed (from fix-poisoned-lock work)

The following items from the bug report are **already resolved** and do not need tasks:

- **Gap #3** (lock_or_recover flooding): Eliminated by parking_lot migration (commit `06706e2`) — `lock_or_recover()` no longer exists
- **Gap #4** (action scan retry flooding): Circuit breaker already in `action-store.ts` (`_consecutiveFailures`, `_scanDisabled`)
- **Gap #5** (initial panic not captured): `catch_unwind` already wraps index init in `index/mod.rs:605`
- **Gap #6** (frontend logging bridge): `log_frontend` Tauri command + `src/lib/logger.ts` with batching already exist

### Risks

- Replacing `devLog`/`console.log` with `log.*` in `useLocalAI.ts` will produce backend log output in production — ensure log levels are appropriate (info for decisions, debug for verbose state)
- Connection store logging must not log sensitive data (API keys, tokens) — log provider type and ID only
- Diagnostic dump will include store state from localStorage — must redact API keys before export

---

## #1 — Replace debug logging toggle with log level selector

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | None |
| **Files** | `src/lib/logger.ts`, `src/stores/settings-store.ts`, `src/components/settings/SettingsDialog.tsx`, `src-tauri/src/lib.rs`, `src/hooks/useAppLifecycle.ts`, `src/lib/tauri.ts` |

**Description:**

Replace the binary `debugLogging` toggle with a 4-level log level selector: Error, Warn, Info, Debug.

**Frontend (`logger.ts`):**
1. Replace `let debugEnabled = false` with `let minLevel: 'error' | 'warn' | 'info' | 'debug' = 'warn'`
2. Replace `setDebugLogging(enabled)` with `setLogLevel(level)` — assign numeric priority (error=0, warn=1, info=2, debug=3)
3. Update `shouldForward()`: in dev always forward; in prod forward if the entry's level priority ≤ `minLevel` priority
4. Update console output gating in `logImpl()` to use the same level check

**Settings store:**
1. Replace `debugLogging: boolean` with `logLevel: 'error' | 'warn' | 'info' | 'debug'` (default: `'warn'`)
2. Replace `setDebugLogging()` with `setLogLevel()`
3. Add migration in `partialize` or `migrate` to convert existing `debugLogging: true` → `'debug'`, `false` → `'warn'`

**Backend (`lib.rs`):**
1. Replace `set_debug_logging(enabled: bool)` with `set_log_level(level: String)` that maps:
   - `"error"` → `log::LevelFilter::Error`
   - `"warn"` → `log::LevelFilter::Warn`
   - `"info"` → `log::LevelFilter::Info`
   - `"debug"` → `log::LevelFilter::Debug`
2. Update default in `setup()` to `log::LevelFilter::Warn`

**Settings UI:**
1. Replace the `<Switch>` for "Debug Logging" with a `<Select>` dropdown labeled "Log Level"
2. Options: Error (errors only), Warn (default — errors + warnings), Info (+ diagnostic info), Debug (verbose)
3. On change: call `setLogLevel()` on store + `tauriApi.setLogLevel(level)` to update backend
4. Keep the log path display and clear button below

**Tauri bridge (`tauri.ts`):**
1. Replace `setDebugLogging(enabled)` with `setLogLevel(level)` calling `set_log_level`

**App lifecycle (`useAppLifecycle.ts`):**
1. Read `logLevel` from settings store on startup
2. Call `tauriApi.setLogLevel(logLevel)` and `setLogLevel(logLevel)` from logger

**Acceptance criteria:** User can select Error/Warn/Info/Debug in Settings. Default is Warn. Selection persists across restarts. Both frontend forwarding and backend `log::max_level` respect the chosen level.

---

## #2 — Migrate `useLocalAI.ts` from `devLog` to structured logger

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useLocalAI.ts` |

**Description:**

1. Replace `import { devLog }` pattern with `import { log } from '@/lib/logger'`
2. Remove the `devLog` helper function
3. Convert all 14 `devLog(...)` calls to `log.info('local-ai', ...)` or `log.debug('local-ai', ...)`:
   - Auto-start decision points → `log.info` (these are the key diagnostic gaps)
   - Verbose state (model list counts, binary paths) → `log.debug`
   - Errors → `log.error`
4. Add explicit log messages at each auto-start skip point:
   - `"Auto-start skipped: no Local AI connection"`
   - `"Auto-start skipped: no activeModelId"`
   - `"Auto-start skipped: binary not available (status: {binaryStatus})"`
   - `"Auto-start skipped: model not found in catalog (id: {activeModelId})"`
   - `"Auto-start skipped: model not downloaded"`
   - `"Auto-start: starting server with model {modelId}"`

**Acceptance criteria:** Opening production logs shows exactly which auto-start condition failed or that the server was started.

---

## #3 — Migrate `useLocalCompletion.ts` from console to structured logger

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useLocalCompletion.ts` |

**Description:**

1. Import `log` from `@/lib/logger`
2. Replace `console.log`/`console.info` calls with `log.debug('local-completion', ...)`
3. Ensure error backoff events are logged at `warn` level

---

## #4 — Migrate `useProjectMetadata.ts` and `useAIOperations.ts` console calls

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useProjectMetadata.ts`, `src/hooks/useAIOperations.ts` |

**Description:**

1. Both files have stray `console.log`/`console.info` calls alongside existing `log` imports
2. Replace remaining `console.*` calls with the appropriate `log.*` calls
3. `useAIOperations.ts` already imports `log` — just convert the remaining console call

---

## #5 — Add connection lifecycle logging to `connections-store.ts`

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/connections-store.ts` |

**Description:**

1. Import `log` from `@/lib/logger`
2. Add logging to `addConnection`:
   - `log.info('connections', 'Connection added', { id, provider, authMethod, capabilities })`
   - Do NOT log `apiKey`, `credentials`, or `envVars` fields
3. Add logging to `updateConnection`:
   - `log.info('connections', 'Connection updated', { id, fields: Object.keys(updates) })`
4. Add logging to `removeConnection`:
   - `log.info('connections', 'Connection removed', { id, provider })`

**Acceptance criteria:** Production logs show connection create/update/delete events with provider type but no secrets.

---

## #6 — Add routing assignment logging to `routing-store.ts`

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #5 |
| **Files** | `src/stores/routing-store.ts` |

**Description:**

1. Import `log` from `@/lib/logger`
2. Log when routing slots are assigned:
   - `log.info('routing', 'Route assigned', { useCase: 'interactive', connectionId, provider })`
3. Log auto-assignment decisions:
   - `log.info('routing', 'Auto-assigned first connection to all compatible slots', { connectionId })`

**Acceptance criteria:** Can determine from logs which provider is handling each use case.

---

## #7 — Add diagnostic dump Tauri command

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/logging.rs`, `src-tauri/src/lib.rs` |

**Description:**

1. Add `collect_diagnostics` Tauri command that gathers:
   - Backend state: index DB status (exists, file size, table row counts), watcher state (watched paths count), local AI server status (PID, port, running), ACP sessions (count, provider types)
   - System info: OS version, memory, architecture
   - Log file paths and sizes
2. Return as a structured JSON object
3. Register command in `generate_handler![]` in `lib.rs`

**Acceptance criteria:** `invoke('collect_diagnostics')` returns a JSON object with all backend state summaries, no sensitive data.

---

## #8 — Add "Export Diagnostics" button to Settings > Advanced

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #7 |
| **Files** | `src/components/settings/SettingsDialog.tsx` (or relevant settings tab) |

**Description:**

1. Add an "Export Diagnostics" button in the Advanced section of Settings
2. On click:
   a. Call `invoke('collect_diagnostics')` for backend state
   b. Collect frontend state: connections (redacted — no API keys), routing config, local AI store state, settings store state, active tab count
   c. Merge into a single JSON object with `{ backend, frontend, timestamp, version }` structure
   d. Show native save dialog (default filename: `notesage-diagnostics-{date}.json`)
   e. Write to disk via `save_binary_file` (or `write_file`)
3. Redaction: strip `apiKey`, `credentials`, `envVars` from any connection data before export
4. Show success toast with file path

**Acceptance criteria:** User can export a diagnostics file that includes all state needed to diagnose production issues, with no API keys or tokens included.

---

## #9 — Verify logging coverage in production build

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | #1, #2, #3, #4, #5, #6 |
| **Files** | None (manual verification) |

**Description:**

1. Build production app (`pnpm tauri build`)
2. Launch and verify log file at `~/Library/Logs/com.notesage.app/`
3. Check that the following scenarios produce log entries:
   - App startup with Local AI enabled but binary missing → "Auto-start skipped: binary not available"
   - Adding a new connection → "Connection added"
   - Routing auto-assignment → "Route assigned"
   - Action scan circuit breaker triggering → "fullScan circuit breaker" (already exists)
4. Verify no API keys or tokens appear in log files
5. Test diagnostic dump export and verify output is complete and redacted

6. Test log level selector: set to Info, verify info-level messages appear; set back to Warn, verify they stop
7. Verify log level persists across app restart

**Acceptance criteria:** All six gaps from the bug report are addressed; log level selector works end-to-end; production logs are sufficient to diagnose the three related bugs (Local AI not starting, custom provider failures, index poisoning).
