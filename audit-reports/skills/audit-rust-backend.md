# Proposal: improvements to `audit-rust-backend/SKILL.md`

Source of truth: `/home/user/notesage/audit-reports/03-rust-backend.md` (2026-06-03 pass).
The seed skill is a generic Rust checklist with no Notesage-specific guidance and no coverage of the highest-impact classes the audit actually surfaced (unbounded allocations from subprocess-controlled framing, SSRF, mutex poisoning vs. lock-across-await). This proposal is surgical: fixes, new checks, and modern-judgment additions — each traceable to a finding. Do not edit `SKILL.md` until approved.

---

## 1. Stale / incorrect guidance to fix

### 1a. Mutex guidance frames "lock across `.await`" as the danger; the real footgun here is std-Mutex poisoning

The audit's notes section (`03-rust-backend.md:163`) explicitly says: *"std `Mutex` poisoning is the modern footgun, not 'holding a lock across `.await`.' The codebase already moved hot paths to `parking_lot` (`index/`, `watcher`) and tokio `Mutex` (acp/mcp/proxy) — correctly."* The current skill over-weights the await case and never mentions poisoning at all.

**Current text (SKILL.md:17-18):**
```
- **Locks across `.await`:** Find `Mutex` guards held across `.await` points. `std::sync::Mutex` guards must NOT be held across awaits. `tokio::sync::Mutex` is safe but may still cause contention.
- **Mutex type selection:** Verify `parking_lot::Mutex` or `std::sync::Mutex` is used in sync contexts, and `tokio::sync::Mutex` in async contexts.
```

**Replacement:**
```
- **Locks across `.await`:** Find `Mutex` guards held across `.await` points. `std::sync::Mutex` guards must NOT be held across awaits (`!Send` guard breaks the future). `tokio::sync::Mutex` is safe across awaits but may still cause contention.
- **std `Mutex` poisoning across panics:** A `std::sync::Mutex` is poisoned permanently if any code under the guard panics — every later `.lock()` then returns `Err` until the app restarts. Flag any std `Mutex` whose guard wraps code that can panic (FFI calls, parsing, indexing). Prefer `parking_lot::Mutex` (no poisoning — the convention already used in `index/` and `watcher.rs`) or recover via `.lock().unwrap_or_else(|e| e.into_inner())`. This is a higher-priority finding in this codebase than the await case.
- **Long-held locks pinning shared resources:** Beyond I/O, flag a guard held across a multi-second/minutes-long compute section (e.g. whole-file inference) — it serializes work the product markets as concurrent and pins the cached resource for the duration.
- **Mutex type selection:** Verify `parking_lot::Mutex` or `std::sync::Mutex` in sync contexts, `tokio::sync::Mutex` in async contexts. In Notesage: `parking_lot` for hot sync state (`index/`, `watcher`), tokio `Mutex` for async lifecycle state (`acp`, `mcp`, `network_proxy`).
```
Evidence: H2 — `whisper_ctx` std `Mutex` held across whole-file Whisper, poisons on FFI panic (`transcription.rs:538`, held `:919-966`). Note 2 (`03-rust-backend.md:163`).

### 1b. "Large Allocations" check assumes allocations are sized by *our* loops; misses subprocess-controlled sizing

**Current text (SKILL.md:44-47):**
```
### Large Allocations

- Find unnecessary `.clone()` on large `String` or `Vec<u8>` values
- Find unbounded `Vec` accumulation in loops without capacity hints
- Check for double reads (reading the same resource twice instead of binding the result)
```

**Replacement (rename the section and lead with the attacker-controlled case):**
```
### Allocations Sized By Untrusted Input

- **Allocation from a wire-supplied length:** Find `vec![0u8; n]` / `Vec::with_capacity(n)` / `String` reads where `n` comes from a subprocess, socket, or file header. Verify an explicit upper bound is enforced *before* the allocation — a timeout wrapping the subsequent read does NOT help, the allocation already happened. Reference good pattern: `gguf_parser.rs` caps strings at 10 MB; reference bad pattern: `json_rpc.rs` `Content-Length` body alloc.
- **Unbounded body / output buffering:** Find `resp.text()`, `response.json()`, `read_to_end`, and reader loops with no byte cap. Stream with a running-total cap instead.
- Find unnecessary `.clone()` on large `String` or `Vec<u8>` values.
- Find unbounded `Vec` accumulation in loops without capacity hints.
- Check for double reads (reading the same resource twice instead of binding the result).
```
Evidence: H1 (`json_rpc.rs:229,380` unbounded `vec![0u8; content_length]` + unbounded header `read_line` `:194-214`), M3 (`web_search.rs:35`, `link_preview.rs:48-51`, `model_metadata.rs:216,319`), M4 (`script_exec.rs:86-108`).

---

## 2. New checks to add (new "What to Search For" subsections)

### 2a. Add — SSRF & host-supplied fetches in the main (unsandboxed) process

```
### SSRF & Host-Supplied Fetches

The agent network sandbox only gates *subprocess* traffic. Tauri commands that fetch a URL run in the main process, unsandboxed. For each command that calls `reqwest`/`client.get()` with a URL sourced from user paste, agent output, or document content:

- **No private-IP guard:** Verify the resolved host is rejected if it is loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` — incl. cloud metadata `169.254.169.254`), private RFC1918, or CGNAT. Missing guard = SSRF probe of internal services.
- **Redirects re-resolve:** A `redirect::Policy::limited(n)` lets a public host bounce to an internal target. The private-IP check must run on *every* redirect hop via a custom redirect policy, not just the initial URL.
- **Response returned to caller:** If `<title>`/`<description>`/body text flows back to the frontend, that is an info-leak channel for the probe.
- **No body cap:** `resp.text()` on a hostile page is also a memory-exhaustion amplifier (see Allocations).
```
Evidence: M2 — `fetch_link_metadata` takes an arbitrary URL, follows 3 redirects, no private-IP block, returns parsed metadata, unbounded `resp.text()` (`link_preview.rs:16-53`). Audit notes the same guard belongs on `web_search` upstream.

### 2b. Add — Archive extraction (Tar/Zip slip) and download integrity

```
### Archive Extraction & Download Integrity

For any code that extracts a downloaded archive (tar/zip) to disk:

- **Path traversal (Tar-Slip):** Reject entries whose path contains `Component::ParentDir` (`..`) or `Component::RootDir`, OR canonicalize the destination and assert `dest.starts_with(extract_root)`. Stripping the top-level dir (`components().skip(1)`) does NOT prevent `..` escape.
- **Attacker-controlled mode bits:** Mask permissions from the archive (`& 0o755`) — never apply `set_permissions` with the raw archive mode (setuid / world-writable risk).
- **No integrity check:** Flag a download with no pinned SHA-256 / signature verification before extraction, even over HTTPS — defense-in-depth against an origin compromise or TLS MITM.
```
Evidence: M1 — Node.js runtime tarball extraction strips only the top dir, joins `..` unchecked, applies raw mode, no checksum (`agent_manager.rs:522-552`).

### 2c. Add — Recursion depth on parsers of untrusted binary/text

```
### Parser Recursion & Slice/Index Panics

For recursive parsers (binary headers, nested structures) fed by files or downloads the user can point at:

- **Unbounded recursion depth:** Per-element/per-length caps are not enough — a nested-container input (array-of-array-of-…) drives recursion to stack overflow, which aborts the process (panic-on-overflow is NOT catchable at the command boundary). Thread a depth counter and reject beyond a small limit (~8).
- Check slice indexing / `[..n]` and arithmetic on header-derived sizes for overflow.
```
Evidence: M5 — GGUF `read_gguf_value` recurses on `GGUF_TYPE_ARRAY` with per-array/per-string caps but no depth bound; custom models are an input path via `custom-models.json` (`gguf_parser.rs:182-193`).

### 2d. Add — Single-read network parsing assumptions

```
### Streamed-Read Parsing Assumptions

Flag protocol parsing that assumes a complete message arrives in one `read()` and fits a fixed buffer (e.g. `let n = sock.read(&mut buf[..8192]).await?` then parse). TCP delivers partial reads; oversized headers truncate. Loop until the framing delimiter (`\r\n\r\n`) with a max-size cap before parsing.
```
Evidence: L4 — network proxy reads one 8 KB buffer and parses the request line/headers, truncating on partial or >8 KB requests (`network_proxy.rs:256-284`).

### 2e. Add — PID-reuse safety in subprocess cleanup

```
### PID-Reuse Safety in Cleanup

For cleanup paths that `kill <pid>` using a PID read from a `.pid` file on disk (startup orphan recovery), verify the PID still belongs to the expected binary before signalling — validate the command name (`/proc/<pid>/comm` on Linux, `ps -o comm=` on macOS) or store a start-timestamp alongside the PID. A crash + OS PID recycle otherwise signals an unrelated user process.
```
Evidence: L1 — `kill_orphaned_servers` / `stop_sync` / `kill_server_process` signal disk-read PIDs with no ownership check (`local_inference.rs:454-477,58-80,383-393`).

---

## 3. Modern-judgment additions (predate the seed skill)

Add a new top section before "Output Format", titled **"Severity calibration for Tauri-v2 backends"**, capturing judgment the audit applied that a dated `.unwrap()`-hunting checklist misses:

```
### Severity calibration for Tauri-v2 backends

- **`#[tauri::command]` panics are IPC errors, not process aborts — except allocator/overflow/stack panics.** Most `.unwrap()` in a command body becomes a rejected promise to the frontend; do not flood the report with provably-guarded `.unwrap()`s (e.g. on a value just matched `Some`). DO prioritize panics the command boundary cannot contain: allocator panics (`vec![0u8; huge]`), arithmetic overflow, and stack overflow from unbounded recursion — these abort the whole app.
- **kill_on_drop completeness.** Verify the cleanup contract is real, not implicit. If the spawned `Child` is moved into a `tokio::spawn(child.wait_with_output())` task, `kill_on_drop(true)` is defeated — the wait task pins the child alive and cleanup must rely on `kill <pid>`. Prefer keeping the `Child` in state so cleanup can `start_kill()` + `wait()` deterministically, draining pipes via taken handles. Check that `RunEvent::Exit` cleanup is exhaustive across every spawner (ACP, MCP, llama-server main + completion server).
- **Orphaned reader tasks on timeout.** When a child is killed on a timeout, verify the spawned stdout/stderr reader tasks are awaited or aborted — not left to leak until the killed child's pipes close.
- **Blocking calls on async threads.** Flag synchronous/long-blocking compute (FFI inference, blocking I/O) executed directly in an async fn / under a tokio `Mutex` without `spawn_blocking` — it stalls the runtime worker.
- **Unbounded channels.** Flag `unbounded_channel()` fed by a source the peer/subprocess controls (no backpressure → memory growth); prefer a bounded channel.
- **Shell vs. AppleScript escaping conflation.** When building a command string passed through two layers (shell + `osascript do script`), one escaping model cannot satisfy both. Prefer building argv without a shell hop; if a string literal is unavoidable, assert callers pass only vetted constants and use one correct escaper.
```
Evidence: Note 1 (`03-rust-backend.md:162`), L2 (`local_inference.rs:307-339`), Note 3 (`:164`), M4 orphaned reader tasks (`script_exec.rs:122`), H2 blocking inference under std Mutex, L3 escaping (`dialog.rs`).

Note: "kill_on_drop", "RunEvent::Exit", "stdout/stderr consumed", and "PID tracking" already appear under the existing **Process Management** check (SKILL.md:28-34) — the additions above deepen *completeness/defeat* judgment rather than duplicating the presence checks. Do not re-list the basic presence bullets.

---

## 4. Confirmed-good patterns worth seeding into the skill's closing section

The skill already mandates a `### Confirmed Good Patterns` section. Seed it with the references the audit validated so future runs don't re-flag them:
- `gguf_parser.rs` 10 MB string cap (good allocation bound).
- `parking_lot::Mutex` in `index/` and `watcher` (no poisoning).
- ACP `stop_all_sync` (SIGKILL by PID + bounded join) and MCP `start_kill` at exit (good cleanup).
- Guarded `.unwrap()`s at `ai_streaming.rs:844`, `copilot_protocol.rs:154` — provably safe, do not flag.

Evidence: `03-rust-backend.md:33,163,164,162`.
