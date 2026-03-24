# Fix Index/Watcher Mutex Poisoning — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Complete |
| **Bug** | [2026-03-23-watcher-poisoned-lock](../bugs/2026-03-23-watcher-poisoned-lock.md) |
| **Total** | 7 tasks: 3S, 3M, 1L |
| **Suggested order** | Backend mutex swap (#1) → remove dead code (#2) → circuit breaker (#3) → catch_unwind (#4) → frontend fixes (#5, #6) → health check (#7) |

### Risks

- `parking_lot::Mutex` has a different `MutexGuard` import — must update all `use` statements
- The `transcription.rs` module also uses `std::sync::Mutex` but is not affected by poisoning in production — leave it as-is (it doesn't use `lock_or_recover`)
- The circuit breaker (#3) changes watcher behavior — could mask legitimate rapid edits if thresholds are too aggressive

---

## #1 — Switch index and watcher to `parking_lot::Mutex`

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml`, `src-tauri/src/index/mod.rs`, `src-tauri/src/commands/watcher.rs` |

**Description:**

1. Add `parking_lot = "0.12"` to `Cargo.toml` dependencies
2. In `index/mod.rs`: replace `use std::sync::{Mutex, MutexGuard}` with `use parking_lot::{Mutex, MutexGuard}`
3. In `watcher.rs`: same import replacement
4. `parking_lot::Mutex::lock()` returns `MutexGuard` directly (no `Result`), so all `.lock()` calls become infallible — no need for error handling on lock acquisition

**Acceptance criteria:**

- `cargo build` succeeds with no warnings
- No `std::sync::Mutex` usage remains in `index/mod.rs` or `watcher.rs`
- Existing tests pass

## #2 — Remove `lock_or_recover` and all poison-handling code

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/index/mod.rs`, `src-tauri/src/commands/watcher.rs` |

**Description:**

1. Delete the `lock_or_recover()` function from both files (25 calls in `index/mod.rs`, 16 in `watcher.rs`)
2. Replace every `lock_or_recover(&self.field)?` with `self.field.lock()` — direct, infallible lock
3. Remove `MutexGuard` import if no longer referenced directly (parking_lot's `.lock()` returns it implicitly)

**Acceptance criteria:**

- Zero occurrences of `lock_or_recover`, `PoisonError`, or `into_inner` in the codebase
- `cargo build` succeeds
- No `"Recovering from poisoned lock"` log messages possible

## #3 — Add reindex circuit breaker for cloud-synced files

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/index/mod.rs` |

**Description:**

Add a per-file reindex rate limiter to prevent OneDrive/iCloud sync churn from flooding the system.

1. Add a `HashMap<String, (u32, Instant)>` field `reindex_counts` to `IndexState` (file path → count + window start)
2. In `reindex_file_in_db()` (or at the `process_reindex_queue` call site): before reindexing, check if this file has been reindexed more than 5 times in the last 30 seconds
3. If threshold exceeded: skip the reindex, log a single WARN (`"Skipping rapid reindex for {} ({} times in 30s)"`) and return `Ok(false)`
4. Reset the counter when the 30-second window expires

**Acceptance criteria:**

- A file modified every 2 seconds by a cloud sync agent is reindexed at most 5 times per 30-second window
- Normal editing (save every few seconds) is not affected
- One WARN log per suppression, not per event

## #4 — Wrap index init in `catch_unwind` for diagnostic logging

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/index/mod.rs` |

**Description:**

Even with `parking_lot` (no poisoning), panics during index initialization should be caught and logged rather than crashing the thread silently.

1. In `index_init()` (the Tauri command): wrap the `init_project_db()` + `index_directory()` calls in `std::panic::catch_unwind`
2. If a panic is caught, log it as ERROR with the panic payload: `"Index initialization panicked: {:?}"`
3. Return a descriptive `Err(String)` to the frontend instead of crashing

**Acceptance criteria:**

- A panic during `init_project_db()` produces a clear ERROR log with the panic message
- The Tauri command returns an error instead of the thread dying silently
- Other index operations continue to work after one project fails

## #5 — Add circuit breaker to frontend `fullScan()`

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/action-store.ts` |

**Description:**

Prevent `fullScan()` from retrying endlessly when the backend is broken.

1. Add a `consecutiveFailures` counter (non-persisted state) to the action store
2. In the `catch` block of `fullScan()`: increment the counter. If it exceeds 3, log a single error (`"Full scan disabled after 3 consecutive failures"`) and set a `scanDisabled` flag
3. When `scanDisabled` is true, `fullScan()` returns immediately without calling the backend
4. Reset `consecutiveFailures` and `scanDisabled` on any successful scan, or when the user opens the Actions dashboard (manual trigger)

**Acceptance criteria:**

- After 3 consecutive failures, no more backend calls are made
- Opening the Actions dashboard resets the circuit breaker and tries again
- No unbounded error log growth

## #6 — Debounce action store persistence

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/action-store.ts` |

**Description:**

The action store writes 230KB+ to localStorage on every scan cycle (every 2-3 seconds when cloud files churn). This is excessive.

1. Add a debounce to the Zustand persist middleware for `action-store` — write at most once every 10 seconds
2. Alternatively, use `skipHydration` for the `actions` array and only persist `actionCache` — the actions list can be rebuilt from cache on startup

**Acceptance criteria:**

- `store_write: 'notesage-action-store'` log entries occur at most once every 10 seconds, not every 2-3 seconds
- Action store size does not grow unboundedly across a session

## #7 — Add index health to health check output

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/commands/health.rs`, `src-tauri/src/index/mod.rs` |

**Description:**

The health check currently reports watcher state but not index state. Add index health info.

1. Add a `health_info()` method to `IndexState` that returns: global DB initialized (bool), number of project DBs, reindex queue length
2. Add `index_healthy: bool` and `index_project_count: usize` fields to `HealthStatus`
3. Log index health in the health check output: `"index=ok (5 projects)"` or `"index=no_global_db"`

**Acceptance criteria:**

- Health check log line includes index status
- Frontend health check response includes index info for the settings diagnostics panel