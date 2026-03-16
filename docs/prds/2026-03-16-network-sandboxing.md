# Network Sandboxing

**Date:** 2026-03-16 **Status:** 🚧 In Progress **Parent:** Agent Binary Management & Runtime Sandboxing (Phase 2)

## Problem

Phase 1 sandboxing restricts filesystem access but leaves network wide open — `(allow network*)` in every Seatbelt profile. A compromised or prompt-injected agent can exfiltrate data to any domain. ACP permissions are advisory (the agent *chooses* to ask); the OS sandbox must enforce the boundary regardless of agent behavior.

Specific risks today:

1. **Data exfiltration** — a prompt-injected agent could POST project contents to an attacker-controlled server
2. **Credential relay** — an agent with read access to API keys in project config files could forward them to a third party
3. **Supply chain** — agents can `curl | sh` arbitrary scripts from any URL
4. **No visibility** — users have zero insight into what network calls agents make

## Goals

- Per-agent domain allowlist enforced at the OS level (not advisory)
- Unknown domain requests surface to the user for explicit approval
- Three-tier permission model (allow once / session / always) consistent with existing ACP tool permissions
- Near-zero latency overhead for allowed domains
- Agents that only need `api.anthropic.com` should never reach `evil.com`

## Non-Goals

- Deep packet inspection or TLS interception (we route traffic, not inspect payloads)
- Bandwidth throttling or rate limiting
- Network sandboxing on Windows (deferred — no Seatbelt equivalent)
- Monitoring or logging network traffic for analytics
- Sandboxing direct API connections (Path 1) — only agent subprocesses (Path 2/3)

## User Stories

- As a user with a sandboxed agent, I want the agent's API calls to work transparently while blocking all other network access.
- As a user, I want to be prompted when an agent tries to reach an unknown domain, so I can approve or deny it.
- As a user, I want my domain approvals to persist across sessions ("allow always") so I don't get prompted repeatedly.
- As a user, I want to see which domains each agent is allowed to reach in connection settings.
- As a user with a system-installed agent, I want the option to enable network sandboxing for it.

## Technical Approach

### Architecture Overview

```
Agent process (sandboxed)
  → Seatbelt: (deny network*) + (allow network-unix <socket>)
  → HTTP_PROXY / HTTPS_PROXY env vars point to Unix socket
  → Agent's HTTP client uses proxy automatically

Notesage proxy (runs outside sandbox, inside Tauri process)
  → Listens on Unix domain socket at /tmp/notesage-proxy-<instance>.sock
  → Receives CONNECT requests (HTTPS) and plain HTTP requests
  → Checks destination domain against per-agent allowlist
  → Allowed → tunnel/forward traffic
  → Unknown → emit Tauri event, await user decision, then allow or reject
  → Denied → return 403 Proxy Denied
```

### Why a Proxy (Not Just Seatbelt Rules)

Seatbelt can filter by IP but not by domain name. DNS resolution happens inside the sandbox, returning IPs that Seatbelt can't meaningfully allowlist (CDNs, rotating IPs). A proxy outside the sandbox resolves domains and enforces policy at the application layer.

### Proxy Implementation

A lightweight HTTP proxy in Rust using `tokio` + `hyper`. Two modes:

1. **HTTP CONNECT tunneling** (for HTTPS): proxy receives `CONNECT api.anthropic.com:443`, checks domain, then blindly tunnels bytes between agent and destination. No TLS termination.
2. **Plain HTTP forwarding**: proxy receives full request, checks `Host` header, forwards if allowed.

The proxy binds to a Unix domain socket (not TCP) to avoid port conflicts and limit the attack surface — only processes that can reach the socket file can use the proxy.

**Per-instance isolation**: each sandboxed agent spawn gets its own proxy instance and socket file. Socket cleaned up when agent exits.

### Seatbelt Profile Changes

Current:

```scheme
(allow network*)
```

With network sandboxing enabled:

```scheme
;; Deny all direct network access
(deny network*)

;; Allow connecting to the proxy Unix socket
(allow network-unix "/tmp/notesage-proxy-<instance>.sock")

;; Allow DNS resolution (needed for agents that resolve before proxying)
(allow network-outbound (remote ip "localhost:53"))
(allow network-outbound (remote unix-socket "/var/run/mDNSResponder"))
```

### Linux (Bubblewrap)

```bash
bwrap \
  --unshare-net \                    # No direct network
  --ro-bind /tmp/notesage-proxy-<instance>.sock \
            /tmp/notesage-proxy-<instance>.sock \  # Expose proxy socket
  ...existing args...
```

The `--unshare-net` flag creates a new network namespace with no external connectivity. The Unix socket is bind-mounted into the sandbox.

### Environment Variables

Injected into the agent process at spawn time:

```
HTTP_PROXY=unix:///tmp/notesage-proxy-<instance>.sock
HTTPS_PROXY=unix:///tmp/notesage-proxy-<instance>.sock
NO_PROXY=localhost,127.0.0.1
```

Most HTTP clients (reqwest, node's undici/got, Python's requests, curl) respect these env vars automatically. Agents that use raw sockets will be blocked by Seatbelt.

**Note:** Some HTTP clients don't support `unix://` proxy URLs. Fallback: bind proxy to `127.0.0.1:<random-port>` and use `http://127.0.0.1:<port>` as proxy URL. Seatbelt allows localhost traffic with `(allow network-outbound (remote ip "localhost:*"))`.

### Per-Agent Default Allowlists

| Agent | Required domains |
| --- | --- |
| `claude-agent-acp` | `api.anthropic.com`, `sentry.io` |
| `codex-acp` | `api.openai.com` |
| `copilot` | `api.github.com`, `copilot-proxy.githubusercontent.com`, `*.githubcopilot.com` |
| `copilot-language-server` | `api.github.com`, `copilot-proxy.githubusercontent.com`, `*.githubcopilot.com` |
| `gemini` | `generativelanguage.googleapis.com`, `oauth2.googleapis.com` |
| Common (all agents) | `github.com` (git operations), `*.githubusercontent.com` |

Wildcard matching: `*.example.com` matches `foo.example.com` but not `example.com` itself.

### Domain Approval Flow

When the proxy encounters an unknown domain:

1. Proxy pauses the connection (holds the TCP stream open, does not forward)
2. Emits `network-domain-request` Tauri event with `{ instanceId, agentId, domain, port }`
3. Frontend shows a `DomainApprovalCard` in the chat panel (same pattern as `PermissionCard`)
4. User chooses: **Allow once** / **Allow for session** / **Allow always** / **Deny**
5. Proxy receives decision via a Tauri command callback (`network_domain_respond`)
6. Proxy forwards or rejects the connection accordingly

Timeout: if the user doesn't respond within 30 seconds, the connection is denied (fail-closed).

### Spawn Integration

In `acp.rs`, the spawn flow becomes:

```
1. Resolve binary (managed or system)
2. Determine sandbox policy (filesystem + network)
3. If network sandbox enabled:
   a. Start proxy instance (tokio task) with agent's domain allowlist
   b. Generate Seatbelt profile with (deny network*) + Unix socket allow
   c. Set HTTP_PROXY/HTTPS_PROXY env vars on agent command
4. Spawn agent (with or without sandbox wrapper)
5. On agent exit: shut down proxy, delete socket file
```

### Proxy Lifecycle

- **Start**: created as a `tokio::task` when the agent spawns with network sandboxing enabled
- **Runtime**: handles connections until agent exits or is stopped
- **Shutdown**: triggered by agent exit signal; gracefully closes open connections, deletes socket file
- **Crash recovery**: socket files in `/tmp/notesage-proxy-*` cleaned up on app startup (stale socket detection)

## UI/UX

### Domain Approval Card (Chat Panel)

Appears inline in the chat message list when an agent requests an unknown domain:

```
┌─────────────────────────────────────────────────────┐
│ 🌐 Network request                                  │
│                                                      │
│ claude-agent-acp wants to connect to:               │
│ pypi.org:443                                        │
│                                                      │
│              [Deny]  [Allow ▾]                      │
│                       ├─ Allow once                  │
│                       ├─ Allow for session           │
│                       └─ Allow always                │
└─────────────────────────────────────────────────────┘
```

Same split-button pattern as `PermissionCard` — primary "Allow" button with dropdown for tier selection. Default action: **Allow once**.

After decision, the card becomes read-only showing what was chosen (e.g., "Allowed pypi.org for session").

### Connection Settings — Network Section

Below the existing sandbox toggle on each connection card:

```
┌──────────────────────────────────────────────────────┐
│ Claude Code (ACP)                     [Connected ●]  │
│                                                       │
│ Source: Managed by Notesage                           │
│ Sandbox: [■ Enabled]                                 │
│ Network: [■ Restricted]                              │
│                                                       │
│ Allowed domains:                                      │
│   api.anthropic.com          [built-in]              │
│   sentry.io                  [built-in]              │
│   github.com                 [built-in]              │
│   pypi.org                   [always]    [✕]         │
│                                                       │
│   [+ Add domain]                                     │
└──────────────────────────────────────────────────────┘
```

- Built-in domains shown but not removable
- User-added domains (from "allow always" or manual add) are removable
- "Network: Restricted" toggle independent from filesystem sandbox toggle
- Network toggle only visible when filesystem sandbox is enabled (network sandbox requires filesystem sandbox as prerequisite)

### Agent Activity Panel

Network domain approvals appear as activity entries alongside tool call approvals, giving a complete audit trail per task.

## Data Model

### Frontend Types

```typescript
// New: per-agent domain allowlist configuration
interface DomainAllowlist {
  /** Built-in domains required for the agent to function (not removable) */
  builtIn: string[];
  /** User-approved domains persisted across sessions */
  userAllowed: string[];
}

// Extend Connection interface
interface Connection {
  // ...existing fields...
  networkSandboxEnabled?: boolean;  // Independent from sandboxEnabled (filesystem)
  domainAllowlist?: DomainAllowlist;
}

// Domain approval request event payload
interface DomainRequest {
  instanceId: string;
  agentId: string;
  domain: string;
  port: number;
  requestId: string;  // Unique ID for correlating response
}

// Domain approval response
interface DomainResponse {
  requestId: string;
  decision: 'allow_once' | 'allow_session' | 'allow_always' | 'deny';
}
```

### Permission Store Extension

```typescript
// Add to permission-store.ts
interface PermissionStore {
  // ...existing fields...

  // Network domain permissions (per connection)
  domainSessionAllowed: Record<string, string[]>;   // connectionId → domains (non-persisted)
  domainAlwaysAllowed: Record<string, string[]>;     // connectionId → domains (persisted)

  allowDomain(connectionId: string, domain: string, tier: 'session' | 'always'): void;
  removeDomain(connectionId: string, domain: string): void;
  isDomainAllowed(connectionId: string, domain: string, builtIn: string[]): boolean;
}
```

### Rust Types

```rust
/// Network proxy state for a single agent instance
pub struct ProxyInstance {
    pub socket_path: PathBuf,
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,
    pub allowed_domains: Vec<String>,
    pub session_domains: Mutex<Vec<String>>,
}

/// Network sandbox configuration
pub struct NetworkSandboxConfig {
    pub enabled: bool,
    pub allowed_domains: Vec<String>,      // Built-in + user "always" domains
    pub session_domains: Vec<String>,       // Session-approved domains
}

/// Domain approval request sent to frontend
#[derive(Serialize, Clone)]
pub struct DomainRequest {
    pub instance_id: String,
    pub agent_id: String,
    pub domain: String,
    pub port: u16,
    pub request_id: String,
}

/// Domain approval response from frontend
#[derive(Deserialize)]
pub struct DomainResponse {
    pub request_id: String,
    pub decision: DomainDecision,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DomainDecision {
    AllowOnce,
    AllowSession,
    AllowAlways,
    Deny,
}
```

### Tauri Commands (New)

```rust
/// Respond to a domain approval request from the proxy
#[tauri::command]
async fn network_domain_respond(
    state: State<'_, NetworkProxyState>,
    request_id: String,
    decision: DomainDecision,
) -> Result<(), String>

/// Get active proxy instances and their stats
#[tauri::command]
async fn network_proxy_status() -> Result<Vec<ProxyStatus>, String>
```

### Tauri Events (New)

```typescript
// network-domain-request — proxy needs user approval
{ instanceId: string; agentId: string; domain: string; port: number; requestId: string }

// network-domain-resolved — approval decision applied
{ requestId: string; domain: string; decision: string }
```

### Filesystem Layout

```
/tmp/
  notesage-proxy-<instanceId>.sock    # Per-agent Unix domain socket (ephemeral)

~/.notesage/
  sandbox/
    profiles/
      agent-<hash>.sb                 # Updated Seatbelt profiles with network deny
```

## Dependencies

### New Rust Crates

| Crate | Purpose | Size impact |
| --- | --- | --- |
| `hyper` (1.x) | HTTP proxy server implementation | Already a transitive dep of reqwest |
| `hyper-util` | `TokioIo` adapter, service utilities | Small |
| `http-body-util` | Body combinators for hyper 1.x | Small |
| `tokio-stream` | Stream utilities for connection handling | Small |

All are well-maintained, widely-used crates. `hyper` is already a transitive dependency via `reqwest`. No new frontend dependencies.

### Prerequisite Work

- Filesystem sandbox must be enabled for network sandbox to apply (network toggle gated on filesystem toggle)
- Existing `sandbox.rs` Seatbelt profile generation must be parameterized for network mode

## Quality Gates

### Functional

- [ ] Sandboxed agent's API calls work transparently through proxy (no agent code changes needed)

- [ ] Sandboxed agent cannot reach domains outside its allowlist (verified with `curl` from within sandbox)

- [ ] Unknown domain triggers approval card in chat panel

- [ ] "Allow once" permits single connection, blocks subsequent attempts to same domain

- [ ] "Allow session" persists within app session, clears on restart

- [ ] "Allow always" persists across restarts

- [ ] "Deny" returns 403 to the agent and the agent handles it gracefully

- [ ] 30-second timeout on unanswered prompts results in denial

- [ ] Proxy shuts down cleanly when agent exits (no orphan sockets)

- [ ] Stale socket files cleaned up on app startup

- [ ] Unsandboxed agents (system install, sandbox off) unaffected — no regression

- [ ] `cargo check` + `npx tsc --noEmit` pass

### Design

- [ ] DomainApprovalCard matches PermissionCard styling (split button, muted background)

- [ ] Connection settings domain list is clean and scannable

- [ ] Built-in vs user-added domains visually distinct

- [ ] Network toggle disabled/hidden when filesystem sandbox is off

- [ ] Works in both light and dark mode

### Performance

- [ ] Proxy adds &lt; 5ms latency to allowed-domain requests

- [ ] Proxy startup &lt; 100ms (must not delay agent spawn noticeably)

- [ ] No measurable CPU overhead when agent is idle

## Open Questions

- [ ] Do all agent HTTP clients respect `HTTP_PROXY`/`HTTPS_PROXY` env vars? Need to verify: `claude-agent-acp` (Node.js — yes via undici), `codex-acp` (Rust — reqwest respects by default), `copilot` (Node.js — yes), `gemini` (Node.js — yes). If any agent ignores proxy vars, Seatbelt's `(deny network*)` still blocks direct connections — the agent will fail rather than bypass.

- [ ] Unix socket proxy URLs (`unix:///path`) — not all HTTP clients support this format. May need TCP localhost fallback. Test with each agent binary.

- [ ] Should we support SOCKS5 in addition to HTTP CONNECT? Some tools prefer SOCKS5. Initial implementation: HTTP-only, add SOCKS5 if needed.

- [ ] Wildcard domain matching: should `*.github.com` also match `github.com` itself? Propose: no, require explicit entries for both.

## Out of Scope

- TLS interception or certificate pinning
- Traffic logging, bandwidth monitoring, or analytics
- Windows network sandboxing (no Seatbelt equivalent — needs separate research)
- Network sandbox for direct API connections (Path 1) — those are Notesage's own HTTP calls, not agent subprocesses
- SOCKS5 proxy support (HTTP CONNECT covers HTTPS; add SOCKS5 only if an agent requires it)
- Per-request URL filtering (we filter by domain, not by path)
- IPv6-specific handling (proxy resolves domains; IPv6 transport is transparent)