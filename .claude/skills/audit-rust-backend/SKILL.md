---
name: audit-rust-backend
description: Audit Rust backend for mutex issues, panics, process management, and concurrency
user-invocable: true
---

# Audit: Rust Backend

Audit the Rust backend (`src-tauri/`) for correctness and robustness. This is a research-only audit — do not modify any code.

## What to Search For

### Mutex Contention & Deadlocks

- **Long-held locks:** Find `.lock()` calls (both `std::sync::Mutex` and `tokio::sync::Mutex`). Check if I/O, network calls, or other slow operations happen while the lock is held.
- **Nested locks:** Find functions that acquire two or more locks. Check if another code path acquires them in the opposite order (deadlock potential).
- **Locks across `.await`:** Find `Mutex` guards held across `.await` points. `std::sync::Mutex` guards must NOT be held across awaits. `tokio::sync::Mutex` is safe but may still cause contention.
- **Mutex type selection:** Verify `parking_lot::Mutex` or `std::sync::Mutex` is used in sync contexts, and `tokio::sync::Mutex` in async contexts.

### Panic Vectors

Find `.unwrap()` and `.expect()` on `Result` and `Option` values. For each:
- Is the value guaranteed to be `Ok`/`Some` at that point? (e.g., just matched on it)
- Could it reasonably fail at runtime? (e.g., file I/O, network, system calls, parsing)
- Is it in a test context (acceptable) or production code (flag it)?

### Process Management

Check spawned subprocesses for:
- `kill_on_drop(true)` — process killed when handle drops
- Cleanup in `RunEvent::Exit` hook
- Orphan recovery on startup (e.g., `pkill` stale processes)
- PID tracking accuracy — registered on spawn, unregistered on exit
- Zombie prevention — stdout/stderr consumed or dropped

### Error Context

Check `Result<T, String>` error messages:
- Do they include what operation failed?
- Do they include the underlying OS/library error?
- Would a developer be able to diagnose the issue from the error message alone?

### Large Allocations

- Find unnecessary `.clone()` on large `String` or `Vec<u8>` values
- Find unbounded `Vec` accumulation in loops without capacity hints
- Check for double reads (reading the same resource twice instead of binding the result)

### Unsafe Code

Find all `unsafe` blocks. For each:
- Is it necessary? Could safe Rust achieve the same thing?
- Is the invariant documented?
- Is it properly gated behind `#[cfg(...)]` if platform-specific?

### Concurrency

- Find shared mutable state not wrapped in `Mutex`, `RwLock`, or atomic types
- Check `Arc` usage — is the inner type `Send + Sync`?
- Find `static mut` (should never exist)

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<Description — what can go wrong and under what conditions.>

**Fix:** <Suggested fix.>
```

End with a `### Confirmed Good Patterns` section — this is especially important for Rust since many patterns will be correct.

## Example Finding

### MEDIUM: Panic on tokio runtime creation

**File:** `src-tauri/src/commands/acp.rs:411`

```rust
.expect("Failed to create tokio runtime for ACP agent");
```

Creating a tokio runtime can fail under resource exhaustion. This `.expect()` will panic, crashing the entire app instead of returning a graceful error to the frontend.

**Fix:** Replace with `map_err`:
```rust
.map_err(|e| format!("Failed to create tokio runtime: {e}"))?;
```
