# Rust Backend Audit — Notesage Tauri (`src-tauri/src/`)

Date: 2026-06-03
Scope: mutex misuse, panics in command handlers, unbounded memory/channels, process lifecycle, parser/slice panics, unsafe, resource leaks.
Method: source read of high-risk modules (transcription, local_inference, acp, mcp, json_rpc, gguf_parser, network_proxy, agent_manager, exporters, index, link_preview, script_exec) + targeted greps. Read-only; no source modified. `cargo clippy` was attempted but did not finish within the timebox (cold dep build) — findings are from manual review.

## Severity summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 4 |

---

## HIGH

### H1. Unbounded `vec![0u8; content_length]` in JSON-RPC framing → OOM/abort from a subprocess

- **Severity:** High
- **Location:** `src/commands/json_rpc.rs:229` and `src/commands/json_rpc.rs:380` (and the unbounded `read_line` header read at `:194-214`)
- **Evidence:**
  ```rust
  // read_next_message (production path for Copilot LSP + MCP readers)
  let content_length = match timeout(timeout_duration, read_content_length(reader)).await { ... };
  // 2. Read body with timeout
  let mut body = vec![0u8; content_length];   // <-- allocation BEFORE the timeout fires
  match timeout(timeout_duration, reader.read_exact(&mut body)).await { ... }
  ```
  `read_content_length` parses `Content-Length` from the child's stdout with `val.trim().parse().ok()` and applies **no upper bound**. The `vec![0u8; content_length]` allocation happens synchronously, before the timeout-wrapped `read_exact`, so the timeout cannot save you.
- **Impact:** A buggy or malicious MCP server (third-party servers are imported from Claude Desktop / Cursor / VS Code configs and user-authored `.notesage/mcp.json`) or a compromised Copilot LSP that emits `Content-Length: 99999999999\r\n\r\n` triggers a ~100 GB allocation → allocator abort / OOM-kill of the whole app. The header `read_line` loop (`:196`) is likewise unbounded — a server streaming a header line with no newline grows a `String` until OOM. Contrast: `gguf_parser.rs` correctly caps strings at 10 MB.
- **Fix:** Cap `content_length` (e.g. reject `> 64 MB`) inside `read_content_length` / before the `vec!`, returning `ReadMessageResult::Fatal`. Bound the header read with `take(N)` / a max-line guard.

### H2. `whisper_ctx` std `Mutex` held across the entire (minutes-long) inference; panic poisons it permanently

- **Severity:** High
- **Location:** `src/commands/transcription.rs:538` (`whisper_ctx: Arc<Mutex<...>>`), held `:919-966` inside `transcribe_file`
- **Evidence:**
  ```rust
  let ctx_lock = whisper_ctx.lock().map_err(|e| format!("Lock error: {}", e))?; // std::sync::Mutex
  let (_, ctx) = ctx_lock.as_ref().ok_or("Whisper context not loaded")?;
  ...
  whisper_state.full(params, &audio_data).map_err(...)?;   // whole-file Whisper, can run minutes
  // lock held across the full transcription + every get_segment + every emit
  ```
- **Impact:** Two problems. (1) The `std::sync::Mutex` is **poisoned** if any code under the guard panics (e.g. an FFI panic in `whisper_rs`, or `get_segment`/`to_str_lossy` edge case) — every subsequent `transcribe_file` then fails at `.lock()` with "Lock error: poisoned" until the app is restarted. (2) The guard is held for the entire inference, so genuinely concurrent transcription jobs serialize on it while also pinning the cached model — but the doc model markets concurrent jobs (`jobId` disambiguation).
- **Fix:** Use `parking_lot::Mutex` (no poisoning — already used in `index/` and `watcher`) OR recover from poison via `lock().unwrap_or_else(|e| e.into_inner())` (the pattern already used at `:489-491`). Better: only hold the lock to *clone/Arc the context handle*, then run `full()` outside the lock so jobs don't serialize.

---

## MEDIUM

### M1. Tar extraction is vulnerable to path traversal (Tar-Slip) — no `..` filtering

- **Severity:** Medium
- **Location:** `src/commands/agent_manager.rs:522-552` (Node.js runtime tarball extraction)
- **Evidence:**
  ```rust
  let path = entry.path()?.to_path_buf();
  let stripped: PathBuf = path.components().skip(1).collect(); // strips top dir only
  let dest = runtime_dir.join(&stripped);                       // join can escape via ../
  ...
  std::fs::File::create(&dest)? ; std::io::copy(&mut entry, &mut outfile)?;
  std::fs::set_permissions(&dest, Permissions::from_mode(mode)); // attacker-controlled mode
  ```
  `Component::ParentDir` (`..`) entries are not rejected, so an entry like `node-v22/../../../../etc/foo` resolves outside `runtime_dir`. The archive mode bits are also applied verbatim (could set setuid/world-writable).
- **Impact:** Arbitrary file write outside the runtime dir during agent runtime install. Practical exploit needs a malicious tarball from the hardcoded `nodejs.org` HTTPS URL (so requires nodejs.org compromise or TLS MITM) and there is **no checksum/signature verification** of the download — defense-in-depth gap.
- **Fix:** Reject any entry whose `stripped` contains `Component::ParentDir`/`RootDir`, or canonicalize `dest` and assert it `starts_with(runtime_dir)`. Mask the extracted mode (`& 0o755`). Verify a pinned SHA-256 of the tarball.

### M2. SSRF in `fetch_link_metadata` — arbitrary URL, follows redirects, no private-IP block

- **Severity:** Medium
- **Location:** `src/commands/link_preview.rs:16-53`
- **Evidence:**
  ```rust
  pub async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String> {
      let client = reqwest::Client::builder()
          .redirect(reqwest::redirect::Policy::limited(3)) // public→private redirect allowed
          .build()?;
      let resp = client.get(&url).send().await?;          // url is user/agent supplied
      ...
      let html = resp.text().await?;                       // unbounded body read
      Ok(parse_html_metadata(&url, &html))
  }
  ```
- **Impact:** A pasted/agent-authored link card can probe internal services — `http://localhost:…`, `http://169.254.169.254/latest/meta-data/` (cloud metadata), private RFC1918 hosts. The 3-hop redirect policy lets a public domain bounce to an internal target. The page `<title>`/`<description>` is returned to the caller (info leak). `resp.text()` has no size cap (memory). This bypasses the network-sandbox model that gates agent subprocess traffic — this command runs in the main process, unsandboxed.
- **Fix:** Resolve the host and reject loopback/link-local/private/CGNAT ranges (and re-check on each redirect via a custom redirect policy). Cap the body (`.take(N)` over `bytes_stream`). Same private-IP guard belongs on `web_search` upstream and any other host-supplied fetch.

### M3. Unbounded response body reads (memory exhaustion)

- **Severity:** Medium
- **Location:** `src/commands/web_search.rs:35` (`resp.text()`), `src/commands/link_preview.rs:48-51` (`resp.text()`), `src/commands/model_metadata.rs:216,319` (`response.json()`)
- **Evidence:** None of these bound the response size before buffering it fully into memory.
- **Impact:** A large/hostile page or HF API response inflates memory; combined with M2 it's an unauthenticated-input amplifier.
- **Fix:** Stream with a hard byte cap (`bytes_stream()` + running total, abort on overflow), or set `Content-Length` ceilings.

### M4. Unbounded skill-script output capture

- **Severity:** Medium
- **Location:** `src/commands/script_exec.rs:86-108`
- **Evidence:**
  ```rust
  let stdout_task = tokio::spawn(async move {
      let mut buf = Vec::new();
      reader.read_to_end(&mut buf).await;            // no cap
      String::from_utf8_lossy(&buf).to_string()
  });
  ```
  A skill script that emits gigabytes to stdout/stderr grows `buf` without bound until the 30 s–5 min timeout fires. On timeout (`:122`) the spawned reader tasks are neither awaited nor aborted (orphaned until the killed child's pipes close).
- **Impact:** A runaway/malicious skill script (these require user approval to run, which limits exposure) can OOM the app well before the timeout.
- **Fix:** Read into a capped buffer (e.g. truncate at 1–5 MB with an elision marker); abort the reader tasks on the timeout branch.

### M5. GGUF nested-array recursion has no depth limit (stack overflow)

- **Severity:** Medium
- **Location:** `src/commands/gguf_parser.rs:182-193` (`read_gguf_value` → `GGUF_TYPE_ARRAY` recurses)
- **Evidence:** `read_gguf_value` recurses for each array element; an array of arrays of arrays… (each only needs an `elem_type=9` + small count header) drives unbounded recursion depth. Per-array count is capped at 1M and strings at 10MB, but **recursion depth is not bounded**.
- **Impact:** A crafted custom/downloaded GGUF (`~/.notesage/models/llm/custom-models.json` lets users point at arbitrary files) can stack-overflow → process abort (panic-on-overflow is not catchable). Lower likelihood since models come from the curated catalog, but custom models are an input path.
- **Fix:** Thread a depth counter through `read_gguf_value` and reject beyond a small limit (e.g. 8).

---

## LOW

### L1. PID-reuse hazard in server cleanup (`kill -9 <stale pid>`)

- **Severity:** Low
- **Location:** `src/commands/local_inference.rs:454-477` (`kill_orphaned_servers`), `:58-80` (`stop_sync`), `:383-393` (`kill_server_process`)
- **Evidence:** PIDs are read from `.server.pid`/`.completion.pid` on disk and `kill -15`/`kill -9`'d with no verification the PID still belongs to a llama-server.
- **Impact:** After a crash + OS PID recycle, startup cleanup could signal an unrelated user process.
- **Fix:** Validate the process command line (`/proc` on Linux, `ps -o comm=` on macOS) before signalling, or store a start-timestamp alongside the PID.

### L2. `Child` ownership split defeats `kill_on_drop` for the main llama-server

- **Severity:** Low
- **Location:** `src/commands/local_inference.rs:307-339`
- **Evidence:** The spawned `Child` is moved into a `tokio::spawn(async move { child.wait_with_output().await })` task. Cleanup paths (`kill_server_process`, `stop_sync`) therefore can't use the `Child` handle and rely entirely on `kill <pid>`. `kill_on_drop(true)` (`:288`) is effectively dead — the child is pinned alive by the wait task. Functionally fine (SIGTERM→SIGKILL path exists) but the cleanup contract is implicit/fragile.
- **Fix:** Keep the `Child` in state (or an `Arc<Mutex<Option<Child>>>`) so cleanup can `start_kill()` + `wait()` deterministically; drain stdout/stderr via taken pipes instead.

### L3. AppleScript/shell escaping in `run_in_terminal` is mismatched

- **Severity:** Low
- **Location:** `src/commands/dialog.rs` (`run_in_terminal`)
- **Evidence:** `command.replace('\\', "\\\\").replace('\'', "'\\''")` is *shell* single-quote escaping, then the string is embedded in an AppleScript double-quoted `do script` literal with only `"` escaped. The two escaping models are conflated.
- **Impact:** Limited — `command` is sourced from the app's fixed `getAuthGuide()` per-agent strings, not arbitrary user input, so injection isn't currently reachable. Becomes a real injection vector if any caller ever passes user/agent text.
- **Fix:** Build the argv without a shell hop, or use a single correct AppleScript-string escaper; assert callers only pass vetted constants.

### L4. Single-`read` HTTP request parsing in the network proxy can truncate/mis-parse

- **Severity:** Low
- **Location:** `src/commands/network_proxy.rs:256-284`
- **Evidence:** `let mut buf = vec![0u8; 8192]; let n = client.read(&mut buf).await?;` assumes the full request line + headers arrive in one read and fit in 8 KB. A partial TCP read or >8 KB headers truncates `parts`/`target`.
- **Impact:** Sporadic `400 Bad Request` / wrong host parse for large or fragmented requests routed through the agent proxy. Not a safety bug.
- **Fix:** Loop until `\r\n\r\n` is seen (with a max-header cap) before parsing.

---

## Notes — what current Rust/Tauri-v2 judgment flags that a dated checklist would miss

1. **`#[tauri::command]` panics are IPC errors, not process aborts — but allocation/overflow panics still abort.** Most `.unwrap()`s in command bodies turn into a rejected promise. The genuinely dangerous panics here are the *allocator* ones (`vec![0u8; huge]` in H1) and *arithmetic-overflow / stack-overflow* ones (M5), which `catch_unwind`/the command boundary cannot contain — they abort the whole app. The audit prioritized those over the harmless `.unwrap()` noise (e.g. `ai_streaming.rs:844`, `copilot_protocol.rs:154` are both provably guarded and safe).
2. **std `Mutex` poisoning is the modern footgun, not "holding a lock across `.await`."** The codebase already moved hot paths to `parking_lot` (`index/`, `watcher`) and tokio `Mutex` (acp/mcp/proxy) — correctly. The remaining std `Mutex` in `transcription.rs` (H2) is the one that both holds across a long blocking section *and* poisons permanently on panic. The local_inference std `Mutex`es are held only briefly and are low-risk by comparison.
3. **`kill_on_drop` semantics:** verified ACP (`stop_all_sync` SIGKILLs by PID + bounded join — solid) and MCP (`start_kill` at exit, Tokio reaps via SIGCHLD during normal op — acceptable). The one place `kill_on_drop` is *defeated* by ownership is L2 (main llama-server), worth tightening but not a leak in practice.
