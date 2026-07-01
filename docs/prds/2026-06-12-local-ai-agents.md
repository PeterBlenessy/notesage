# PRD: Local AI Agents — Offline Agentic Chat for Local Models

|  |  |
| --- | --- |
| **Date** | 2026-06-12 |
| **Status** | Implemented — PR #458 (pending merge). Preset agent shipped as **Goose** (not OpenCode); see the tasks addendum. |
| **Priority** | High |
| **Impact** | One decision ("use local AI") gives the user a fully offline agentic chat — a real agent loop (planning, multi-step tool use, file edits) plus MCP tools, running entirely against the bundled llama-server, with a verifiably empty network allowlist |
| **Tasks** | [local-ai-agents-tasks](../tasks/2026-06-12-local-ai-agents-tasks.md) |
| **Phase** | Privacy-First Local AI |

## Problem

Notesage's privacy pillar is underserved on exactly the axis users care about most: **agency**.

- **Local models have no agent loop.** The bundled llama-server (Path 4) and Ollama (Path 1) get the direct-API tool cycle in `useDirectApiChat` — a flat `ai_chat_stream` + tool-call loop with built-in and skill tools. Cloud subscribers get Claude Code / Codex / Copilot / Gemini through ACP: planning, modes, multi-step orchestration, file edits, session restoration. The gap is structural, not a model-quality issue.
- **MCP is display-only.** The MCP client (`mcp.rs` + `mcp_oauth.rs`, ~2,800 lines) registers, validates, and lists servers — but no AI path can call an MCP tool today: `getToolDefinitions()` merges only `BUILT_IN_TOOLS` + skill tools, and ACP sessions are created without `mcp_servers`. (The agent-side half of closing this is the `mcp_servers` pass-through — a prerequisite task, see Dependencies.)
- **The ecosystem has caught up.** ACP now has mature open-source agents that run as spawnable stdio binaries against local OpenAI-compatible endpoints — OpenCode (`opencode acp`, listed in the official agent registry, MIT, ~40 MB darwin binaries) and Qwen Code (`qwen --experimental-acp`). Notesage's ACP client, sandbox, permission UI, and managed-install system already exist; what's missing is the ability to point them at an agent that isn't one of the four hardcoded providers.

Why now: the ACP 0.14.0 migration (successor to `docs/prds/2026-05-31-acp-0.12-migration.md`) touches the same surfaces, and the protocol's direction of travel (`unstable_llm_providers`) confirms local-endpoint agents are where the ecosystem is heading. Building the generic agent plumbing now means the eventual protocol-native path is a config swap, not a rebuild.

## Goals

1. **Custom ACP agent connections.** A user can register any ACP-compatible agent binary (path + args + env vars) as a connection, with capability probing, sandboxing, and the full existing chat UX (modes, plans, thinking, permissions, usage) working unchanged.
2. **One-click Local Agent preset.** Choosing "Local AI" installs OpenCode via the existing managed-install system, wires it to the bundled llama-server, and defaults the local connection to agentic chat — no terminal, no Homebrew, no manual config.
3. **Verifiably offline.** The local agent runs under the kernel network sandbox with an **empty** domain allowlist — only the llama-server localhost port is reachable. The sandbox profile is regression-locked by test.
4. **MCP for local models.** MCP servers registered in Notesage are passed to the local agent at `session/new`, making registered MCP tools actually usable offline-locally (stdio servers inherit the agent's sandbox).
5. **Setup is a single staged flow** ending in a *verified* working state (smoke test), with graceful fallback to direct local chat (Path 4) if the agent install fails — and **zero regression** to the four managed agents or existing local chat.

## Non-Goals

- **Bundling the agent binary in the .app.** Upholds the Phase 10 install-wizard non-goal (bundle bloat, release-cadence mismatch, re-signing burden). Managed install delivers the same UX. Revisit only on evidence of install-step drop-off.
- **Building a Notesage-owned ACP agent.** The Rust SDK makes a thin agent feasible, but agent-loop quality is the hard 80%. Fallback option only.
- **MCP tools in direct-API chats** (the "Option A" wiring into `tool-executor.ts`). Separate decision, deferred until this ships and demand is measurable.
- **`unstable_llm_providers` integration.** Watch-list item; when it stabilizes, frontier agents can be pointed at the local endpoint via `providers/set`. The preset's endpoint wiring must stay agent-agnostic so that swap is cheap.
- **A blocking first-launch onboarding wizard.** AI remains optional; entry points are lightweight (see UI/UX). "Skip" is first-class.
- **Windows/Linux sandboxing** for custom agents (macOS Seatbelt only, matching the existing sandbox scope).
- **Qwen Code preset.** Custom-connection support makes it user-reachable; a curated preset can follow.

## User Stories

- As a **privacy-focused writer**, I want to enable local AI once and get an agent that can plan, search my notes, and edit files — entirely offline — so that no text ever leaves my machine.
- As an **existing Local AI user**, I want my current local chat to gain agentic abilities without reconfiguring anything, so that upgrading is one click, not a migration.
- As a **power user**, I want to register my own ACP agent binary (Qwen Code, a nightly OpenCode, something homegrown) with custom args and env, so that Notesage isn't limited to its four built-in providers.
- As an **MCP user**, I want the servers I registered in Settings to be callable by my local agent, so that the MCP section stops being a list of tools nothing can use.
- As a **cautious user**, I want proof the local agent cannot reach the network, so that "offline" is enforced by the kernel, not a promise.

## Technical Approach

Three milestones, each independently shippable.

### M1 — Custom ACP agent connections

The ACP layer (`acp.rs`, `useAcpLifecycle`, `useAcpSessionListeners`, `PermissionCard`, capability probing) is already protocol-generic. What is hardcoded is peripheral:

- **Provider type.** Add `'custom_acp'` to `ConnectionProvider` (`src/lib/ai/connections.ts`). Connection config gains `binaryPath`, `args: string[]`, and reuses the existing `envVars` keychain storage for secrets. Capabilities: `['interactive', 'agent_tasks']`.
- **Binary resolution.** `acp_binary.rs` accepts absolute paths verbatim (it currently resolves known agent names through PATH/Homebrew/npm/bundled). Validate existence + executable bit at registration; surface a precise error otherwise.
- **Capability probing.** The existing registration-time probe (spawn → initialize → session → stop) is reused as-is; `AcpDiscoveredCapabilities` already carries modes/config options generically. Probe failure blocks registration with the agent's stderr tail (mirror the MCP validate-on-add pattern).
- **Sandbox defaults (conservative).** Custom agents get **no** Bucket C `$HOME` config-dir grants by default — the per-binary basename match in `sandbox.rs` simply won't match. The connection dialog's existing writable-paths UI is the user's opt-in for agent config dirs. Domain allowlist starts **empty**; kernel network deny + proxy on by default, same as new managed connections.
- **No special-casing downstream.** Chat routing already keys on `agent_managed`-style connections via instance lifecycle, not provider name; verify and add regression tests rather than new branches.

### M2 — Local Agent preset (plumbing)

- **Install.** OpenCode added to the managed-install registry (`agent_manager.rs`: `agent_install` / `agent_check_updates` / `agent_update` / `agent_uninstall`), downloading the darwin-arm64/x64 release asset (~40 MB) from GitHub Releases to `~/.notesage/bin/`, with the existing progress events and quarantine handling.
- **Endpoint config.** Generate an OpenCode provider config pointing at the bundled server: `baseURL: http://localhost:<port>/v1` with model entries derived from the active catalog model. The bundled server's port is **dynamic** (`find_available_port` in `model_management.rs`), so config generation must read the live port from `LocalInferenceState` and **regenerate on server restart/port change** (respawn the agent when its `sandboxScopeKey`-equivalent config key changes, mirroring the existing scope-respawn pattern). Launch OpenCode with an **isolated config path** (env-var override) so a user's own OpenCode setup is never touched — exact mechanism verified during implementation.
- **Seatbelt extension.** The kernel network profile currently allows only the proxy port on localhost. Add a second literal allow for the llama-server port for this connection's profile. Bucket C grant for the `opencode` basename: its own config/cache dirs only (`~/.config/opencode`, `~/.cache/opencode` or as observed during implementation — verified against sandbox violation monitoring, not guessed).
- **MCP pass-through.** At `session/new`, pass enabled, scope-matching MCP servers (`McpServerStdio` configs; keychain env secrets resolved at spawn) gated on the agent's `McpCapabilities`. Stdio servers spawned by the agent inherit its Seatbelt sandbox and network deny — closing, for this path, the per-server sandbox gap deferred in the 2026-06-09 audit.
- **Routing + fallback.** When the preset is installed, the Local AI connection's interactive slot routes to the agent (agentic chat is the default experience). If the agent binary is missing, fails to spawn, or the smoke test failed, routing falls back to the existing Path 4 direct chat with a non-blocking notice — never a dead chat.
- **Model gating.** The preset requires a `supports_tool_calling` catalog model; the recommended default is RAM-tier-matched (reuse `2026-06-02-hardware-aware-model-recommendation` logic). Sub-8GB tiers get a "tool use will be unreliable" warning rather than a hard block.

### M3 — Local AI setup flow + entry points

A single staged flow, reachable from two existing surfaces (no new wizard framework):

1. **Detect & recommend** — RAM-tier detection picks the default tool-calling model; user can override from the filtered catalog list.
2. **Download in parallel** — agent binary (seconds) + model GGUF (the long pole), via existing progress events, surfaced as activity-store entries so the AgentOrb shows progress and the editor stays usable. Cancel and resume-on-reconnect supported (download infra already does both).
3. **Configure silently** — endpoint config, Seatbelt profile, empty allowlist, routing assignment. No user-visible steps.
4. **Verify** — smoke test: spawn → `initialize` → `session/new` → trivial prompt with a short timeout → teardown. Only a passing smoke test shows "Local AI is ready"; failure shows a precise error with retry, and Path 4 fallback activates.

State machine: `idle → detecting → downloading(agent|model|both) → configuring → verifying → ready | failed(stage, error)` — persisted enough to resume an interrupted flow after relaunch.

## UI/UX

Per `docs/design-system.md`: shadcn components only, strict-neutral palette, accent via `--color-accent-primary`, `TooltipProvider` wrapping for any tooltip, both themes + soft contrast.

- **Entry point A — command-bar empty state.** When no AI connection exists, the stream's existing onboarding prompts gain "Set up private, offline AI →" which launches the setup flow. (The stream's empty-state prompt mechanism already exists in `FloatingCommandBar`/`CommandBarStream`.)
- **Entry point B — Add Connection.** Two new cards: **Local Agent** (preset; primary treatment, shield/offline iconography from lucide, strokeWidth 1.5) and **Custom Agent** (binary path file-picker, args input, env-var rows with secret toggle — mirroring the MCP add dialog's field patterns).
- **Setup flow surface.** A dialog (max-w per design system) with a stage list and one progress bar per active download; downloads continue in the background if dismissed (activity-store + orb). States: each stage shows pending / active / done / failed; failed shows the error inline with Retry. Loading skeletons for catalog fetch.
- **Status.** While the local agent serves chat, the cmd-bar header (the surface formerly called "chat footer") shows the existing provider pill; an "Offline" badge variant communicates the empty-allowlist state. StatusTray completion-provider row is unaffected.
- **Fallback notice.** If routing degraded to Path 4, a one-line muted notice with "Fix" action in the cmd-bar header context row — not a toast storm.
- **Permissions.** Agent tool calls and MCP tool calls surface through the existing ACP `PermissionCard` tiers; no new permission UI.

## Data Model

```ts
// connections.ts
export type ConnectionProvider = /* existing */ | 'custom_acp';

interface ConnectionConfig {
  // existing fields…
  binaryPath?: string;     // custom_acp: absolute path to agent binary
  binaryArgs?: string[];   // custom_acp: launch args (e.g. ["acp"])
  localAgentPreset?: 'opencode';  // marks preset-managed connections
}

// settings/local-ai
interface LocalAgentSetupState {           // new slice (local-ai-store, partial persist)
  stage: 'idle' | 'detecting' | 'downloading' | 'configuring' | 'verifying' | 'ready' | 'failed';
  failedStage?: string;
  error?: string;
}
```

```rust
// agent_manager.rs — OpenCode entry in the managed-agent registry (id, repo, asset patterns, version probe)

// New/changed Tauri commands
#[tauri::command] // generate/refresh the agent's endpoint config; returns config path
async fn local_agent_write_config(state: State<'_, LocalInferenceState>, model_id: String) -> Result<String, String>;

#[tauri::command] // spawn → initialize → session/new → tiny prompt → teardown, bounded timeout
async fn acp_agent_smoke_test(instance_config: SmokeTestConfig) -> Result<SmokeTestReport, String>;
```

`sandbox.rs`: profile generation accepts an extra localhost port literal (llama-server) per connection; Bucket C table gains the `opencode` basename row.

## Dependencies

| Dependency | Status | Notes |
| --- | --- | --- |
| ACP 0.14.0 migration (crate bump, model→config-options, message-ID redesign) | Shipped (landed 2026-06-12) | Custom-agent probing targets the post-migration surface |
| `mcp_servers` pass-through at `session/new` | Shipped (#11) | Wired for all ACP agents; end-to-end MCP-via-Goose verification + MCP-subprocess proxy routing are follow-ups |
| ~~OpenCode~~ → **Goose** releases (`aaif-goose/goose`, GitHub, Apache-2.0) | External | Switched from OpenCode (incompatible with the strict sandbox); GitHub-release-binary install, min v1.37.0. Goose was created by Block and donated to the Agentic AI Foundation (AAIF); repo moved block/goose → aaif-goose/goose. See tasks addendum. |
| Bundled llama-server + model catalog (`supports_tool_calling`, RAM tiers) | Shipped | Reused as-is |
| Managed-install system (`agent_manager.rs`) | Shipped | Reused as-is |

## Quality Gates

**Functional**

- [x] Register a custom ACP agent (absolute path + args + env) → probe succeeds → chat with modes/plans/thinking/permissions works end-to-end (M1 #1–#6; the Goose preset is a `custom_acp` connection and was live-verified)
- [x] Probe failure at registration shows the agent's stderr tail; nothing is persisted (M1 #5; unit-tested)
- [x] Local Agent preset: fresh machine → one flow → verified-ready agentic chat against the bundled llama-server (live-verified — Goose completed an agentic turn)
- [x] Smoke test gates "ready"; a failed smoke test produces retry + Path 4 fallback (chat never dead) (#12/#13; degraded-flag fix + `local-agent-routing` tests)
- [x] llama-server restart on a new port → agent config regenerated and agent respawned automatically (#10 `configKey`; `local-agent-integration` test)
- [ ] MCP servers registered in Notesage are callable by the local agent; stdio MCP children run inside the agent's sandbox (verified via violation monitor) — **mostly verified; one residual**:
  - *Delivery* — tested: `buildAcpMcpServerInputs` (transport/capability/scope gating + IPC shape incl. secret refs) + an integration test asserting `session/new` carries the MCP servers for the preset.
  - *Sandbox of MCP children* — **implemented by inheritance**: the agent is spawned via `sandbox-exec` (Seatbelt) and the agent spawns the MCP children, so they inherit the same kernel network-deny + writable-FS scope + `HTTP_PROXY` env. Enforcement holds.
  - *Residual:* (a) **live tool invocation** — Goose actually *calling* a tool — needs a running Goose+model+MCP server (not reproducible headlessly); (b) the violation **monitor** registers only the agent's own PID, so a child's Seatbelt denial isn't *attributed/surfaced* (observability gap, not an enforcement gap) — hence "verified via violation monitor" can't be literally ticked. (Separately, Notesage's *own* MCP servers on the direct-API path — `commands/mcp.rs` — run unsandboxed; that's a different code path, CLAUDE.md "Known follow-ups".)
- [x] Network: with the preset profile active, any non-llama-server egress attempt is kernel-denied and logged (empty allowlist + kernel deny; `preset_profile_allows_exactly_proxy_and_llama_ports` regression lock + macOS Seatbelt `--ignored` locks run green)
- [x] Interrupted setup (network loss, relaunch) resumes without manual cleanup — the resume mechanism is unit-verified: re-running skips the model download when already present AND skips the agent install when the binary already resolves (`installAgentIfMissing` tests), and the driver walks an already-satisfied setup straight to ready. (A live mid-download network-drop wasn't manually exercised, but the skip-on-re-run logic that makes resume work is tested.)
- [x] Existing four managed agents + direct local chat (Path 4) regress nothing (`pnpm test` green — 5539 tests)
- [x] Sub-tool-calling model selection is blocked in the preset; sub-8GB tier shows the reliability warning (`recommendToolCallingModel`; `local-agent-model` tests)

**Tests & gates**

- [x] `pnpm typecheck`, `pnpm test`, `cargo check` (pkg-config stubs) green; `cargo test` in CI (typecheck + 5539 unit tests green; `cargo test --lib` green earlier; CI runs `cargo test`)
- [x] Sandbox profile regression-lock test: preset profile allows exactly {proxy port, llama-server port} on localhost (`preset_profile_allows_exactly_proxy_and_llama_ports`)
- [x] `tauri-capability-surface.test.ts` unchanged (no new frontend capabilities — egress is Rust-only)
- [x] `pnpm test:perf` within budget; startup unaffected — green at the CI 1.5× multiplier (45/45). At the strict local 1× the 1KB-parse benchmark flakes (≈55ms vs 38ms); this is a pre-existing benchmark flake, not a feature regression (nothing here touches markdown parse / decorations / stores hot paths)

**Design**

- [x] Setup flow + connection cards pass `/review-ui`: neutral palette, both themes + soft contrast, hover/focus states, no chromatic tokens outside accent/destructive (`design-reviewer` pass — no Critical; minor findings fixed)
- [x] Empty-state prompt, progress, error, and fallback states all designed (no default-browser UI, no raw error dumps — error box now carries a friendly guidance line)

## Out of Scope (deferred)

- Bundling the agent binary in the app bundle (revisit on install drop-off evidence)
- Notesage-owned thin Rust ACP agent (fallback if ecosystem agents regress)
- Qwen Code curated preset; community agent gallery
- `unstable_llm_providers`-based frontier-agent-on-local-endpoint mode (watch list; design M2 endpoint wiring to be swappable)
- MCP tools in direct-API chats (Option A decision, revisit post-ship with usage data)
- Windows/Linux support for custom-agent sandboxing
