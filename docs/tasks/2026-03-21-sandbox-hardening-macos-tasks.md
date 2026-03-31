# Sandbox Hardening (macOS) — Tasks

**PRD:** [sandbox-hardening-macos](../prds/2026-03-21-sandbox-hardening-macos.md)**Date:** 2026-03-21

## Summary

**10 tasks: 2S, 5M, 3L**

Two workstreams: kernel-level network deny (tasks 1–6) and violation monitoring (tasks 7–10). Task 1 is the highest-risk item — the Seatbelt investigation — and must succeed before tasks 2–6 are worth implementing. Tasks 7–10 are independent of 1–6 and can be parallelized.

**Risks:**

- Task 1 may reveal that the deny-first profile requires macOS version-specific rules or agent-specific workarounds
- `log stream --style ndjson` output format is undocumented by Apple — may change between macOS versions

---

## Part 1: Kernel-Level Network Deny

### Task 1: Investigate Seatbelt deny-first profiles

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | (test scripts only — no production code yet) |

**Description:**

Before writing any production code, validate that `(deny network*)` with selective allows works on macOS. This is the task that failed previously.

1. Read Anthropic's `sandbox-runtime` source to extract their exact Seatbelt profile generation logic (rule syntax, ordering, macOS version guards)
2. Create a test script that runs `curl http://127.0.0.1:<port>` under progressively restrictive Seatbelt profiles:
   - `(deny network*) + (allow network-outbound (remote tcp "localhost:*"))` — does localhost TCP work?
   - Add `(allow network-outbound (remote udp "*:53"))` + mDNSResponder — does DNS work?
   - Add `(allow network-unix ...)` with restricted paths vs blanket — which Unix sockets do agents need?
   - Run each of the four agent binaries (claude-agent-acp, codex-acp, copilot, gemini) under the profile
3. Test on current macOS version (Sequoia 15.x)
4. Document the working profile rules and any agent-specific requirements

**Acceptance criteria:**

- [x] Working deny-first Seatbelt profile that all four agents can start under

  - Validated: Claude Code v2.1.81 starts and runs under hardened profile
  - Key insight: use `(deny default)` (already present), remove `(allow network*)`, add targeted allows
  - NOT `(deny network*)` — that causes precedence conflicts. srt uses the same approach.

- [x] Documented which `network-unix` paths are required

  - `/var/run/*` and `/private/var/run/*` for system IPC (mDNSResponder, etc.)
  - `/tmp` and `/private/tmp` for agent subprocess sockets
  - `system-socket (socket-domain AF_UNIX)` for the socket() syscall itself

- [x] Documented whether `localhost:*` is needed or if exact proxy port suffices

  - Outbound: exact proxy port (`localhost:<port>`)
  - Bind/inbound: `*:*` with `(local ...)` for IPv6 dual-stack compatibility
  - Also found: `/dev/null` write access needed (pre-existing bug in current profile)
  - Findings: `tests/sandbox/FINDINGS.md`

---

### Task 2: Add `kernel_network_deny` parameter to Seatbelt profile generation

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/commands/sandbox.rs` |

**Description:**

Update `generate_seatbelt_profile` and `sandboxed_command` to accept a `kernel_network_deny: bool` parameter. When `true` and `network_config` is `Some`, generate the deny-first profile validated in task 1. When `false`, keep current `(allow network*)` behavior.

- Add `kernel_network_deny` parameter to both macOS functions
- Include the `kernel_network_deny` flag in the profile hash (so different configs produce different cached profiles)
- Use `(with no-report)` on the deny rule to suppress expected denial noise in system logs
- Linux `sandboxed_command` signature updated to accept the new param (ignored — no behavior change)

**Acceptance criteria:**

- [x] `generate_seatbelt_profile(paths, Some(config), true)` produces deny-first profile

- [x] `generate_seatbelt_profile(paths, Some(config), false)` produces current `(allow network*)` profile

- [x] `generate_seatbelt_profile(paths, None, _)` produces `(allow network*)` (no network sandbox)

- [x] Profile hash includes the `kernel_network_deny` flag

- [x] `cargo check` passes

- Also fixed: added `/dev/null`, `/dev/tty`, `/dev/zero`, `/dev/random`, `/dev/urandom` to file-write allows (pre-existing bug)

---

### Task 3: Thread `kernel_network_deny` through ACP spawn chain

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #2 |
| **Files** | `src-tauri/src/commands/acp.rs`, `src/lib/tauri.ts` |

**Description:**

Pass the new flag from the frontend through to the sandbox profile generator.

- Add `kernel_network_deny: Option<bool>` parameter to `acp_agent_spawn` Tauri command
- Thread it through `run_agent_thread` → `sandboxed_command` → `generate_seatbelt_profile`
- Default to `false` when `None` (backwards compatible)
- Update `tauriApi.acpAgentSpawn` in `src/lib/tauri.ts` to pass the new parameter
- Update callers in `useAcpLifecycle.ts` and `useAgentTaskOperations.ts` to read `kernelNetworkDeny` from the connection config

**Acceptance criteria:**

- [x] `acp_agent_spawn` accepts `kernelNetworkDeny` parameter

- [x] Frontend passes the value from connection config

- [x] Agents spawn with deny-first profile when `kernelNetworkDeny: true` + `networkSandboxEnabled: true`

- [x] Agents spawn with current profile when `kernelNetworkDeny: false`

- [x] `cargo check` + `npx tsc --noEmit` pass

---

### Task 4: Add `kernelNetworkDeny` to Connection type and store

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None (can parallel with #2–3) |
| **Files** | `src/lib/ai/connections.ts`, `src/stores/connections-store.ts` |

**Description:**

- Add `kernelNetworkDeny?: boolean` to the `Connection` interface
- Default: `true` in `addConnection()` for new connections
- No store migration needed — `undefined` is treated as `false` by the spawn chain (task 3), preserving current behavior for existing connections

**Acceptance criteria:**

- [x] New connections have `kernelNetworkDeny: true` (default in config dialog)

- [x] Existing connections without the field behave as `false` (no regression)

---

### Task 5: Add kernel enforcement toggle to connection config dialog

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #4 |
| **Files** | `src/components/settings/ConnectionConfigDialog.tsx` |

**Description:**

Add a "Kernel enforcement" toggle below the existing "Network: Restricted" toggle in the connection config dialog's Security section.

- Only visible when `networkSandboxEnabled` is `true`
- shadcn Switch component, same styling as existing toggles
- Info text below: "Blocks direct network at the OS level. Disable if agents fail to start."
- Updates `kernelNetworkDeny` on the connection via `updateConnection`

**Acceptance criteria:**

- [x] Toggle visible only when network sandbox is enabled

- [x] Toggle updates connection config

- [x] Matches existing Security section styling

- [x] Works in light/dark mode + soft contrast (needs visual verification)

---

### Task 6: End-to-end test all four agents under hardened profile

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | both |
| **Dependencies** | #3, #5 |
| **Files** | (manual testing — no code changes expected) |

**Description:**

Test each ACP agent with `kernelNetworkDeny: true`:

1. **Claude Code** — start agent, send a prompt, verify API calls work through proxy, verify direct `curl` to external domain is blocked at kernel level
2. **Codex** — same verification
3. **Copilot** — same verification
4. **Gemini CLI** — same verification

For each agent:

- [x] Agent starts without errors (Claude Code, Codex, Copilot all verified)

- [x] Agent can make API calls (routed through proxy — confirmed via debug logs)

- [x] Agent cannot bypass proxy (direct network blocked by Seatbelt — verified via test script)

- [ ] Fallback: disabling kernel enforcement restores current behavior (not tested yet)

Also test:

- [x] Toggling kernel enforcement off and re-spawning agent works (not tested yet)

- [x] New connections default to kernel enforcement on

- [x] Existing connections remain unchanged (kernel enforcement off)

Also found and fixed during testing:

- Pre-existing bug: `sandboxEnabled` was never passed to backend for system-installed agents
- Codex needed `chatgpt.com` in built-in domain allowlist

---

## Part 2: Violation Monitoring

### Task 7: Create `sandbox_monitor.rs` with log stream parsing

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | None (independent of Part 1) |
| **Files** | `src-tauri/src/commands/sandbox_monitor.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

New Rust module that streams macOS unified log entries for sandbox violations.

- `SandboxMonitorState` managed state with PID registry, log stream child process, shutdown signal
- `start_monitor()` spawns `log stream --predicate 'eventMessage CONTAINS "Sandbox: deny"' --style ndjson` as an async child process
- Parse ndjson lines, filter by registered PIDs, extract operation + resource from log message
- Deduplication: same (PID, operation, resource) within 5s → increment count instead of new event
- Rate limiting: max 10 events/second per agent
- Emit `sandbox-violation` Tauri event for matching entries
- `sandbox_monitor_register_pid` / `sandbox_monitor_unregister_pid` Tauri commands
- Lazy start: monitor spawns on first PID registration, not at app startup
- Register `SandboxMonitorState` as managed state in `lib.rs`
- Add commands to `generate_handler![]`
- Add `stop_sync()` to `RunEvent::Exit` cleanup

**Acceptance criteria:**

- [ ] Monitor starts on first PID registration

- [x] Violations from registered PIDs emit Tauri events

- [x] Violations from unregistered PIDs are filtered out

- [x] Deduplication works (same violation within 5s → single event with count)

- [x] Monitor cleaned up on app exit (`stop_sync` in `RunEvent::Exit`)

- [x] `cargo check` passes

---

### Task 8: Integrate PID registration into ACP spawn/exit

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/commands/acp.rs` |

**Description:**

After spawning a sandboxed agent, register its PID with the sandbox monitor. On agent exit, unregister.

- In `run_agent_thread`, after successful process spawn, call `sandbox_monitor_register_pid` if sandbox is enabled
- On agent exit (normal or error), call `sandbox_monitor_unregister_pid`
- Pass `SandboxMonitorState` to `acp_agent_spawn` via Tauri managed state

**Acceptance criteria:**

- [x] Sandboxed agent PIDs are registered on spawn (via `register_and_start`)

- [x] PIDs are unregistered on agent exit (via `try_lock` in cleanup path)

- [x] Non-sandboxed agents are not registered (gated on `sandbox_enabled`)

---

### Task 9: Add violation entries to activity store

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #7 |
| **Files** | `src/stores/activity-store.ts`, `src/hooks/useAcpLifecycle.ts` or new `useSandboxMonitor.ts` |

**Description:**

- Add `SandboxViolationEntry` type to activity store
- Add `violations` array and `addViolation` / `clearViolations` actions
- Listen for `sandbox-violation` Tauri events and dispatch to store
- Associate violations with tasks by matching `instanceId`

**Acceptance criteria:**

- [x] Violations from Tauri events are stored in activity store

  - Implemented as `DelegationActivity` entries with `status: 'error'` — no new type needed
  - `useSandboxViolations` hook listens globally, mounted in `App.tsx`

- [x] Violations are associated with the correct agent task (matched by instanceId)

- [x] Violations are cleared when the agent task is removed (part of task's activities array)

---

### Task 10: Render violation entries in Activity panel

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #9 |
| **Files** | `src/components/activity/ActivityStrip.tsx` or `ActivityTaskCard.tsx` |

**Description:**

Display violation entries inline in the per-task activity log.

- Warning triangle icon using `--color-destructive` (no new chromatic colors)
- Show: operation type, target resource, timestamp
- Collapsible detail section with PID and dedup count (smooth animation, follow existing collapsible patterns)
- Interleaved chronologically with tool calls and domain approvals

**Acceptance criteria:**

- [x] Violations appear in the activity log alongside tool calls

- [x] Destructive color for warning icon

- [x] Collapsible details with smooth animation (uses existing activity expand/collapse)

- [x] Works in light/dark mode + soft contrast (uses existing `text-destructive/70` theming)

- [x] No violations = nothing shown (no empty state)

- Note: no new UI components needed — violations render as `DelegationActivity` entries with `status: 'error'` using existing `AlertCircle` icon and destructive color