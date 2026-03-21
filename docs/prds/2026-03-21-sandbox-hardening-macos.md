# Sandbox Hardening (macOS)

**Date:** 2026-03-21 **Status:** Draft **Parent:** Agent Binary Management & Runtime Sandboxing

## Problem

Notesage's agent sandbox has a critical enforcement gap on macOS: the Seatbelt profile uses `(allow network*)`, meaning the HTTP proxy environment variables are the **only** network enforcement mechanism. A malicious or compromised agent binary that ignores `HTTP_PROXY`/`HTTPS_PROXY` can connect directly to any domain, bypassing all domain filtering.

This was a known compromise during the network sandboxing implementation (2026-03-16). The original PRD specified `(deny network*)` with selective localhost allows, but the implementation reverted to `(allow network*)` because Seatbelt deny rules broke agent startup in practice. Anthropic's open-source `sandbox-runtime` (v0.0.42) successfully uses the deny-first pattern — the issue was likely in rule syntax or ordering, not a fundamental Seatbelt limitation.

Additionally, there is no visibility into sandbox violations. When Seatbelt blocks an operation, the denial is logged to the macOS unified log but Notesage has no awareness of it. Users have no way to know when agents are attempting operations the sandbox blocks.

**Research basis:** `docs/research/sandbox-runtime-comparison.md` (Gaps 1 and 4).

## Goals

- **Kernel-enforced network deny**: Seatbelt `(deny network*)` with selective `(allow network-outbound)` for the proxy port — agents physically cannot bypass the proxy
- **Violation visibility**: Real-time streaming of Seatbelt violation logs surfaced in the Activity panel
- **No agent regression**: All four ACP agents (Claude Code, Codex, Copilot, Gemini CLI) must start and function correctly under the hardened profile
- **Incremental rollout**: Users can fall back to the current `(allow network*)` behavior if the hardened profile causes issues

## Non-Goals

- Linux sandbox hardening (`--unshare-net`, seccomp-BPF) — out of scope, we don't build for Linux
- Windows sandbox support
- SOCKS5 proxy (HTTP CONNECT covers all tested agents)
- Dynamic sandbox reconfiguration mid-session (`--control-fd` pattern)
- Deep packet inspection, TLS interception, or traffic analytics
- Changing the proxy architecture (TCP localhost proxy remains; no switch to Unix sockets)

## User Stories

- As a user with a sandboxed agent, I want the OS to block direct network access so that even a compromised agent binary cannot bypass domain filtering.
- As a user, I want to see when my sandboxed agents attempt operations that the sandbox blocks, so I have security visibility independent of agent cooperation.
- As a user, I want to fall back to the current proxy-only enforcement if the hardened sandbox breaks my workflow, so I'm not locked out.
- As a user, I want violation events to appear in the same Activity panel where I see tool calls and domain approvals, so I have a single audit trail.

## Technical Approach

### Part 1: Kernel-Level Network Deny

#### Seatbelt Profile Changes

Replace the current permissive network block:

```scheme
;; CURRENT: Allow network (proxy env vars provide domain filtering)
(allow network*)
```

With a deny-first profile that only allows connections to the localhost proxy:

```scheme
;; Deny all network by default
(deny network*)

;; Allow connecting to the localhost proxy (TCP)
(allow network-outbound
  (remote tcp "localhost:<proxy_port>"))

;; Allow DNS resolution (agents resolve before connecting)
(allow network-outbound
  (remote udp "localhost:53")
  (remote udp "*:53"))
(allow network-outbound
  (remote unix-socket "/var/run/mDNSResponder"))

;; Allow localhost loopback for agent-internal IPC
(allow network-outbound
  (remote tcp "localhost:*"))
;; NOTE: This is broader than ideal — it allows connections to any localhost port.
;; Required because agents spawn subprocesses that communicate over localhost
;; (e.g., Node.js debug ports, LSP servers). If this proves too permissive,
;; narrow to only the proxy port + known agent ports.

;; Allow inbound connections on loopback (agent subprocess communication)
(allow network-inbound
  (local tcp "localhost:*"))

;; Allow Unix domain sockets — restricted to known system paths
;; This is the macOS equivalent of Linux's seccomp-BPF AF_UNIX blocking.
;; Seatbelt can filter network-unix by path, so we allow only what's needed
;; (mDNSResponder, system IPC) rather than blanket (allow network-unix).
(allow network-unix
  (literal "/var/run/mDNSResponder")
  (subpath "/var/run")
  (subpath "/private/var/run"))
;; NOTE: If agents need additional Unix sockets (e.g., Docker socket at
;; /var/run/docker.sock), add them explicitly. The goal is to prevent
;; agents from creating arbitrary Unix sockets for IPC escape.
;; Test each agent — if startup fails, widen to (allow network-unix)
;; and log which socket path was needed to tighten the rule.
```

#### Investigation Strategy

The previous attempt failed because "Seatbelt's rule precedence appears to favor deny over more specific allows in some configurations." Before implementing, investigate:

1. **Study** `srt`**'s exact profile**: Anthropic's `sandbox-runtime` generates Seatbelt profiles that work. Extract their exact rule syntax, ordering, and any macOS version requirements.

2. **Test with minimal profile**: Create a test script that runs a simple `curl` command under progressively restrictive Seatbelt profiles to isolate which rule combination breaks:

   - `(deny network*) + (allow network-outbound (remote tcp "localhost:*"))` — does basic localhost work?
   - Add DNS rules — does resolution work?
   - Add the full agent binary — does agent startup work?

3. **macOS version sensitivity**: Test on macOS 14 (Sonoma) and macOS 15 (Sequoia). Seatbelt behavior can differ between versions.

4. **Rule ordering**: Seatbelt evaluates rules top-to-bottom with last-match-wins semantics (unlike iptables first-match). Ensure deny rules come before allow rules, or use `(deny network* (with no-report))` to suppress logging noise for expected denials.

#### Fallback Toggle

Add a `kernelNetworkDeny` boolean to the connection config (default: `true` for new installs, `false` for existing installs via migration). When `false`, the profile uses `(allow network*)` as today. This lets users opt out if the hardened profile causes issues.

In `sandbox.rs`:

```rust
pub fn generate_seatbelt_profile(
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,  // NEW parameter
) -> Result<PathBuf, String> {
    let network_block = if let Some(nc) = network_config {
        if kernel_network_deny {
            // Deny-first: only allow localhost proxy port
            format!(r#"
(deny network*)
(allow network-outbound (remote tcp "localhost:{port}"))
(allow network-outbound (remote udp "*:53"))
(allow network-outbound (remote unix-socket "/var/run/mDNSResponder"))
(allow network-inbound (local tcp "localhost:*"))
(allow network-unix)
"#, port = nc.proxy_port)
        } else {
            // Legacy: allow all, proxy env vars are the only enforcement
            "(allow network*)".to_string()
        }
    } else {
        "(allow network*)".to_string()
    };
    // ...rest unchanged
}
```

#### Spawn Integration

In `acp.rs`, pass the new flag through the existing spawn chain:

```
acp_start_agent → network_config + kernel_network_deny
  → run_agent_thread → sandboxed_command(writable_paths, network_config, kernel_network_deny)
    → generate_seatbelt_profile(writable_paths, network_config, kernel_network_deny)
```

The `kernel_network_deny` value comes from the connection's config in `connections-store`.

### Part 2: Seatbelt Violation Monitoring

#### Architecture

```
macOS unified log (kernel sandbox violations)
  → log stream --predicate 'eventMessage CONTAINS "Sandbox"' --style ndjson
    → Rust child process (spawned once, long-lived)
      → Parse JSON log entries
      → Filter for our agent PIDs
      → Emit Tauri events: sandbox-violation
        → Frontend: ViolationEntry in activity-store
          → Activity panel: violation cards
```

#### Rust Implementation

New module: `src-tauri/src/commands/sandbox_monitor.rs`

```rust
/// Managed state for the violation monitor
pub struct SandboxMonitorState {
    /// PID → (instance_id, agent_id) mapping for active agents
    agent_pids: Mutex<HashMap<u32, (String, String)>>,
    /// Handle to the log stream child process
    log_stream: Mutex<Option<Child>>,
    /// Shutdown signal
    shutdown: watch::Sender<bool>,
}
```

**Monitor lifecycle:**

1. **Start**: Spawned once on first agent start with sandbox enabled. Runs `log stream --predicate 'eventMessage CONTAINS "Sandbox: deny"' --style ndjson` as a child process.
2. **PID registration**: When an agent spawns, its PID is registered in `agent_pids`. When it exits, the PID is removed.
3. **Parsing**: Each ndjson line is parsed. If `processIdentifier` matches a registered PID, extract the violation details (operation, resource path, domain) and emit a Tauri event.
4. **Shutdown**: Killed on `RunEvent::Exit` alongside other cleanup.

**Tauri event:**

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SandboxViolation {
    pub instance_id: String,
    pub agent_id: String,
    pub pid: u32,
    pub operation: String,    // e.g., "network-outbound", "file-write-data"
    pub resource: String,     // e.g., "evil.com:443", "/Users/x/.ssh/id_rsa"
    pub timestamp: String,    // ISO 8601
}
```

**Tauri commands:**

```rust
/// Register an agent PID for violation monitoring
#[tauri::command]
async fn sandbox_monitor_register_pid(
    state: State<'_, SandboxMonitorState>,
    instance_id: String,
    agent_id: String,
    pid: u32,
) -> Result<(), String>

/// Unregister an agent PID
#[tauri::command]
async fn sandbox_monitor_unregister_pid(
    state: State<'_, SandboxMonitorState>,
    pid: u32,
) -> Result<(), String>
```

#### Filtering & Deduplication

- Only emit violations for registered PIDs (ignore system processes)
- Deduplicate: same (PID, operation, resource) within 5 seconds → single event with count
- Rate limit: max 10 violation events per second per agent (batch the rest)
- `(with no-report)` on expected denials in the Seatbelt profile to reduce noise (e.g., deny-by-default network rules that agents never hit)

#### Frontend Integration

**activity-store.ts extension:**

```typescript
interface SandboxViolationEntry {
  id: string;
  instanceId: string;
  agentId: string;
  operation: string;
  resource: string;
  timestamp: string;
  count: number;  // dedup count
}

interface ActivityStore {
  // ...existing fields...
  violations: SandboxViolationEntry[];
  addViolation(violation: SandboxViolationEntry): void;
  clearViolations(instanceId: string): void;
}
```

**Activity panel rendering:**

Violations appear as entries in the per-task activity log, visually distinct from tool calls:

```
┌─────────────────────────────────────────────────────┐
│ ⚠ Sandbox violation                                 │
│ network-outbound → evil.com:443                     │
│ Blocked by kernel sandbox                           │
│ 14:23:05                                            │
└─────────────────────────────────────────────────────┘
```

- Warning icon (triangle) in muted orange/amber — the only chromatic exception alongside destructive red, justified by security severity
- Actually, per design system rules: use the existing `--color-destructive` red for violations, consistent with error/denial styling. No new chromatic color.
- Grouped with other activity for the same task
- Clickable to show full details (PID, raw log entry) in a collapsible section

## UI/UX

### Connection Config Dialog Changes

Add a "Kernel enforcement" toggle below the existing "Network: Restricted" toggle:

```
│ Network: [■ Restricted]                              │
│ Kernel enforcement: [■ Enabled]                      │
│   ⓘ Blocks direct network at the OS level.          │
│     Disable if agents fail to start.                 │
```

- Only visible when Network Restricted is enabled
- Default: enabled for new connections, disabled for existing (migration)
- Tooltip explains the difference: "When enabled, the OS kernel blocks all direct network access. When disabled, only proxy environment variables enforce domain filtering."

### Activity Panel — Violation Section

- Violations appear inline in the task activity log (same list as tool calls, domain approvals)
- Each violation shows: operation type, target resource, timestamp
- Destructive color (`--color-destructive`) for the warning icon
- Collapsible detail section with raw log entry for debugging
- If no violations for a task, nothing shown (no empty state needed)

### Settings &gt; Connections

No changes to the domain list UI. The kernel enforcement toggle is the only new UI element.

## Data Model

### Frontend Types

```typescript
// Extend Connection interface in connections-store.ts
interface Connection {
  // ...existing fields...
  kernelNetworkDeny?: boolean;  // Default: true for new, false for existing
}

// Sandbox violation event payload
interface SandboxViolation {
  instanceId: string;
  agentId: string;
  pid: number;
  operation: string;
  resource: string;
  timestamp: string;
}
```

### Rust Types

```rust
// sandbox_monitor.rs
pub struct SandboxMonitorState {
    agent_pids: Mutex<HashMap<u32, (String, String)>>,
    log_stream: Mutex<Option<tokio::process::Child>>,
    shutdown_tx: watch::Sender<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SandboxViolation {
    pub instance_id: String,
    pub agent_id: String,
    pub pid: u32,
    pub operation: String,
    pub resource: String,
    pub timestamp: String,
}
```

### Tauri Commands (New)

```rust
#[tauri::command]
async fn sandbox_monitor_register_pid(
    state: State<'_, SandboxMonitorState>,
    instance_id: String,
    agent_id: String,
    pid: u32,
) -> Result<(), String>

#[tauri::command]
async fn sandbox_monitor_unregister_pid(
    state: State<'_, SandboxMonitorState>,
    pid: u32,
) -> Result<(), String>
```

### Tauri Events (New)

```typescript
// sandbox-violation — kernel blocked an agent operation
{ instanceId: string; agentId: string; pid: number; operation: string; resource: string; timestamp: string }
```

### Changes to Existing Types

```rust
// sandbox.rs — updated signature
pub fn generate_seatbelt_profile(
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,  // NEW
) -> Result<PathBuf, String>

pub fn sandboxed_command(
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,  // NEW
) -> Result<(String, Vec<String>), String>
```

## Dependencies

### New Rust Crates

None. `log stream` is a macOS system command. JSON parsing uses `serde_json` (already a dependency). `tokio::process::Command` for spawning the log stream process (already available).

### System Requirements

- macOS 12+ for `log stream --style ndjson` (available since macOS 10.12, ndjson since 12)
- `sandbox-exec` (ships with macOS, available in all supported versions)
- No new frontend dependencies

### Prerequisite Work

- None — builds on existing `sandbox.rs` and `network_proxy.rs`

## Implementation Order

1. **Seatbelt investigation** — test deny-first profiles outside Notesage to find the working rule set. This is the highest-risk item and should be validated before writing production code.
2. **Profile generation** — update `generate_seatbelt_profile` with the new `kernel_network_deny` parameter and tested rules.
3. **Spawn integration** — thread `kernel_network_deny` through `acp.rs` spawn chain.
4. **Connection config UI** — add kernel enforcement toggle.
5. **Migration** — existing connections default to `kernelNetworkDeny: false`; new connections default to `true`.
6. **Violation monitor** — `sandbox_monitor.rs` with log stream parsing and PID filtering.
7. **Activity panel integration** — violation entries in the activity log.
8. **End-to-end testing** — all four agents under hardened profile.

## Quality Gates

### Functional

- [ ] All four ACP agents (Claude Code, Codex, Copilot, Gemini CLI) start and function correctly under `(deny network*)` profile

- [ ] Agent API calls route through proxy transparently (no behavior change from user perspective)

- [ ] `curl https://evil.com` from within a sandboxed agent process returns a kernel denial (not a proxy error)

- [ ] Proxy-allowed domains still work: agent can reach `api.anthropic.com` (etc.) through the proxy

- [ ] Kernel enforcement toggle in connection config works: off = current `(allow network*)` behavior, on = deny-first

- [ ] New connections default to kernel enforcement enabled

- [ ] Existing connections migrated with kernel enforcement disabled (no surprise breakage)

- [ ] Seatbelt violations from agent PIDs appear in the Activity panel

- [ ] Violations from non-agent PIDs are filtered out (no noise)

- [ ] Violation deduplication works (same operation+resource within 5s → single entry)

- [ ] Log stream process cleaned up on app exit

- [ ] Agent PID registration/unregistration works across agent start/stop cycles

- [ ] `cargo check` + `npx tsc --noEmit` pass

### Design

- [ ] Kernel enforcement toggle matches existing toggle styling (shadcn Switch)

- [ ] Violation entries in Activity panel use destructive color, visually distinct from tool calls

- [ ] Collapsible detail section has smooth animation

- [ ] Works in both light and dark mode (and soft contrast)

- [ ] No new chromatic colors introduced

### Performance

- [ ] Log stream parsing adds &lt; 1% CPU overhead during idle agent operation

- [ ] Violation rate limiting prevents event flooding

- [ ] Profile generation time unchanged (&lt; 10ms)

## Open Questions

- [ ] Does `(allow network-outbound (remote tcp "localhost:*"))` suffice, or do we need to restrict to the exact proxy port? Broader is safer for agent subprocess IPC but weaker isolation. Test with each agent to see if they need arbitrary localhost ports.

- [ ] Should violations trigger a toast notification in addition to the Activity panel entry? Probably too noisy — start with Activity panel only, add toast opt-in later if users want it.

- [ ] Which Unix socket paths do agents actually need? Start with restricted `network-unix` rules (only `/var/run/*`) and widen if agents fail. This is the macOS equivalent of seccomp-BPF `AF_UNIX` blocking on Linux — Seatbelt handles it natively via path-filtered `network-unix` rules.

- [ ] `log stream` requires no special permissions on macOS, but does it work from a sandboxed Tauri app? The Tauri process itself is not sandboxed (no App Sandbox entitlement), so this should work. Verify.

## Out of Scope

- Linux sandbox hardening (`--unshare-net`, socat bridge, seccomp-BPF)
- Windows sandbox support
- SOCKS5 proxy support
- Dynamic sandbox reconfiguration (`--control-fd`)
- Unix domain socket proxy transport (staying with TCP localhost)
- Per-request URL path filtering
- Violation alerting beyond the Activity panel (email, webhook, etc.)
- Sandbox profile editor UI (users cannot customize Seatbelt rules directly)