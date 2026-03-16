# Agent Binary Management & Runtime Sandboxing — Implementation Plan

**Status:** 🔮 Future **PRD:** `docs/prds/2026-02-21-agent-install-wizard.md`**Tasks:** `docs/tasks/2026-02-21-agent-install-wizard-tasks.md`**Date:** 2026-03-01

## Approach: Thin Vertical Slices

Build end-to-end for one agent first, then scale. Each slice is independently shippable.

## Pre-work: Two Validation Spikes

Before writing production code, validate the two riskiest assumptions.

### Spike A: GitHub Release Binary Downloads (\~30 min, manual research)

Verify that pre-built binaries are actually available and usable:

- [x] Check `zed-industries/claude-agent-acp` GitHub Releases — `claude-agent-acp-{os}-{arch}.zip` (e.g., `darwin-arm64`). v0.21.0, \~26MB.

- [x] Check `zed-industries/codex-acp` GitHub Releases — `codex-acp-{version}-{rust-triple}.tar.gz` (e.g., `aarch64-apple-darwin`). v0.10.0, \~32MB. Note: uses Rust target triples, not `darwin-arm64`.

- [x] Check `github/copilot-cli` — `copilot-{os}-{arch}.tar.gz` (e.g., `darwin-arm64`). v1.0.5, \~58MB. Includes `SHA256SUMS.txt`.

- [x] Check `github/copilot-language-server-release` — `copilot-language-server-{os}-{arch}-{version}.zip`. v1.453.0, \~45MB. No `v` prefix on version tag. May need sibling files from dist/.

- [x] Are binaries standalone? YES for claude-agent-acp, codex-acp, copilot. PARTIAL for copilot-language-server. NO for gemini (JS-only, needs Node.js).

- [x] Does `claude-agent-acp` need `claude` CLI for auth? NO — bundles Claude Agent SDK. Auth via `ANTHROPIC_API_KEY` env var or `/login` OAuth.

- [x] Does macOS Gatekeeper quarantine? YES — must run `xattr -d com.apple.quarantine` after download.

- [x] Checksums? Only copilot CLI provides `SHA256SUMS.txt`. Others have no checksums.

**Exit criteria:** ✅ Asset naming patterns documented. Gemini confirmed as npm-only (needs portable Node.js).

### Spike B: Seatbelt Sandbox Compatibility (\~15 min, manual test)

Verify `sandbox-exec` doesn't break agent functionality:

```bash
# Write a minimal profile
cat > /tmp/test-agent.sb << 'EOF'
(version 1)
(deny default)
(allow file-read*)
(allow file-write* (subpath "/tmp") (subpath "$HOME/Development/test-project"))
(deny file-read* (subpath "$HOME/.ssh"))
(allow network*)
(allow process-exec*)
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
EOF

# Try running an agent under it
sandbox-exec -f /tmp/test-agent.sb claude-agent-acp
```

Test:

- [x] Agent starts and completes ACP initialize handshake — `claude-agent-acp` starts clean under sandbox, no errors on stderr.

- [x] Agent can read files in the allowed project directory — confirmed via `ls /tmp`

- [x] Agent can write files in the allowed project directory — confirmed write to `/tmp`

- [x] Agent cannot read `~/.ssh/` — confirmed: "Operation not permitted"

- [x] Agent can make network requests (API calls work) — `(allow network*)` in profile

- [x] Agent can spawn child processes (git, grep, etc.) — `(allow process-exec*)` + `(allow process-fork)` in profile

**Exit criteria:** ✅ Seatbelt sandboxing works with `claude-agent-acp` on macOS 26.3.1. Minimal profile is sufficient — no adjustments needed.

### Additional Spike: Verify Gemini CLI ACP flag

- [x] Test `gemini --acp` — confirmed: needs `--experimental-acp` (not `--acp`)

- [x] Updated `connections.ts` `agentArgs` from `['--acp']` to `['--experimental-acp']`

## Slice 1: Managed Install for One Agent (end-to-end)

**Target agent:** `claude-agent-acp`**Goal:** User clicks "Install" → binary downloads → agent works from `~/.notesage/agents/bin/`**Estimated effort:** 3-4 days **Tasks:** #1, #2, #3, #4, #6, #10, #11 (scoped to single agent)

### Backend

1. **New** `src-tauri/src/commands/agent_manager.rs`**:**

   - `ensure_agent_dirs()` — create `~/.notesage/agents/{bin,lib}`, `~/.notesage/runtime/`, `~/.notesage/sandbox/profiles/`
   - `detect_platform()` — returns `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`
   - `agent_resolve_binary(agent_id)` — check managed dir first, then system PATH, return `{ path, source }`
   - `agent_install(agent_id)` — download from GitHub Releases, extract, chmod +x, write `versions.json`
   - Download with progress events (`agent-install-progress`)
   - Concurrency guard (one install at a time)

2. **Register in** `src-tauri/src/lib.rs`**:** Add new commands to `generate_handler![]`

3. **Update** `src-tauri/src/commands/acp.rs`**:** Use `agent_resolve_binary()` for binary lookup instead of raw PATH search

### Frontend

4. **Update** `src/lib/ai/connections.ts`**:**

   - Add `AgentInstallMeta` interface
   - Add `installMeta` to `ProviderOption`
   - Populate for `claude-agent-acp`
   - Add `binarySource` and `sandboxEnabled` to `Connection`

5. **Update** `src/components/settings/ConnectionsSettings.tsx`**:**

   - When binary not found: show "Install" button with download progress bar
   - Progress phases: downloading → verifying → extracting → configuring
   - Keep manual install command as fallback
   - On success: auto-proceed to auth phase
   - Add source indicator to connection card

### Test Checklist

- [ ] Fresh system (no claude-agent-acp on PATH): Install button appears, download works, agent starts

- [ ] System with existing claude-agent-acp: uses system binary, no install offered

- [ ] Download failure: error message with retry

- [ ] `cargo check` + `npx tsc --noEmit` pass

- [ ] Light and dark mode

## Slice 2: Scale to All Agents + Gemini Special Case

**Goal:** All 5 agents installable via managed download **Estimated effort:** 1-2 days **Tasks:** #5, remainder of #6, #10

### Work

1. Add GitHub Release configs for `codex-acp`, `copilot`, `copilot-language-server`
2. Build portable Node.js download (`agent_install_node_runtime`) for Gemini CLI
3. Gemini install flow: download Node.js → npm install --prefix → symlink binary
4. Verify all agents install and authenticate correctly
5. Verify Gemini `--acp` vs `--experimental-acp`

### Test Checklist

- [ ] Each agent: install from scratch, authenticate, run a prompt

- [ ] Gemini: portable Node.js downloads, npm install works in prefix mode

- [ ] No interference between managed agents

## Slice 3: Filesystem Sandboxing

**Goal:** Managed agents run inside OS-level filesystem sandbox **Estimated effort:** 2-3 days **Tasks:** #7, #8

### Backend

1. **New** `src-tauri/src/commands/sandbox.rs`**:**

   - `generate_seatbelt_profile(working_dir, config)` → writes `.sb` file, returns path
   - Hardcoded deny: `~/.ssh`, `~/.aws`, `~/.gnupg`, `.env` files
   - Hardcoded read-only: `.git/` directories
   - Allow write: project dir, `/tmp`
   - `build_bwrap_args(working_dir, config)` → Linux equivalent

2. **Modify spawn in** `src-tauri/src/commands/acp.rs`**:**

   - Accept `sandbox_enabled` in spawn request (default based on binary source)
   - `#[cfg(target_os = "macos")]`: wrap with `sandbox-exec -f <profile>`
   - `#[cfg(target_os = "linux")]`: wrap with `bwrap` or apply Landlock
   - Preserve existing stdio piping, kill_on_drop, ACP init

### Frontend

3. Add sandbox toggle to connection card (default: on for managed, off for system)
4. Show sandbox status in connection details

### Test Checklist

- [ ] Sandboxed agent can read/write project directory

- [ ] Sandboxed agent cannot read `~/.ssh/` (attempt fails gracefully)

- [ ] Sandboxed agent can make network requests

- [ ] Sandboxed agent can spawn git, grep, etc.

- [ ] System-installed agent runs without sandbox (no regression)

- [ ] User can toggle sandbox on/off per connection

## Slice 4: Update Checking

**Goal:** Users know when updates are available, can update with one click **Estimated effort:** 2 days **Tasks:** #9, #12

### Backend

1. `agent_check_updates()` — query GitHub Releases API, compare against `versions.json`
2. `agent_update(agent_id)` — stop agent if running, download new binary, replace, update versions
3. Rate limiting: minimum 24h between automatic checks, stored in `versions.json`
4. Emit `agent-update-available` events

### Frontend

5. Background update check on app launch + every 24h
6. Update badge on connection card: "v1.2 → v1.3 available"
7. "Check for updates" button per connection + header action
8. Update flow: confirm restart if agent is running → progress → toast on completion

### Test Checklist

- [ ] Update detected when newer release exists

- [ ] Update badge appears on connection card

- [ ] Update flow: stop → download → replace → restart

- [ ] Running agent prompted before restart

- [ ] Manual "Check for updates" works

## Slice 5 (Phase 2): Network Sandboxing ✅

**Goal:** Sandboxed agents can only reach approved network domains **Estimated effort:** 5-7 days **Tasks:** #13, #14, #15, #16 **PRD:** `docs/prds/2026-03-16-network-sandboxing.md`

### Backend

1. Per-agent domain allowlist config in `sandbox.rs`
2. HTTP/SOCKS5 proxy in Rust (evaluate `hudsucker` + `fast-socks5` crates vs custom)
3. Proxy listens on Unix domain socket, enforces domain allowlist
4. Unknown domains emit Tauri event for user approval
5. Update Seatbelt profiles: `(deny network*)` + `(allow network-unix)`
6. Update bwrap: `--unshare-net` + socat bridge
7. Set `HTTP_PROXY`/`HTTPS_PROXY` env vars on sandboxed agent

### Frontend

 8. Domain permission prompt (Allow once / session / always / Deny)
 9. Allowed domains list in connection settings
10. Integrate with existing permission store patterns

### Test Checklist

- [ ] Sandboxed agent's API calls work through proxy

- [ ] Sandboxed agent cannot reach unlisted domains

- [ ] Unknown domain triggers user prompt

- [ ] "Allow always" persists across sessions

## Phase 3: User-Configurable Policies

**Tasks:** #17, #18 **Estimated effort:** 2-3 days

Defer until Phases 1-2 are solid. Adds custom writable paths, denied paths, and domains per connection via Settings UI.

## Module Structure

```
src-tauri/src/commands/
├── mod.rs                  # Add agent_manager, sandbox
├── acp.rs                  # Modified: use agent_resolve_binary(), conditional sandbox
├── agent_manager.rs        # NEW: install, update, resolve, version tracking
├── sandbox.rs              # NEW: Seatbelt profile gen, bwrap args
├── copilot_lsp.rs          # Modified: use agent_resolve_binary()
└── ...

src/
├── lib/ai/connections.ts   # Modified: AgentInstallMeta, binarySource, sandboxEnabled
├── components/settings/
│   └── ConnectionsSettings.tsx  # Modified: install wizard, sandbox toggle, updates
└── stores/
    └── connections-store.ts     # Modified: binarySource, sandboxEnabled per connection
```

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| GitHub Release asset naming varies per repo | Medium | High | Spike A validates; npm fallback exists |
| Seatbelt breaks agent functionality | Low | High | Spike B validates before any code |
| Gatekeeper quarantines downloaded binaries | Medium | Medium | `xattr -d com.apple.quarantine` after download |
| Gemini CLI native deps fail without C++ toolchain | Low | Medium | Prebuilds usually work; graceful error if not |
| claude-agent-acp binary needs `claude` for auth | Medium | Low | Document as requirement; user likely has `claude` |
| `sandbox-exec` removed in future macOS | Very Low | High | Monitor Apple releases; fallback to unsandboxed |
| Network proxy complexity exceeds estimate | Medium | Medium | Defer to Phase 2; filesystem sandbox alone is valuable |

## Decision Log

| Decision | Rationale |
| --- | --- |
| Download binaries from GitHub Releases, not npm | 4 of 5 agents are native binaries; npm is just delivery. Eliminates Node.js dependency. |
| Prefer system-installed binaries | Respect user's existing setup. Only offer managed install when binary not found. |
| Sandbox managed installs by default, not system | Managed = Notesage's responsibility. System = user's choice. |
| Seatbelt over private APIs | `sandbox-exec` is deprecated but universally used (Chrome, Claude Code, Cursor). Stable in practice. |
| Vertical slices over horizontal layers | Each slice delivers shippable value. Avoids building infrastructure that sits unused. |
| One agent first (claude-agent-acp) | Proves architecture before scaling. Fastest path to user value. |
| Portable Node.js only for Gemini | Only agent that genuinely needs a runtime. Others are native binaries. |
