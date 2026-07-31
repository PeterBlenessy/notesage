# PRD: pi Local Agent Preset — ACP Bridge + Extensions

|  |  |
| --- | --- |
| **Date** | 2026-07-29 |
| **Status** | Implemented — M0 gate GREEN (all spikes pass, #2 verified on macOS 2026-07-30); only #22 in-app live E2E (operator-run) remains before merge |
| **Priority** | Medium |
| **Impact** | A second fully-offline Local Agent preset (pi) beside Goose — same one-click setup, same kernel-enforced zero-network guarantee — unlocking pi's checksummed releases, structured edit diffs, auto-compaction, and SKILL.md interop |
| **Tasks** | [pi-local-agent-preset-tasks](../tasks/2026-07-29-pi-local-agent-preset-tasks.md) |
| **Phase** | Privacy-First Local AI |

## Problem

The Local Agent preset (PRD `2026-06-12-local-ai-agents.md`) ships exactly one agent: Goose. That worked because Goose natively speaks the three protocols the Notesage agent stack is built on — ACP over stdio, ACP permission requests, and ACP MCP pass-through — so it needed zero agent-side code. But a single-agent preset is a single point of failure (upstream direction changes, release stalls, model-compatibility gaps), and the strongest alternative in the ecosystem, **pi** (`earendil-works/pi`, MIT, ~70k stars), deliberately supports none of those protocols in core: no ACP, no MCP, no permission prompts. Its embedding surface is its own JSONL RPC over stdio plus in-process TypeScript extensions.

pi clears every *runtime* requirement the preset enforces — self-contained Bun-compiled platform binaries on GitHub releases (**with `SHA256SUMS`**, which Goose lacks — closing the open checksum-verification TODO in `agent_manager.rs`), `PI_OFFLINE=1` to disable all startup network, `PI_CODING_AGENT_DIR` to redirect its entire state tree, and documented dummy-key OpenAI-compatible providers against localhost llama.cpp. What's missing is bridgeable from our side without upstream cooperation: an ACP↔RPC bridge process and two small pi extensions.

Why now: the analysis is fresh (this PRD's research thread, 2026-07-29), the custom-ACP plumbing from the Goose work is designed for exactly this reuse, and three load-bearing assumptions are cheap to spike before any real commitment.

## Goals

1. **De-risk before building.** Three spikes (M0) settle the unverified assumptions; the PRD's build phases are hard-gated on all three passing. A failed spike ends the initiative with a documented finding, not a workaround.
2. **pi as a second preset.** The Add-Connection Local Agent flow offers Goose (default) and pi; both run through the identical staged setup (detect → download → configure → verify) with rollback-on-failure, and both land as `custom_acp`-style connections indistinguishable to the chat stack.
3. **Verifiably offline, same bar as Goose.** pi + bridge run under the kernel network sandbox with an **empty** domain allowlist — only the llama-server localhost port reachable — regression-locked by test.
4. **No protocol fork downstream.** Everything after `acp.rs` (session updates, segments, PermissionCards, smoke test, MCP pass-through, session restore) works unchanged. The bridge is the only component that knows pi's RPC exists.
5. **Supply-chain hardening as a side effect.** The GitHub-binary install path gains real checksum verification (pi's `SHA256SUMS`), exercised in tests — infrastructure Goose inherits the day upstream publishes a checksum asset.

## Non-Goals

- **Replacing Goose.** Goose remains the default Local Agent preset; pi is an alternative.
- **A native Rust pi-RPC path** (the "Option B" from the research thread). The bridge deliberately trades pi's ACP-inexpressible features (mid-turn steering, session-tree navigation, compaction control) for zero downstream change. Revisit only if those become product features.
- **Windows support.** Same platform matrix as Goose (darwin arm64/x64, linux arm64/x64 for CI), even though pi ships Windows binaries.
- **Depending on third-party adapters** (`svkozak/pi-acp`, `pi-mcp-adapter`). They prove feasibility but are MVP-grade and/or reintroduce a Node runtime; we author and version our own bridge + extensions.
- **Exposing pi's extension ecosystem to users.** The two extensions we ship are internal plumbing, not a user-facing extension manager.

## User Stories

- As a **privacy-focused writer**, I want a choice of local agent engines behind the same one-click offline setup, so that I'm not tied to a single upstream project's fate.
- As a **cautious user**, I want the pi preset to carry the exact same kernel-enforced zero-network guarantee as Goose, so that "offline" stays a property of the sandbox, not the agent.
- As a **skills user**, I want my existing SKILL.md skills available to the pi agent (pi implements the same Agent Skills standard and scans configurable skill paths), so that my skill corpus works across engines.
- As a **maintainer**, I want pi pinned to an exactly-tested version range with the bridge and extensions versioned in lockstep, so that pi's weekly 0.x releases can't silently break the preset.

## Technical Approach

### M0 — De-risking spikes (hard gate; ~half a day each)

All three must pass before M1 starts. Each produces a written finding in `docs/research/2026-07-29-pi-spikes.md`.

1. **Bun-binary parity.** Download the release tarball (`pi-darwin-arm64.tar.gz`), verify against `SHA256SUMS`, extract (note: the archive is a *folder* — executable + wasm + native bindings + themes that must stay co-located), and confirm the Bun-compiled binary (a) runs `--mode rpc` with correct JSONL framing and (b) loads a TypeScript extension from `PI_CODING_AGENT_DIR/extensions/` identically to the npm build.
2. **Zero-network under Seatbelt.** Run the binary with `PI_OFFLINE=1`, a localhost `models.json` provider, and the Goose-preset Seatbelt profile (deny-all network + llama port). Confirm a full agentic turn with no violations in `sandbox_monitor`. Explicitly test that injected `HTTP_PROXY`/`HTTPS_PROXY` env vars don't cause pi's undici stack to route the llama-server call into the proxy (mitigation if it does: strip/`NO_PROXY=localhost` in the spawn env for this preset, mirroring how the llama port bypasses the proxy for Goose).
3. **Permission round-trip.** A minimal blocking `tool_call` extension raises `ctx.ui.confirm`; confirm the `extension_ui_request` event surfaces on RPC stdout while the tool is blocked, that a delayed `extension_ui_response` resumes/blocks correctly, and that a never-answered request can be aborted (`abort`) without wedging the session — this is what the 30s auto-deny path needs.

### M1 — `notesage-acp-pi` bridge

A TypeScript program, Bun-compiled per platform (same `bun build --compile` technique pi itself uses → self-contained, no Node runtime), living in-repo under `bridges/pi-acp/` and published as a tarball on Notesage's own GitHub releases. It presents ACP (agent side) on its stdio and spawns `pi --mode rpc` as a child.

Core translation table:

| ACP (Notesage side) | pi RPC (child side) |
| --- | --- |
| `initialize` → capabilities | static: `sessions: { load, fork }`, `mcp: { stdio }`, `promptCapabilities.images: true` |
| `session/new` (cwd, mcp_servers) | `new_session`; MCP config handed to the MCP extension (see M2) |
| `session/load` / fork | `switch_session` / `fork` (pi sessions are JSONL trees on disk under the redirected dir) |
| `session/prompt` (text + images) | `prompt` with `images` |
| `session/cancel` | `abort` |
| ← `agent_message_chunk` / `agent_thought_chunk` | ← `message_update` `text_delta` / `thinking_delta` |
| ← `tool_call` / `tool_call_update` (incl. `Diff` content from structured path/oldText/newText) | ← `tool_execution_start/update/end` |
| ← `request_permission` | ← `extension_ui_request` from the permission-gate extension |
| ← `usage_update` | ← `get_session_stats` after `agent_end` (best-effort) |

Lifecycle: the bridge owns the pi child in a process group; ACP transport close or SIGTERM triggers awaited child teardown (kill process group) so `kill_on_drop` on the bridge can never orphan pi — mirroring the awaited-teardown discipline from `transcription.rs`/ACP cleanup.

### M2 — pi extensions (shipped by us, written at config time)

Both extensions are embedded in the app (versioned with the Notesage release) and **written into `~/.notesage/agents/pi/agent/extensions/` by `local_agent_write_config`** on every config regeneration — so extension updates ride app updates, and a user's own pi install is never touched.

1. **Permission gate.** Blocking `pi.on("tool_call", …)` hook for write/execute tools → `ctx.ui.confirm` → surfaces as `extension_ui_request` → bridge translates to ACP `request_permission` with the standard tiered options. "Allow always/session" state is enforced Notesage-side (the existing `ScopedApproval` machinery answers the request); the extension stays stateless. Handler errors block fail-safe.
2. **MCP tools.** Registers the session's MCP servers' tools with pi and proxies calls. Server configs (keychain secrets already resolved by the existing `build_acp_mcp_servers` path) reach the extension from the bridge **without touching disk** — bridge → pi via a config env var / RPC side-channel decided during implementation; writing secrets into `mcp.json` is explicitly rejected. Stdio MCP servers spawned by the extension inherit pi's Seatbelt sandbox, same as the Goose path.

### M3 — Preset integration (reuse, not rebuild)

- **Install** (`agent_manager.rs`): `pi` + `notesage-acp-pi` entries in the GitHub-binary registry. New capability on that path: `GITHUB_BINARY_CHECKSUM_ASSET` becomes per-agent config; pi verifies against `SHA256SUMS` (hard fail on mismatch), Goose keeps digest-record-only. **Version pin is an exact tested range** (`min_version` + new `max_version`) — `agent_check_updates` refuses pi versions outside the range until a Notesage release moves it.
- **Config** (`local_agent.rs`): `local_agent_write_config` gains an agent discriminator. The pi variant writes into `~/.notesage/agents/pi/`: `agent/models.json` (provider `local`, `baseUrl: http://localhost:<port>/v1`, `api: "openai-completions"`, `apiKey: "dummy"`, single model entry = active catalog model), `agent/settings.json` (`enableInstallTelemetry: false`, skill paths pointed at Notesage skill dirs), and the two extensions. Spawn env: `PI_OFFLINE=1`, `PI_CODING_AGENT_DIR`, `NO_PROXY=localhost,127.0.0.1` (pending spike 2 findings). Same `<port>:<modelId>` respawn key as Goose.
- **Sandbox** (`sandbox.rs`): no new Bucket C rows needed — the whole footprint lives under the `.notesage` write-allow. Regression-lock: the pi-preset profile allows exactly {proxy port, llama port} on localhost.
- **Setup flow**: `runLocalAgentSetup` is already agent-agnostic via deps injection; the pi path supplies pi-flavored `installAgent`/`writeConfig`/`createPresetConnection` deps. Smoke test, rollback-on-failure, and the no-silent-fallback error surfacing apply unchanged.
- **Routing/chat**: the connection is `custom_acp` with `binaryPath` = bridge, `localAgentPreset: 'pi'`. Nothing downstream branches on it.

## UI/UX

- **Add Connection → Local Agent card** gains an engine choice (radio or segmented control per design system; shadcn primitives): **Goose (default)** and **pi**, each with a one-line description + attribution ("powered by pi, an open-source agent by Mario Zechner / earendil-works"). No other new surfaces — `LocalAgentSetupDialog` stages, progress, error attribution, and retry are shared.
- **Settings → Connections** card shows the engine name and installed pi/bridge versions; update checking surfaces "held back" state when upstream is outside the tested range (muted text, not an error).
- States: setup failure keeps the existing per-stage attribution ("failed while installing agent" etc.); a checksum mismatch is its own explicit error string (security-relevant, never retried silently).

## Data Model

```typescript
// connections.ts
localAgentPreset?: 'goose' | 'pi';

// lib/tauri.ts — LocalAgentConfig gains
interface LocalAgentConfig {
  // existing fields…
  agent: 'goose' | 'pi';
  bridgePath?: string;   // pi only: resolved notesage-acp-pi binary
}
```

```rust
// local_agent.rs
#[tauri::command]
pub async fn local_agent_write_config(
    state: State<'_, LocalInferenceState>,
    agent: Option<String>, // None → "goose" (back-compat)
) -> Result<LocalAgentConfig, String>;

// agent_manager.rs — GithubBinaryAgentConfig gains
checksum_asset: Option<&'static str>, // pi: Some("SHA256SUMS"); goose: None
max_version: Option<&'static str>,    // pi: Some(exact tested ceiling); goose: None
```

Bridge + extensions: `bridges/pi-acp/` (TypeScript, own vitest suite, Bun-compiled in CI/release workflow; extension sources embedded via `include_str!` or bundled resources on the Rust side).

## Dependencies

| Dependency | Status | Notes |
| --- | --- | --- |
| M0 spikes all pass | **Gate** | Any failure → document and stop |
| pi releases (`earendil-works/pi`, MIT) | External | Bun-compiled platform binaries + `SHA256SUMS`; pin exact tested range (0.80.x at time of writing); weekly 0.x churn is the top risk |
| Goose-preset plumbing (`local_agent.rs`, `runLocalAgentSetup`, smoke test, sandbox profile, GitHub-binary install) | Shipped | Reused with agent discriminator |
| MCP pass-through (`build_acp_mcp_servers`) | Shipped | Bridge consumes the same resolved-secrets payload |
| Bun toolchain in release CI | New | Only for compiling the bridge; not a runtime dependency |

## Quality Gates

Functional:
- [ ] All three M0 spike findings documented; gates green
- [ ] `pnpm typecheck`, `pnpm test`, bridge package tests, `cargo check` (stubs) / `cargo test` (CI) green
- [ ] Sandbox regression-lock: pi-preset profile allows exactly {proxy port, llama-server port} on localhost, nothing else
- [ ] Checksum verification test: tampered archive → hard install failure with explicit error
- [ ] Version-range lock tests (repo, bin name, min/max pin) for `pi` and `notesage-acp-pi`, mirroring `goose_installs_via_github_binary`
- [ ] Permission flow end-to-end: write-tool call → PermissionCard → allow/deny/timeout(30s auto-deny) all resolve without wedging the session
- [ ] MCP: a registered stdio server's tool callable through the pi preset; secrets never written to disk (asserted by test on the generated config tree)
- [ ] Smoke test green on real macOS Seatbelt (live WebDriver run, same bar as Goose's #23)
- [ ] Teardown: closing the conversation / app exit leaves no orphaned `pi` process (process-group kill verified)
- [ ] Zero regression to the Goose preset and the four managed agents (existing suites green)
- [ ] `tauri-capability-surface.test.ts` unchanged

Design:
- [ ] Engine choice UI uses shadcn primitives, strict-neutral palette, both themes
- [ ] Attribution present on the card and setup dialog (matching Goose's treatment)

## Out of Scope (deferred)

- Native Rust pi-RPC path exposing steering / session-tree navigation / auto-compaction as product features
- Goose deprecation or default-engine change
- Windows platform assets
- User-facing pi extension management or arbitrary extension installation
- Exposing pi's `set_thinking_level` as a UI control (map to existing thinking-effort UI later if demanded)
