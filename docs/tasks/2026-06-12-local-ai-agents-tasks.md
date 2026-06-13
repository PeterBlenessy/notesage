# Tasks: Local AI Agents — Offline Agentic Chat for Local Models

|  |  |
| --- | --- |
| **Date** | 2026-06-12 |
| **Status** | M1–M2 complete; M3 #15–#20 complete; #21 component tests done (Playwright E2E + /review-ui pending GUI); #22 docs done; #23 gates: typecheck/unit/cargo-check/capability-lock green, perf advisory (container timing), Playwright/cargo test on CI |
| **PRD** | [local-ai-agents](../prds/2026-06-12-local-ai-agents.md) |
| **Total** | 23 tasks: 6S, 13M, 4L |
| **Suggested order** | M1 Custom agents (#1–#6) → M2 Preset plumbing (#7–#14) → M3 Setup flow (#15–#21) → Docs & gates (#22–#23) |

**Prerequisite (external to this breakdown):** ✅ landed 2026-06-12 (commits da211e8, c212e67, 5e5621f) — the ACP 0.14.0 migration (P0 of the upgrade plan in [research](../research/2026-06-12-acp-0.14-landscape.md)) should land first so capability probing and model handling target the post-migration surface (config-options-based models). M1 works on 0.12.1 but would need re-touching.

**Risks / open questions**

- **OpenCode config isolation (#8):** the env-var/flag mechanism to point OpenCode at a Notesage-owned config file (so the user's own OpenCode setup is untouched) must be verified against the pinned OpenCode version before #8 is implemented. If no isolation mechanism exists, fall back to a dedicated `XDG_CONFIG_HOME`.
- **OpenCode config schema churn:** weekly release cadence means the generated config may need a version-pinned minimum + a compatibility check in `agent_check_updates`.
- **#11 (MCP pass-through) is shared infrastructure** with the broader ACP plan (task 10 there) and may land as its own PR ahead of this feature — coordinate to avoid double implementation. High blast radius: touches every ACP session creation path.
- **#9 (sandbox) has high blast radius** — shared Seatbelt profile generation; the regression-lock test is part of the task, not optional.
- **Smoke-test flakiness (#12):** first agent spawn on a cold llama-server can exceed naive timeouts; the budget must account for model load time (poll `/health` before spawning the agent).

---

## M1 — Custom ACP agent connections

### #1 — Accept absolute binary paths in ACP binary resolution ✅

**Description:** `acp_binary.rs` currently resolves known agent names (PATH, Homebrew, npm, bundled). Add a branch: an absolute path is used verbatim after validating existence + executable bit; return a precise error (`binary not found at <path>` / `not executable`) otherwise. Unit tests for both failure modes and the happy path.
**Complexity:** S **Category:** backend **Dependencies:** — **Files:** `src-tauri/src/commands/acp_binary.rs`

### #2 — Add `custom_acp` provider type and connection config fields ✅

**Description:** Extend `ConnectionProvider` with `'custom_acp'`; add `binaryPath`, `binaryArgs?: string[]`, `localAgentPreset?: 'opencode'` to `ConnectionConfig`; capabilities mapping `['interactive', 'agent_tasks']`; reuse existing `envVars` keychain storage for secrets. No UI yet. Typecheck-clean with exhaustive-switch sites updated.
**Complexity:** S **Category:** frontend **Dependencies:** — **Files:** `src/lib/ai/connections.ts`, `src/stores/connections-store.ts`

### #3 — Conservative sandbox defaults for unknown agent binaries ✅

**Description:** Verify (and regression-lock with a Rust test) that an unrecognized binary basename gets **no** Bucket C `$HOME` grants from `sandbox.rs`, an empty domain allowlist, and kernel network deny on by default — i.e. custom agents start maximally confined. Document the user opt-in path (existing writable-paths + allowlist UI) in code comments.
**Complexity:** S **Category:** backend **Dependencies:** — **Files:** `src-tauri/src/commands/sandbox.rs`

### #4 — Spawn + probe path for custom agents ✅

**Description:** `useAcpLifecycle` / `acp-agent-state` resolve `binaryPath` + `binaryArgs` for `custom_acp` connections through the same spawn pipeline as managed agents; registration-time capability probe (spawn → initialize → session → stop) runs unchanged and **blocks registration on failure with the agent's stderr tail** (mirror the `mcp_validate_server` error-mapping pattern). Verify no downstream code branches on the four known provider names; add regression tests where it does.
**Complexity:** M **Category:** both **Dependencies:** #1, #2 **Files:** `src/hooks/useAcpLifecycle.ts`, `src/lib/ai/acp-agent-state.ts`, `src-tauri/src/commands/acp.rs`

### #4b — Keychain-backed agent env-var secrets (unplanned, operator-requested) ✅

**Description:** Close the localStorage secret leak for `credentials.envVars` (EnvVar ACP auth — Gemini today, custom agents next): `connections-store` writes each value to the OS keychain (`notesage:<id>:env:<KEY>`), persist `partialize` strips values so only `envVarKeys` (names) reach localStorage, rehydrate migrates legacy plaintext, `removeConnection` deletes the entries. `acp_agent_spawn` gains `connection_id` + `env_var_keys` and resolves values from the keychain — authoritative over the in-memory IPC fallback, mirroring `resolve_api_key`. Also fixes the delegation spawn path (`useAgentTaskOperations`), which previously passed no env vars at all.
**Complexity:** M **Category:** both **Dependencies:** #2 **Files:** `src/stores/connections-store.ts`, `src/lib/ai/connections.ts`, `src/lib/ai/acp-agent-state.ts`, `src/lib/tauri.ts`, `src/hooks/useAgentTaskOperations.ts`, `src-tauri/src/commands/acp.rs`

### #5 — Add Connection UI: Custom Agent card + form ✅

**Description:** New card in the Add Connection flow: binary file-picker (native dialog), args input, env-var rows with secret toggle (keychain), probe-on-add with discovered capabilities preview on success / stderr tail on failure. Follow the MCP add-dialog field patterns; shadcn components; both themes; `TooltipProvider` where tooltips appear.
**Complexity:** M **Category:** frontend **Dependencies:** #2, #4 **Files:** `src/components/settings/ConnectionsSettings.tsx` (+ Add Connection components), `src/components/settings/ConnectionCard.tsx`

### #6 — M1 test pass ✅

**Description:** Unit tests: custom connection round-trips persistence without leaking secrets to localStorage; probe failure leaves no persisted connection; chat pipeline smoke against a scripted fake ACP agent (extend the existing ACP test harness/mocks in `useAcpLifecycle` tests). `pnpm typecheck` + `pnpm test` + `cargo check` green.
**Complexity:** M **Category:** both **Dependencies:** #4, #5 **Files:** `src/hooks/__tests__/useAcpLifecycle.test.ts`, `src/stores/__tests__/`

## M2 — Local Agent preset (plumbing)

### #7 — OpenCode entry in the managed-agent registry ✅

**Description:** Add OpenCode to `agent_manager.rs`: GitHub repo, darwin-arm64/x64 asset patterns (zip), version probe, install → `~/.notesage/bin/`, update/uninstall, quarantine handling, progress events — all via the existing machinery. Pin a minimum supported version.
**Complexity:** M **Category:** backend **Dependencies:** — **Files:** `src-tauri/src/commands/agent_manager.rs`

### #8 — `local_agent_write_config` command ✅

**Description:** Generate the OpenCode provider config: `baseURL` from the **live** llama-server port (`LocalInferenceState`; it's dynamic via `find_available_port`), model entries from the active catalog model, written to a Notesage-owned path; return the config path + the env/flag needed to launch OpenCode against it in isolation (verify mechanism — see risks). Unit tests: port substitution, model mapping, regeneration idempotency.
**Complexity:** M **Category:** backend **Dependencies:** #7 **Files:** `src-tauri/src/commands/agent_manager.rs` or new `local_agent.rs`, `src-tauri/src/commands/local_inference.rs` (port accessor)

### #9 — Seatbelt: llama-server port allow + OpenCode Bucket C row ⚠️ shared infra ✅

**Description:** Profile generation accepts an extra localhost-port literal per connection (the llama-server port) alongside the proxy port; add the `opencode` basename row to the Bucket C table (its own config/cache dirs — confirmed via sandbox violation monitoring during implementation, not guessed). **Regression-lock test:** the preset profile allows exactly {proxy port, llama-server port} on localhost and nothing else.
**Complexity:** M **Category:** backend **Dependencies:** #8 **Files:** `src-tauri/src/commands/sandbox.rs`

### #10 — Respawn agent on endpoint-config change ✅

**Description:** Include a config key (llama-server port + active model id) in the agent respawn trigger, mirroring the `sandboxScopeKey` pattern in `acp-agent-state.ts` — server restart on a new port regenerates the config (#8) and respawns the agent transparently. Test: simulated port change → respawn observed, conversation session restored via the existing restore chain.
**Complexity:** M **Category:** frontend **Dependencies:** #8 **Files:** `src/lib/ai/acp-agent-state.ts`, `src/hooks/useAcpLifecycle.ts`

### #11 — Pass `mcp_servers` at session/new ⚠️ shared infra (= upgrade-plan task 10) ✅

**Description:** Assemble enabled, scope-matching MCP servers (`{global, byProject}` × selected projects) into `McpServerStdio` configs (keychain env secrets resolved at spawn, never through IPC in plaintext beyond the existing spawn path), gate on the agent's advertised `McpCapabilities`, attach to `NewSessionRequest` (and the resume/load paths where applicable). Applies to **all** ACP agents, not just the preset. Tests: scope filtering, secret resolution, capability gating, absent-field back-compat.
**Complexity:** L **Category:** both **Dependencies:** #4 **Files:** `src-tauri/src/commands/acp.rs`, `src/hooks/useAcpLifecycle.ts`, `src/stores/mcp-store.ts`

### #12 — `acp_agent_smoke_test` command ✅

**Description:** Bounded verification: ensure llama-server `/health` is green → spawn agent → `initialize` → `session/new` → one-token prompt → teardown; return `SmokeTestReport { ok, stage, error?, elapsedMs }`. Timeout budget accounts for cold model load. Rust tests with a scripted fake agent binary.
**Complexity:** M **Category:** backend **Dependencies:** #4 **Files:** `src-tauri/src/commands/acp.rs` or new module

### #13 — Routing default + Path 4 fallback ✅

**Description:** When the preset connection exists and is healthy, the Local AI interactive slot routes to the agent (agentic chat default). If the binary is missing, spawn fails, or the last smoke test failed → route to the existing direct local chat (Path 4) and set a `degraded` flag for UI (#20). Chat must never dead-end. Tests for each fallback trigger.
**Complexity:** M **Category:** frontend **Dependencies:** #10, #12 **Files:** `src/stores/routing-store.ts`, `src/hooks/useAIOperations.ts`, `src/stores/local-ai-store.ts`

### #14 — M2 integration test pass ✅

**Description:** End-to-end (mocked IPC): preset connection → session with MCP configs attached → tool-call permission flow unchanged → fallback path on simulated spawn failure. `cargo test` additions for #8/#9/#12 land with their tasks; this task is the cross-cutting integration sweep + coverage check.
**Complexity:** M **Category:** both **Dependencies:** #9, #11, #13 **Files:** `src/hooks/__tests__/`, `e2e/tests/`

## M3 — Setup flow + entry points

### #15 — `LocalAgentSetupState` store slice ✅

**Description:** Stage machine (`idle → detecting → downloading → configuring → verifying → ready | failed(stage, error)`) in `local-ai-store`, persisted enough to resume an interrupted flow after relaunch (persist stage + chosen model id; never persist transient errors). Selector for the degraded/fallback notice.
**Complexity:** S **Category:** frontend **Dependencies:** — **Files:** `src/stores/local-ai-store.ts`

### #16 — Setup orchestrator hook (`useLocalAgentSetup`) ✅

**Description:** Drives the staged flow: RAM-tier detection → recommend `supports_tool_calling` model (reuse hardware-aware recommendation logic) → **parallel** agent install (#7) + model download (existing pipeline) with cancel + resume-on-reconnect → `local_agent_write_config` (#8) → connection creation (#2) + routing (#13) → smoke test (#12) → ready/failed. Surfaces progress as `activity-store` entries (orb visibility); editor remains usable throughout. Tests: stage transitions, resume after simulated relaunch, partial-failure → Path 4 fallback.
**Complexity:** L **Category:** frontend **Dependencies:** #7, #8, #12, #13, #15 **Files:** new `src/hooks/useLocalAgentSetup.ts`, `src/stores/activity-store.ts`

### #17 — Setup flow dialog UI ✅

**Description:** Dialog with stage list (pending/active/done/failed per stage), one progress bar per active download, model picker filtered to `supports_tool_calling` with RAM-tier default + sub-8GB reliability warning, inline error + Retry on failure, background-continue on dismiss. Design-system compliant (neutral palette, both themes + soft contrast, skeletons for catalog load, no raw error dumps).
**Complexity:** L **Category:** frontend **Dependencies:** #16 **Files:** new `src/components/settings/LocalAgentSetupDialog.tsx`

### #18 — Entry point: command-bar empty state ✅

**Description:** When no AI connection exists, the stream's existing empty-state onboarding prompts include "Set up private, offline AI →" which opens #17. Disappears once any connection exists.
**Complexity:** S **Category:** frontend **Dependencies:** #17 **Files:** `src/components/cmd/CommandBarStream.tsx`

### #19 — Entry point: Local Agent card in Add Connection ✅

**Description:** Preset card (primary treatment, lucide shield/offline iconography, strokeWidth 1.5) launching #17; shows installed/ready state when the preset already exists instead of re-offering setup.
**Complexity:** S **Category:** frontend **Dependencies:** #17 **Files:** Add Connection components, `src/components/settings/ConnectionCard.tsx`

### #20 — Offline badge + degraded-fallback notice in cmd-bar header ✅

**Description:** Provider pill gains an "Offline" badge variant when the active connection is the preset (empty allowlist enforced); a one-line muted notice with a "Fix" action (reopens #17 at the failed stage) renders in the context row when routing degraded to Path 4. No toast storms.
**Complexity:** M **Category:** frontend **Dependencies:** #13, #17 **Files:** `src/components/cmd/CommandBarContext.tsx`

### #21 — M3 test pass

**Description:** Component tests for #17–#20 states (loading/error/ready/degraded, both themes); Playwright E2E happy path with mocked IPC (choose preset → downloads complete → ready → send a message). Run `/review-ui` on the new surfaces.
**Complexity:** M **Category:** frontend **Dependencies:** #17, #18, #19, #20 **Files:** `src/components/**/__tests__/`, `e2e/tests/`

## Docs & gates

### #22 — Documentation updates ✅

**Description:** `docs/features/ai-providers.md` (custom ACP agent connections; Local Agent preset as a fifth flavor of Path 2; MCP pass-through reality), `docs/architecture.md` (store table: `LocalAgentSetupState`; command inventory: new commands; isolation table: MCP-via-agent sandbox inheritance), `docs/product-description.md` roadmap entry. Use the "command bar header" terminology (not "chat footer").
**Complexity:** M **Category:** — **Dependencies:** #14, #21 **Files:** `docs/features/ai-providers.md`, `docs/architecture.md`, `docs/product-description.md`

### #23 — Quality gates sweep

**Description:** Full PRD quality-gates checklist: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `cargo check` (stubs) locally + `cargo test` in CI, `pnpm test:perf` within budget (startup untouched — setup work is lazy), `pnpm coverage:check`, `tauri-capability-surface.test.ts` unchanged, sandbox regression-lock test green. Record any perf deltas per CLAUDE.md performance-tracking rules.
**Complexity:** S **Category:** both **Dependencies:** #22 **Files:** —
