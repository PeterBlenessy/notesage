# Agent Binary Management & Runtime Sandboxing — Tasks

**PRD:** `docs/prds/2026-02-21-agent-install-wizard.md`**Status:** ✅ Complete

## Phase 1 — Managed Installation + Filesystem Sandbox

**Total:** 12 tasks (3S, 6M, 3L)

### #1 — Create `~/.notesage/agents/` filesystem layout ✅

- **Complexity:** S | **Category:** backend
- **Description:** Create utility functions to ensure the managed agents directory structure exists (`~/.notesage/agents/bin/`, `~/.notesage/agents/lib/`, `~/.notesage/runtime/`, `~/.notesage/sandbox/profiles/`). Cross-platform home directory resolution. Initialize `versions.json` if missing.
- **Files:** `src-tauri/src/commands/agent_manager.rs` (new)

### #2 — Platform detection utility ✅

- **Complexity:** S | **Category:** backend
- **Description:** Add `detect_platform()` function that returns the current OS + architecture string used for GitHub Release asset matching (e.g., `darwin-arm64`, `darwin-x64`, `linux-x64`). Used by both binary download and sandbox profile generation.
- **Files:** `src-tauri/src/commands/agent_manager.rs`

### #3 — Binary resolution with source tracking ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #1
- **Description:** New `agent_resolve_binary` Tauri command. Checks `~/.notesage/agents/bin/` first (→ `managed`), then system PATH and common paths (→ `system`). Returns `BinaryResolution { path, source, version }`. Update existing `acp_agent_check_availability` to use this resolver. Register in `lib.rs`.
- **Files:** `src-tauri/src/commands/agent_manager.rs`, `src-tauri/src/commands/acp.rs`, `src-tauri/src/lib.rs`

### #4 — GitHub Release download engine ✅

- **Complexity:** L | **Category:** backend | **Depends on:** #2
- **Description:** Add `download_github_release()` function. Queries GitHub Releases API for latest version of a given `owner/repo`. Selects platform-specific asset by naming pattern. Downloads with progress events (`agent-install-progress`). Verifies SHA-256 checksum if available. Extracts binary to `~/.notesage/agents/bin/`. Sets executable permissions. Updates `versions.json`. Handles errors (network, checksum mismatch, disk space). Add concurrency guard (one install at a time).
- **Files:** `src-tauri/src/commands/agent_manager.rs`

### #5 — Portable Node.js download (for Gemini CLI) ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #2
- **Description:** Add `agent_install_node_runtime` Tauri command. Downloads official Node.js standalone binary for the current platform from nodejs.org. Extracts to `~/.notesage/runtime/node/`. Verifies the downloaded `node` and `npm` binaries work. Skips if already present and working. Emits progress events.
- **Files:** `src-tauri/src/commands/agent_manager.rs`

### #6 — `agent_install` Tauri command ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #3, #4, #5
- **Description:** New Tauri command that orchestrates installation for any agent. For native-binary agents (claude-agent-acp, codex-acp, copilot, copilot-language-server): delegates to GitHub Release download. For Gemini CLI: ensures portable Node.js is available, then runs `npm install --prefix`. Emits `agent-install-progress` and `agent-install-done` events. Validates agent_id against allowlist. Register in `lib.rs`.
- **Files:** `src-tauri/src/commands/agent_manager.rs`, `src-tauri/src/lib.rs`

### #7 — Seatbelt sandbox profile generation (macOS) ✅

- **Complexity:** M | **Category:** backend
- **Description:** Add `generate_seatbelt_profile()` function that produces a `.sb` file for a given working directory and sandbox config. Hardcoded deny rules for `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env` files. Read-only `.git/`. Writable project dir + `/tmp`. Write profile to `~/.notesage/sandbox/profiles/`. Returns the profile path.
- **Files:** `src-tauri/src/commands/sandbox.rs` (new)

### #8 — Sandboxed agent spawn in `acp.rs` ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #3, #7
- **Description:** Modify the agent spawn code in `acp_agent_spawn`. Read `sandbox_enabled` from the spawn request (default: true for managed, false for system). On macOS: wrap spawn with `sandbox-exec -f <profile>`. On Linux: wrap with `bwrap` arguments (or apply Landlock). Preserve existing stdio piping, `kill_on_drop`, and ACP initialization. Add `sandbox_enabled` field to `SpawnResult` for frontend awareness. Conditionally compile per platform.
- **Files:** `src-tauri/src/commands/acp.rs`, `src-tauri/src/commands/sandbox.rs`

### #9 — Update checking system ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #4
- **Description:** Add `agent_check_updates` Tauri command. Reads `versions.json`, queries GitHub Releases API (or npm registry for Gemini) for each managed agent. Returns list of agents with updates available. Respects rate limiting (cache `lastChecked` timestamp, minimum 24h between automatic checks). Add `agent_update` command that stops running agent, downloads new version, replaces binary, updates `versions.json`. Emits `agent-update-available` events.
- **Files:** `src-tauri/src/commands/agent_manager.rs`, `src-tauri/src/lib.rs`

### #10 — Update `AgentInstallMeta` and `ProviderOption` ✅

- **Complexity:** S | **Category:** frontend
- **Description:** Replace `AgentInstallInfo` with `AgentInstallMeta` interface. Add `githubRepo`, `npmPackage`, `manualCommand`, `docsUrl`, `requiresNodeRuntime`, `allowedDomains` fields. Add `installMeta` to `ProviderOption`. Populate for all agent entries. Add `binarySource` and `sandboxEnabled` to `Connection` interface.
- **Files:** `src/lib/ai/connections.ts`

### #11 — Redesign install wizard UI ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #6, #10
- **Description:** Redesign `ConnectAgent` component. When binary not found on system, show "Install" button (managed download) with progress bar + phase indicator (downloading → verifying → extracting → configuring). Show manual install command as fallback. On install failure, show error with retry. When binary found on system, skip install phase entirely. Add source indicator to connection card ("Managed by Notesage" vs "System install"). Add sandbox toggle per connection (default based on source). After successful managed install, auto-proceed to auth phase.
- **Files:** `src/components/settings/ConnectionsSettings.tsx`

### #12 — Update indicator and update UI ✅

- **Complexity:** L | **Category:** frontend + backend | **Depends on:** #9, #11
- **Description:** Trigger background update check on app launch and every 24h. Show update badge on connection cards when update available ("v1.2 → v1.3"). Add "Check for updates" action per connection and in connections header. Update flow: confirm if agent is running ("Restart to update?"), show progress, toast on completion. Add "Managed Agents" section to settings showing all managed binaries with versions and update status.
- **Files:** `src/components/settings/ConnectionsSettings.tsx`, `src/stores/connections-store.ts` (or new `agent-store.ts`)

## Phase 2 — Network Sandboxing

**Total:** 4 tasks (1S, 1M, 2L)

### #13 — Per-agent domain allowlist configuration ✅

- **Complexity:** S | **Category:** backend
- **Description:** Define static domain allowlists per agent in `sandbox.rs`. Add `allowed_domains` to `SandboxConfig`. Store custom domain additions in settings.
- **Files:** `src-tauri/src/commands/sandbox.rs`
- **Implemented in:** `docs/tasks/2026-03-16-network-sandboxing-tasks.md` (#4)

### #14 — HTTP/SOCKS5 proxy with domain filtering ✅

- **Complexity:** L | **Category:** backend | **Depends on:** #13
- **Description:** Implement a lightweight HTTP+SOCKS5 proxy in Rust that listens on a Unix domain socket. Proxy inspects connection targets against the agent's domain allowlist. Allowed domains are forwarded. Unknown domains emit a Tauri event for user confirmation (allow once / allow for session / allow always). TLS passthrough (CONNECT method) for HTTPS.
- **Files:** `src-tauri/src/commands/network_proxy.rs`
- **Implemented in:** `docs/tasks/2026-03-16-network-sandboxing-tasks.md` (#1–#3)

### #15 — Update sandbox profiles for network isolation ✅

- **Complexity:** M | **Category:** backend | **Depends on:** #8, #14
- **Description:** Update Seatbelt profiles to deny all network access (`(deny network*)`) except Unix domain sockets. Update bwrap invocation with `--unshare-net`. Set `HTTP_PROXY` and `HTTPS_PROXY` environment variables on the sandboxed agent process pointing to the Unix socket. Ensure the proxy is started before the agent and stopped after.
- **Files:** `src-tauri/src/commands/sandbox.rs`, `src-tauri/src/commands/acp.rs`
- **Implemented in:** `docs/tasks/2026-03-16-network-sandboxing-tasks.md` (#5–#7)

### #16 — Network permission UI ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #14
- **Description:** Handle `domain-permission-request` Tauri events. Show inline prompt in chat/activity panel: "Agent wants to connect to example.com — Allow once / Allow for session / Allow always / Deny". Persist always-allowed domains per agent. Show allowed domains list in connection settings. Integrate with existing permission store patterns.
- **Files:** `src/components/chat/DomainApprovalCard.tsx`, `src/stores/permission-store.ts`
- **Implemented in:** `docs/tasks/2026-03-16-network-sandboxing-tasks.md` (#8–#12)

## Phase 3 — User-Configurable Policies

**Total:** 2 tasks (1M, 1L)

### #17 — Sandbox policy settings data model ✅

- **Complexity:** M | **Category:** both
- **Description:** Add per-connection sandbox policy to connections store: custom writable paths, custom denied paths, custom allowed domains. Add Tauri commands to read/write policy. Update sandbox profile generation to incorporate custom rules.
- **Files:** `src/stores/connections-store.ts`, `src-tauri/src/commands/sandbox.rs`
- **Implemented in:** Connection config dialog Security section with writable paths, network toggle, domain allowlists

### #18 — Sandbox policy settings UI ✅

- **Complexity:** L | **Category:** frontend | **Depends on:** #17
- **Description:** Add "Sandbox Policy" section to connection detail settings. Editable lists for: additional writable paths (with folder picker), additional denied paths, additional allowed domains. Preview of effective policy. Reset to defaults button.
- **Files:** `src/components/settings/ConnectionConfigDialog.tsx`
- **Implemented in:** `docs/tasks/2026-03-16-network-sandboxing-tasks.md` (#12)