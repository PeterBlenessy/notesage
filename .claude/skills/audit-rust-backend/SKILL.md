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
- **Locks across `.await`:** Find `Mutex` guards held across `.await` points. `std::sync::Mutex` guards must NOT be held across awaits (`!Send` guard breaks the future). `tokio::sync::Mutex` is safe across awaits but may still cause contention.
- **std `Mutex` poisoning across panics:** A `std::sync::Mutex` is poisoned permanently if any code under the guard panics — every later `.lock()` then returns `Err` until the app restarts. Flag any std `Mutex` whose guard wraps code that can panic (FFI calls, parsing, indexing). Prefer `parking_lot::Mutex` (no poisoning — the convention already used in `index/` and `watcher.rs`) or recover via `.lock().unwrap_or_else(|e| e.into_inner())`. This is a higher-priority finding in this codebase than the await case (e.g. a `whisper_ctx` std `Mutex` held across a whole-file Whisper pass poisons on an FFI panic).
- **Long-held locks pinning shared resources:** Beyond I/O, flag a guard held across a multi-second/minutes-long compute section (e.g. whole-file inference) — it serializes work the product markets as concurrent and pins the cached resource for the duration.
- **Mutex type selection:** Verify `parking_lot::Mutex` or `std::sync::Mutex` in sync contexts, `tokio::sync::Mutex` in async contexts. In Notesage: `parking_lot` for hot sync state (`index/`, `watcher`), tokio `Mutex` for async lifecycle state (`acp`, `mcp`, `network_proxy`).

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

### Allocations Sized By Untrusted Input

- **Allocation from a wire-supplied length:** Find `vec![0u8; n]` / `Vec::with_capacity(n)` / `String` reads where `n` comes from a subprocess, socket, or file header. Verify an explicit upper bound is enforced *before* the allocation — a timeout wrapping the subsequent read does NOT help, the allocation already happened. Reference good pattern: a GGUF parser capping strings at 10 MB; reference bad pattern: a JSON-RPC `Content-Length` body alloc with no cap.
- **Unbounded body / output buffering:** Find `resp.text()`, `response.json()`, `read_to_end`, and reader loops with no byte cap. Stream with a running-total cap instead.
- Find unnecessary `.clone()` on large `String` or `Vec<u8>` values.
- Find unbounded `Vec` accumulation in loops without capacity hints.
- Check for double reads (reading the same resource twice instead of binding the result).

### SSRF & Host-Supplied Fetches

The agent network sandbox only gates *subprocess* traffic. Tauri commands that fetch a URL run in the main process, unsandboxed. For each command that calls `reqwest`/`client.get()` with a URL sourced from user paste, agent output, or document content:

- **No private-IP guard:** Verify the resolved host is rejected if it is loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` — incl. cloud metadata `169.254.169.254`), private RFC1918, or CGNAT. Missing guard = SSRF probe of internal services.
- **Redirects re-resolve:** A `redirect::Policy::limited(n)` lets a public host bounce to an internal target. The private-IP check must run on *every* redirect hop via a custom redirect policy, not just the initial URL.
- **Response returned to caller:** If `<title>`/`<description>`/body text flows back to the frontend, that is an info-leak channel for the probe (e.g. a `fetch_link_metadata` command that follows redirects and returns parsed OpenGraph metadata).
- **No body cap:** `resp.text()` on a hostile page is also a memory-exhaustion amplifier (see Allocations).

### Archive Extraction & Download Integrity

For any code that extracts a downloaded archive (tar/zip) to disk:

- **Path traversal (Tar-Slip):** Reject entries whose path contains `Component::ParentDir` (`..`) or `Component::RootDir`, OR canonicalize the destination and assert `dest.starts_with(extract_root)`. Stripping the top-level dir (`components().skip(1)`) does NOT prevent `..` escape (e.g. a Node.js runtime tarball extraction that strips only the top dir and joins `..` unchecked).
- **Attacker-controlled mode bits:** Mask permissions from the archive (`& 0o755`) — never apply `set_permissions` with the raw archive mode (setuid / world-writable risk).
- **No integrity check:** Flag a download with no pinned SHA-256 / signature verification before extraction, even over HTTPS — defense-in-depth against an origin compromise or TLS MITM.

### Parser Recursion & Slice/Index Panics

For recursive parsers (binary headers, nested structures) fed by files or downloads the user can point at:

- **Unbounded recursion depth:** Per-element/per-length caps are not enough — a nested-container input (array-of-array-of-…) drives recursion to stack overflow, which aborts the process (panic-on-overflow is NOT catchable at the command boundary). Thread a depth counter and reject beyond a small limit (~8). (e.g. a GGUF `read_gguf_value` that recurses on array types with per-array caps but no depth bound, reachable via a custom-models config file.)
- Check slice indexing / `[..n]` and arithmetic on header-derived sizes for overflow.

### Streamed-Read Parsing Assumptions

Flag protocol parsing that assumes a complete message arrives in one `read()` and fits a fixed buffer (e.g. `let n = sock.read(&mut buf[..8192]).await?` then parse). TCP delivers partial reads; oversized headers truncate. Loop until the framing delimiter (`\r\n\r\n`) with a max-size cap before parsing. (e.g. a network proxy that reads one 8 KB buffer and parses the request line/headers, truncating on partial or >8 KB requests.)

### PID-Reuse Safety in Cleanup

For cleanup paths that `kill <pid>` using a PID read from a `.pid` file on disk (startup orphan recovery), verify the PID still belongs to the expected binary before signalling — validate the command name (`/proc/<pid>/comm` on Linux, `ps -o comm=` on macOS) or store a start-timestamp alongside the PID. A crash + OS PID recycle otherwise signals an unrelated user process.

### Unsafe Code

Find all `unsafe` blocks. For each:
- Is it necessary? Could safe Rust achieve the same thing?
- Is the invariant documented?
- Is it properly gated behind `#[cfg(...)]` if platform-specific?

### Concurrency

- Find shared mutable state not wrapped in `Mutex`, `RwLock`, or atomic types
- Check `Arc` usage — is the inner type `Send + Sync`?
- Find `static mut` (should never exist)

### Severity calibration for Tauri-v2 backends

- **`#[tauri::command]` panics are IPC errors, not process aborts — except allocator/overflow/stack panics.** Most `.unwrap()` in a command body becomes a rejected promise to the frontend; do not flood the report with provably-guarded `.unwrap()`s (e.g. on a value just matched `Some`). DO prioritize panics the command boundary cannot contain: allocator panics (`vec![0u8; huge]`), arithmetic overflow, and stack overflow from unbounded recursion — these abort the whole app.
- **kill_on_drop completeness.** Verify the cleanup contract is real, not implicit. If the spawned `Child` is moved into a `tokio::spawn(child.wait_with_output())` task, `kill_on_drop(true)` is defeated — the wait task pins the child alive and cleanup must rely on `kill <pid>`. Prefer keeping the `Child` in state so cleanup can `start_kill()` + `wait()` deterministically, draining pipes via taken handles. Check that `RunEvent::Exit` cleanup is exhaustive across every spawner (ACP, MCP, llama-server main + completion server).
- **Orphaned reader tasks on timeout.** When a child is killed on a timeout, verify the spawned stdout/stderr reader tasks are awaited or aborted — not left to leak until the killed child's pipes close.
- **Blocking calls on async threads.** Flag synchronous/long-blocking compute (FFI inference, blocking I/O) executed directly in an async fn / under a tokio `Mutex` without `spawn_blocking` — it stalls the runtime worker.
- **Unbounded channels.** Flag `unbounded_channel()` fed by a source the peer/subprocess controls (no backpressure → memory growth); prefer a bounded channel.
- **Shell vs. AppleScript escaping conflation.** When building a command string passed through two layers (shell + `osascript do script`), one escaping model cannot satisfy both. Prefer building argv without a shell hop; if a string literal is unavoidable, assert callers pass only vetted constants and use one correct escaper.

Note: "kill_on_drop", "RunEvent::Exit", "stdout/stderr consumed", and "PID tracking" already appear under **Process Management** above — the additions here deepen *completeness/defeat* judgment rather than duplicating the presence checks. Do not re-list the basic presence bullets.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<Description — what can go wrong and under what conditions.>

**Fix:** <Suggested fix.>
```

End with a `### Confirmed Good Patterns` section — this is especially important for Rust since many patterns will be correct. Seed it with references already validated in this codebase so future runs don't re-flag them:
- A GGUF parser's 10 MB string cap (good allocation bound).
- `parking_lot::Mutex` in `index/` and `watcher` (no poisoning).
- ACP `stop_all_sync` (SIGKILL by PID + bounded join) and MCP `start_kill` at exit (good cleanup).
- Provably-safe guarded `.unwrap()`s (e.g. on a value just matched `Some`) — do not flag.

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
