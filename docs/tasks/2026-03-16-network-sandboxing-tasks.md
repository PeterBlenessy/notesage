# Network Sandboxing — Tasks

**PRD:** `docs/prds/2026-03-16-network-sandboxing.md` **Status:** ✅ Complete

**Total:** 14 tasks (3S, 7M, 4L)

**Suggested order:** Backend proxy core (#1–#4) → sandbox profile updates (#5–#6) → spawn integration (#7) → frontend data model (#8–#9) → UI (#10–#12) → lifecycle & cleanup (#13) → manual testing (#14)

**Risks:**

- Unix socket proxy URLs (`unix:///path`) may not be supported by all agent HTTP clients — #1 includes a TCP localhost fallback
- Seatbelt `(deny network*)` + `(allow network-unix ...)` interaction needs manual verification per agent — covered in #14
- hyper 1.x API is lower-level than 0.14; HTTP CONNECT tunneling requires manual upgrade handling

---

## Layer 1: Proxy Core (Rust)

### #1 — Implement HTTP proxy server with domain filtering ✅

- **Complexity:** L | **Category:** backend
- **Description:** Create `src-tauri/src/commands/network_proxy.rs`. Implement a lightweight HTTP proxy using `hyper` 1.x + `tokio` that:
  1. Listens on a Unix domain socket (`/tmp/notesage-proxy-<instanceId>.sock`)
  2. Handles HTTP CONNECT tunneling (for HTTPS) — parse `CONNECT host:port`, check domain against allowlist, tunnel bytes if allowed
  3. Handles plain HTTP forwarding — parse `Host` header, check domain, forward if allowed
  4. Returns `403 Proxy Denied` for disallowed domains
  5. Supports wildcard matching (`*.example.com` matches `foo.example.com` but not `example.com`)
  6. TCP localhost fallback: if `use_tcp_fallback` is set, bind to `127.0.0.1:0` instead of Unix socket (for agents that don't support `unix://` proxy URLs)
  7. Graceful shutdown via `tokio::sync::watch` channel
- **Acceptance criteria:** Proxy starts, accepts CONNECT requests, tunnels allowed domains, rejects unknown domains with 403
- **Files:** `src-tauri/src/commands/network_proxy.rs` (new), `src-tauri/Cargo.toml` (add `hyper`, `hyper-util`, `http-body-util`)

### #2 — Add domain approval request/response flow to proxy ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #1
- **Description:** When the proxy encounters an unknown domain (not in `allowed_domains` or `session_domains`):
  1. Generate a unique `request_id` (UUID or timestamp-based)
  2. Emit `network-domain-request` Tauri event with `{ instanceId, agentId, domain, port, requestId }`
  3. Hold the TCP connection open, waiting on a `oneshot::Receiver` keyed by `request_id`
  4. Implement `network_domain_respond` Tauri command that resolves the pending oneshot with the user's decision
  5. Apply decision: `AllowOnce` → tunnel this connection only; `AllowSession` → add to `session_domains` + tunnel; `AllowAlways` → emit `network-domain-always` event + tunnel; `Deny` → return 403
  6. 30-second timeout: if no response, deny (fail-closed)
- **Acceptance criteria:** Unknown domain pauses connection, emits event, responds to command callback, applies decision correctly
- **Files:** `src-tauri/src/commands/network_proxy.rs`

### #3 — Add NetworkProxyState managed state and lifecycle commands ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #1

- **Description:** Create `NetworkProxyState` to manage active proxy instances:

  ```rust
  pub struct NetworkProxyState {
      instances: Mutex<HashMap<String, ProxyInstance>>,
  }
  ```

  Add functions:

  - `start_proxy(instance_id, agent_id, allowed_domains, app_handle)` → spawns proxy tokio task, returns socket path (or localhost:port)
  - `stop_proxy(instance_id)` → sends shutdown signal, removes socket file, removes from map
  - `stop_all_sync()` → called from `RunEvent::Exit` hook for cleanup Register `NetworkProxyState` in `src-tauri/src/lib.rs` as managed state. Add `network_domain_respond` and `network_proxy_status` to `generate_handler![]`.

- **Acceptance criteria:** Proxy instances tracked, start/stop work, cleanup on app exit

- **Files:** `src-tauri/src/commands/network_proxy.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

### #4 — Define per-agent default domain allowlists ✅

- **Complexity:** S | **Category:** backend | **Depends on:** #1
- **Description:** Add a `default_allowed_domains(agent_id: &str) -> Vec<String>` function in `network_proxy.rs` that returns the built-in domain allowlist for each agent:
  - `claude-agent-acp` → `["api.anthropic.com", "sentry.io", "github.com", "*.githubusercontent.com"]`
  - `codex-acp` → `["api.openai.com", "github.com", "*.githubusercontent.com"]`
  - `copilot` / `copilot-language-server` → `["api.github.com", "copilot-proxy.githubusercontent.com", "*.githubcopilot.com", "github.com", "*.githubusercontent.com"]`
  - `gemini` → `["generativelanguage.googleapis.com", "oauth2.googleapis.com", "github.com", "*.githubusercontent.com"]`Also expose as a Tauri command `network_default_domains(agent_id)` for the frontend settings UI.
- **Files:** `src-tauri/src/commands/network_proxy.rs`

---

## Layer 2: Sandbox Profile Updates

### #5 — Parameterize Seatbelt profile for network mode ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #1

- **Description:** Update `generate_seatbelt_profile()` in `sandbox.rs` to accept an optional `NetworkSandboxConfig`:

  ```rust
  pub struct NetworkSandboxConfig {
      pub proxy_socket_path: String,
  }
  ```

  When `network_config` is `Some`:

  - Replace `(allow network*)` with `(deny network*)` + `(allow network-unix "<socket_path>")` + DNS resolution allowances
  - If TCP fallback: `(allow network-outbound (remote ip "localhost:<port>"))` instead of unix socket Update `sandboxed_command()` signature to pass through the network config. Keep backward-compatible: `None` means current behavior `(allow network*)`.

- **Acceptance criteria:** Profile with network config blocks all network except proxy socket; profile without it unchanged

- **Files:** `src-tauri/src/commands/sandbox.rs`

### #6 — Update Linux bubblewrap for network sandboxing ✅

- **Complexity:** S | **Category:** backend | **Depends on:** #5
- **Description:** Update the Linux `sandboxed_command()` to accept the same `NetworkSandboxConfig`. When present:
  - Add `--unshare-net` flag to create isolated network namespace
  - Bind-mount the proxy socket into the sandbox: `--ro-bind <socket_path> <socket_path>`
  - If TCP fallback: add `--share-net` but rely on iptables or skip network isolation (document limitation)
- **Files:** `src-tauri/src/commands/sandbox.rs`

---

## Layer 3: Spawn Integration

### #7 — Integrate proxy startup into agent spawn flow ✅

- **Complexity:** L | **Category:** backend | **Depends on:** #2, #3, #5
- **Description:** Update `acp_agent_spawn` in `acp.rs` to:
  1. Accept new parameter `network_sandbox_enabled: Option<bool>` and `network_allowed_domains: Option<Vec<String>>`
  2. If network sandbox enabled: call `NetworkProxyState::start_proxy()` before spawning the agent
  3. Pass the proxy socket path to `generate_seatbelt_profile()` via `NetworkSandboxConfig`
  4. Inject `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` env vars into the agent's environment
  5. On agent thread exit: call `NetworkProxyState::stop_proxy()` to clean up Update `run_agent_thread` signature to accept proxy cleanup info. Update `SpawnResult` to include `network_sandbox_enabled: bool` and `proxy_address: Option<String>`.
- **Acceptance criteria:** Agent spawns with proxy running, env vars set, Seatbelt denies direct network, proxy handles traffic. Unsandboxed agents unchanged.
- **Files:** `src-tauri/src/commands/acp.rs`, `src-tauri/src/commands/network_proxy.rs`

---

## Layer 4: Frontend Data Model

### #8 — Add domain permission fields to permission store and connections ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #4
- **Description:**
  1. In `connections.ts`: add `allowedDomains: string[]` to `AgentInstallMeta` for each provider option (populate from the same lists as #4). Add `networkSandboxEnabled?: boolean` and `domainAllowlist?: DomainAllowlist` to `Connection` interface.
  2. In `permission-store.ts`: add `domainSessionAllowed: Record<string, string[]>` (non-persisted) and `domainAlwaysAllowed: Record<string, string[]>` (persisted). Add actions: `allowDomain(connectionId, domain, tier)`, `removeDomain(connectionId, domain)`, `isDomainAllowed(connectionId, domain, builtIn[])`. Persist only `domainAlwaysAllowed` via `partialize`.
  3. In `connections-store.ts`: when `networkSandboxEnabled` changes on a connection, no special handling needed (just persisted).
- **Acceptance criteria:** Domain permissions stored and queryable; session permissions clear on restart; always permissions survive restart
- **Files:** `src/lib/ai/connections.ts`, `src/stores/permission-store.ts`, `src/stores/connections-store.ts`

### #9 — Pass network sandbox config from frontend to spawn command ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #7, #8
- **Description:** Update `ensureAcpAgent()` in `useAcpLifecycle.ts` and `ensureTaskAgent()` in `useAgentTaskOperations.ts`:
  1. Read connection's `networkSandboxEnabled` and `sandboxEnabled` from `connections-store`
  2. Build `networkAllowedDomains` by merging: built-in defaults (from `connections.ts` `installMeta.allowedDomains`) + `domainAlwaysAllowed[connectionId]` from permission store + `domainSessionAllowed[connectionId]`
  3. Pass `networkSandboxEnabled` and `networkAllowedDomains` to `acp_agent_spawn` invoke
  4. Listen for `network-domain-always` events — when received, call `permissionStore.allowDomain(connectionId, domain, 'always')` to persist
- **Acceptance criteria:** Spawn includes network config; always-allowed domains persisted on approval
- **Files:** `src/hooks/useAcpLifecycle.ts`, `src/hooks/useAgentTaskOperations.ts`

---

## Layer 5: UI Components

### #10 — Create DomainApprovalCard component ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #2, #8
- **Description:** Create `src/components/chat/DomainApprovalCard.tsx` following the `PermissionCard` pattern:
  1. Props: `{ instanceId, agentId, domain, port, requestId }`
  2. Display: Globe icon, agent name, domain:port, split Allow button with dropdown (Allow once / Allow for session / Allow always) + Deny button
  3. On Allow once: invoke `network_domain_respond` with `allow_once`, remove card
  4. On Allow session: invoke `network_domain_respond` with `allow_session`, add to `permissionStore.domainSessionAllowed`, auto-approve pending requests for same domain, remove card
  5. On Allow always: invoke `network_domain_respond` with `allow_always`, add to `permissionStore.domainAlwaysAllowed`, auto-approve pending, remove card
  6. On Deny: invoke `network_domain_respond` with `deny`, remove card
  7. After decision: card becomes read-only showing the outcome (e.g., "Allowed pypi.org for session") Match PermissionCard styling: rounded border, muted background, compact layout, works in light/dark mode.
- **Files:** `src/components/chat/DomainApprovalCard.tsx` (new)

### #11 — Integrate DomainApprovalCard into ChatPanel ✅

- **Complexity:** M | **Category:** frontend | **Depends on:** #10
- **Description:** In `ChatPanel.tsx` (or relevant chat message rendering):
  1. Listen for `network-domain-request` Tauri events
  2. Check if domain is already allowed (built-in, session, or always) — if so, auto-respond with `allow_once` without showing card
  3. Otherwise, add a `DomainApprovalCard` to the chat panel (similar to how `PermissionCard` is rendered for ACP tool calls)
  4. Ensure scroll-to-bottom works when cards are inserted
  5. Multiple pending domain requests should stack (not replace each other)
- **Files:** `src/components/chat/ChatPanel.tsx`

### #12 — Add network sandbox controls to ConnectionCard settings ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #4, #8
- **Description:** Update `ConnectionCard.tsx` (or the relevant connection settings component):
  1. Add "Network: Restricted" toggle below the existing "Sandbox: Enabled" toggle
  2. Network toggle only visible when filesystem sandbox (`sandboxEnabled`) is on
  3. When network toggle enabled, show expandable "Allowed domains" section:
     - List built-in domains with `[built-in]` badge (not removable)
     - List user-added domains (from `domainAlwaysAllowed`) with `[always]` badge and `✕` remove button
     - `[+ Add domain]` button → inline input to manually add a domain
  4. Removing a domain calls `permissionStore.removeDomain()`
  5. Adding a domain calls `permissionStore.allowDomain(connectionId, domain, 'always')`
  6. Toggling network sandbox off clears session domains for that connection Match design system: muted labels, consistent spacing, both themes.
- **Files:** `src/components/settings/ConnectionCard.tsx` (or `ConnectionsSettings.tsx`)

---

## Layer 6: Lifecycle & Cleanup

### #13 — Stale socket cleanup and crash recovery ✅

- **Complexity:** S | **Category:** backend | **Depends on:** #3
- **Description:** On app startup (in `lib.rs` or `NetworkProxyState::new()`):
  1. Scan `/tmp/notesage-proxy-*.sock` for stale socket files
  2. Delete any found (they're from a previous crashed session)
  3. Log a warning for each cleaned socket On `RunEvent::Exit`: call `NetworkProxyState::stop_all_sync()` to clean up all active proxies. Ensure this runs before `AcpState::stop_all_sync()` (proxy must outlive agents briefly for graceful connection close).
- **Files:** `src-tauri/src/lib.rs`, `src-tauri/src/commands/network_proxy.rs`

---

## Testing

### #14 — Manual integration testing with real agents ✅

- **Complexity:** M | **Category:** both | **Depends on:** all above
- **Description:** Verify end-to-end with each supported agent:
  1. **claude-agent-acp** (managed install): spawn with network sandbox → API calls to `api.anthropic.com` work → attempt to `curl evil.com` from agent fails
  2. **Proxy env var compatibility**: verify each agent binary respects `HTTP_PROXY`/`HTTPS_PROXY` — test with Unix socket URL first, fall back to TCP localhost if needed
  3. **Domain approval flow**: trigger an unknown domain → card appears → approve → connection succeeds
  4. **Session vs always**: session approvals clear on restart, always approvals survive
  5. **Unsandboxed regression**: system-installed agent without sandbox enabled → no proxy, no env vars, works as before
  6. **Cleanup**: kill app → restart → no stale sockets, no orphan proxies
  7. `cargo check` + `npx tsc --noEmit` pass
  8. **Light and dark mode** for all new UI components
- **Test checklist items map to PRD quality gates**
- **Files:** N/A (manual testing)