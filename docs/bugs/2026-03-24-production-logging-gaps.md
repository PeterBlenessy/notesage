# Bug: Insufficient production logging for diagnosing issues

|  |  |
| --- | --- |
| **Date observed** | 2026-03-24 |
| **Status** | Open |
| **Tasks** | [production-logging-gaps-tasks](../tasks/2026-03-24-production-logging-gaps-tasks.md) |
| **Severity** | Low (enabler) |
| **Impact** | Not user-facing, but blocks diagnosis of other bugs |
| **Versions affected** | All versions |

## Problem

Several production bugs (Local AI not starting, custom provider failures, index poisoning) are difficult to diagnose because the logging system has significant gaps. Key decision points produce no log output, making it impossible to determine root causes from production logs alone.

## Specific gaps identified

### 1. Local AI auto-start decisions (no logging)

The `useLocalAI.ts` hook evaluates 5 conditions before starting the server. When any condition fails, the server silently doesn't start. No log entry is produced explaining which condition was unmet.

**What we need:** "Local AI auto-start skipped: binaryStatus=not_found" or "Local AI auto-start skipped: no activeModelId"

### 2. Connection lifecycle (no logging)

Creating, validating, and routing connections produces no backend logs. When a custom provider fails with "Base URL is required", there's no log of what config was actually stored vs. what was expected.

**What we need:** Log connection creation, config validation results, and routing assignment

### 3. Index lock recovery flooding (too much logging)

`lock_or_recover()` logs a WARN on every single lock access after poisoning — hundreds of times per session. This floods the log file and obscures other important entries.

**What we need:** Rate-limit to once per minute per mutex, or once on first occurrence then suppress

### 4. Action scan retry flooding (too much logging)

When `fullScan()` fails, the frontend retries on every file-changed event (\~1/second). Each failure logs an ERROR. In production this produced 7000+ identical error lines in one session.

**What we need:** Circuit breaker — after N consecutive failures, stop retrying and log a single summary error

### 5. Initial panic not captured (missing logging)

The panic that poisons the index lock is never logged. `std::sync::Mutex` poison indicates a thread panicked, but the panic message and backtrace are lost.

**What we need:** `catch_unwind` around index initialization and watcher callback operations, with the panic payload logged before it propagates

### 6. Frontend-side decisions invisible to backend logs

Many important decisions (auto-start, routing, retry logic) happen in React hooks and Zustand stores. These only appear in browser DevTools console, which is not available in production builds.

**What we need:** A `log.info()` / `log.error()` utility that calls a Tauri command to write to the backend log file, so frontend decisions are captured alongside backend operations

## Proposed changes

1. **Add Tauri command** `log_frontend(level, target, message)` — allows frontend hooks to write to the same log file as the backend
2. **Add diagnostic logging to** `useLocalAI.ts` — log which auto-start condition failed
3. **Rate-limit** `lock_or_recover()` **warnings** — max once per minute per mutex instance
4. **Add circuit breaker to** `fullScan()` — stop retrying after 3 consecutive failures, resume on next successful index operation
5. **Wrap index init in** `catch_unwind` — capture and log the panic payload before it poisons the mutex
6. **Consider a "Diagnostic dump" button** in Settings &gt; Advanced that exports current state (connection statuses, binary paths, store sizes, lock states) to a file for bug reports

## Affected files

- `src-tauri/src/index/mod.rs` — `lock_or_recover()` rate limiting
- `src-tauri/src/commands/logging.rs` — new frontend logging command
- `src/hooks/useLocalAI.ts` — auto-start diagnostic logging
- `src/stores/action-store.ts` — circuit breaker for `fullScan()`
- `src/lib/log.ts` — frontend log utility (already exists, may need backend bridge)