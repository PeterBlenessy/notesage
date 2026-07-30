# Tasks: pi Local Agent Preset — ACP Bridge + Extensions

|  |  |
| --- | --- |
| **Date** | 2026-07-29 |
| **Status** | Not started |
| **PRD** | [pi-local-agent-preset](../prds/2026-07-29-pi-local-agent-preset.md) |
| **Total** | 23 tasks: 5S, 12M, 6L |
| **Suggested order** | M0 spikes (#1–#4, hard gate) → Bridge (#5–#12) → Extensions (#13–#14) → Backend integration (#15–#17) → State (#18–#19) → UI (#20–#21) → Verification & docs (#22–#23) |

**Risks / open questions**

- **#1–#4 are a HARD GATE — amended 2026-07-30.** Spikes #1/#3 PASSED and #2's Linux-observable half all points to pass, so the operator authorized proceeding with M1+ **at-risk** while #2's macOS execution is pending. The gate moves from build-blocker to **merge-blocker**: #2's recorded Seatbelt run (and #4's go/no-go) remain required before #22 and before any merge. A late #2 failure still stops the initiative (sunk build cost accepted).
- **pi 0.x churn:** every task that touches pi behavior must record the exact pi version it was verified against; the pin range in #15 is derived from those records, not guessed.
- **#9 (permission translation) is the trickiest correctness surface** — a wedged `extension_ui_request` blocks the tool call forever. The abort path verified in spike #3 is the safety net; #9's tests must cover deny, timeout-abort, and mid-request session cancel.
- **#15/#17 touch shared infrastructure** (`agent_manager.rs` GitHub-binary path, `sandbox.rs` profile generation) — regression locks are part of the task, not optional; Goose suites must stay green.
- **MCP side-channel decision (#14):** bridge → extension config transport (env var vs RPC side-channel) is decided during #14 against the pinned pi version; the non-negotiable is asserted by test — no secrets on disk.
- **Seatbelt-dependent tasks (#2, #22) cannot execute in a Linux agent session.** Split per the repo's existing convention (cf. `cargo check` stubs locally vs `cargo test` on macOS CI, and Goose's "live macOS run" gate): the agent session **authors** a self-contained harness (script + profile + assertions); **execution** happens on a GitHub Actions `macos` runner where possible, or the operator's Mac for the full live run. A Seatbelt task is not "done" until the macOS run's output is recorded.

---

## M0 — De-risking spikes (hard gate)

### #1 — Spike: Bun-binary parity (RPC + extension loading) ✅

**Description:** Download `pi-darwin-arm64.tar.gz` from a pinned `earendil-works/pi` release, verify against `SHA256SUMS`, extract (archive is a *folder*: executable + wasm + native bindings + themes — note co-location requirements). Confirm the Bun-compiled binary (a) runs `--mode rpc` with correct LF-delimited JSONL framing for `new_session`/`prompt`/`abort`, and (b) loads a trivial TypeScript extension from `PI_CODING_AGENT_DIR/extensions/` identically to the npm build. Record the tested pi version. Acceptance: written finding (pass/fail + caveats) for the research doc (#4).
**Complexity:** M **Category:** backend **Dependencies:** — **Files:** `docs/research/2026-07-29-pi-spikes.md` (section)
**Result (2026-07-29, pi v0.80.6 linux-x64):** PASS — checksum verify, folder-tarball, RPC framing, TS extension loading, dummy-key custom provider all confirmed live. Key correction: `PI_CODING_AGENT_DIR` layout is FLAT (no `agent/` nesting); pi also probes `GET /v1/models` on the baseUrl. See research doc.

### #2 — Spike: zero-network under Seatbelt with PI_OFFLINE=1 ⚠️ macOS-executed

**Description:** Two halves. **(a) Author (agent session, any OS):** a self-contained harness — script that downloads/verifies the pinned pi binary, generates a deny-all-network Seatbelt profile with a single localhost port allow (reuse the Goose profile shape), starts a **stub OpenAI-compatible server** on that port (no llama-server / no model needed — confinement is about sockets, not inference), runs a prompt turn via `sandbox-exec`, and asserts: turn completes, zero non-localhost connection attempts (capture via profile violations / `log stream`), no hang or spawn-time delay from blocked version-check/telemetry. Include variants: with `HTTP_PROXY`/`HTTPS_PROXY` set (does undici route the localhost call into the proxy?), and with the `NO_PROXY=localhost,127.0.0.1` / env-strip mitigation. **(b) Execute (macOS):** run on a GitHub Actions `macos` runner (preferred — wire as a manually-dispatched workflow) or the operator's Mac; record output. Optional follow-up on the operator's Mac: one pass against the real bundled llama-server. Acceptance: recorded macOS run + the exact spawn-env recipe #16 will use.
**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:** `scripts/spikes/pi-seatbelt-spike.sh`, `.github/workflows/spike-pi-seatbelt.yml`, `docs/research/2026-07-29-pi-spikes.md` (section)
**Status (2026-07-29):** 🚧 authoring half DONE (harness + workflow committed; driver/stub validated unsandboxed on Linux). Proxy question pre-answered on Linux: pi ignores `HTTP(S)_PROXY` entirely — `NO_PROXY` demoted to defense-in-depth. **Remaining: dispatch the `spike-pi-seatbelt` workflow on macOS (or run the script on a Mac) and record output in the research doc.**

### #3 — Spike: extension_ui_request permission round-trip ✅

**Description:** Minimal blocking `tool_call` extension raising `ctx.ui.confirm`. Confirm in `--mode rpc`: the `extension_ui_request` event surfaces on stdout while the tool is blocked; a delayed `extension_ui_response` resumes/blocks correctly; a never-answered request can be terminated via `abort` without wedging the session (the 30s auto-deny prerequisite). Acceptance: finding + event-shape transcript for #9/#13.
**Complexity:** M **Category:** backend **Dependencies:** #1 **Files:** `docs/research/2026-07-29-pi-spikes.md` (section)
**Result (2026-07-29, pi v0.80.6 linux-x64):** PASS with load-bearing caveat — allow/deny/cancel round-trips verified (`ctx.hasUI === true` in RPC mode); **`abort` with an unanswered UI request WEDGES the session**. #9's deny/timeout path MUST answer the request (`extension_ui_response {cancelled:true}`) before any abort. See research doc.

### #4 — Consolidate spike findings + go/no-go

**Description:** Assemble `docs/research/2026-07-29-pi-spikes.md` (standard research-doc header + pipeline table linking PRD and this tasks file), record the pinned pi version and go/no-go per spike, update the PRD Status row. On any no-go: stop, document, close out the tasks file as Abandoned.
**Complexity:** S **Category:** both **Dependencies:** #1, #2, #3 **Files:** `docs/research/2026-07-29-pi-spikes.md`, `docs/prds/2026-07-29-pi-local-agent-preset.md`

## M1 — `notesage-pi-acp` bridge

### #5 — Scaffold `bridges/pi-acp` package ✅

**Description:** New in-repo TypeScript package: strict tsconfig, vitest suite wiring, `bun build --compile` script per platform (darwin arm64/x64, linux arm64/x64), lint hooked into repo scripts. CI job runs the package tests. Acceptance: `pnpm --filter pi-acp test` green on a hello-world module; compiled binary starts and exits cleanly.
**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:** `bridges/pi-acp/package.json`, `bridges/pi-acp/tsconfig.json`, `bridges/pi-acp/src/index.ts`, `.github/workflows/test.yml`

### #6 — Bridge: pi child-process management ✅

**Description:** Spawn `pi --mode rpc` in its own process group with the caller-supplied env; LF-delimited JSONL encoder/decoder with request-id correlation; awaited teardown (SIGTERM → grace → SIGKILL process group) on ACP transport close or signal so `kill_on_drop` on the bridge can never orphan pi. Unit tests against a scripted fake pi (a small stdio stub replaying golden JSONL). Acceptance: no orphan after abrupt parent kill (test asserts via process-group probe).
**Complexity:** L **Category:** frontend **Dependencies:** #5 **Files:** `bridges/pi-acp/src/pi-process.ts`, `bridges/pi-acp/src/jsonl.ts`, `bridges/pi-acp/test/fake-pi.ts`

### #7 — Bridge: ACP handshake + session lifecycle ✅ (via official @agentclientprotocol/sdk 1.3.0; sessionId = pi sessionFile path; ACP fork → pi clone)

**Description:** ACP agent-side JSON-RPC on the bridge's stdio: `initialize` (static capabilities: `sessions: { load, fork }`, `mcp.stdio`, `promptCapabilities.images`), `session/new` → `new_session` (cwd), `session/load` → `switch_session`, `session/fork` → `fork`, `session/cancel` → `abort`. Match the ACP 0.14.0 surface `acp.rs` speaks. Golden-transcript tests with the fake pi.
**Complexity:** L **Category:** frontend **Dependencies:** #6 **Files:** `bridges/pi-acp/src/acp-server.ts`, `bridges/pi-acp/src/sessions.ts`

### #8 — Bridge: streaming + tool-call translation ✅

**Description:** `message_update` `text_delta`/`thinking_delta` → `agent_message_chunk`/`agent_thought_chunk`; `tool_execution_start/update/end` → `tool_call`/`tool_call_update` with status mapping, `formatToolLabel`-compatible kinds, and structured edit results (path/oldText/newText) emitted as ACP `Diff` content so `DiffContentView` renders natively. `prompt` carries image attachments. Tests: golden fixtures per segment type.
**Complexity:** L **Category:** frontend **Dependencies:** #7 **Files:** `bridges/pi-acp/src/translate.ts`, `bridges/pi-acp/test/fixtures/`

### #9 — Bridge: permission translation ⚠️ correctness-critical ✅ (deny/timeout answers the UI request before any abort per spike #3; safety timeout for a hung ACP client; unknown UI requests fail-safe cancelled)

**Description:** Intercept `extension_ui_request` from the permission-gate extension → ACP `session/request_permission` with the standard tiered options; map the ACP outcome back to `extension_ui_response`. Handle: deny, allow variants, ACP-side timeout/auto-deny → respond deny + (if the turn is wedged) `abort`, and session cancel racing an open request. Tests cover all four paths against the fake pi using the spike-#3 event shapes.
**Complexity:** L **Category:** frontend **Dependencies:** #7, #13 **Files:** `bridges/pi-acp/src/permissions.ts`

### #10 — Bridge: usage reporting (best-effort) ✅ (pi contextUsage → ACP usage_update {used,size,cost})

**Description:** After `agent_end`, call `get_session_stats` and emit ACP `usage_update` (tokens; cost omitted for local). Degrade silently on missing/changed stats shape — never fail a turn over usage. Test: stats present and absent.
**Complexity:** S **Category:** frontend **Dependencies:** #7 **Files:** `bridges/pi-acp/src/usage.ts`

### #11 — Bridge: live integration test against real pi ✅ (PI_BINARY-gated suite + BRIDGE_BINARY-gated compiled-binary E2E: ACP client over stdio → Bun binary → real pi → stub LLM, incl. gated write, MCP, usage, teardown. Caught the missing --provider/--model passthrough — bridge CLI now takes `-- <pi args>`)

**Description:** Opt-in integration suite (skipped unless `PI_BINARY` env set, mirroring the perf/real-e2e opt-in pattern): real pi binary + a mock OpenAI-compatible HTTP server; drive initialize → session/new → prompt → tool call with permission → response end-to-end through the bridge. This is the churn tripwire re-run whenever the pi pin moves.
**Complexity:** M **Category:** frontend **Dependencies:** #8, #9, #10 **Files:** `bridges/pi-acp/test/integration.test.ts`, `bridges/pi-acp/test/mock-openai.ts`

### #12 — Release CI: compile + publish bridge binaries ✅ (bun-compiled linux-x64 binary verified locally: 38 MB single file, --version OK; checksum asset scoped as `notesage-pi-acp-SHA256SUMS` — #15 must configure that exact name)

**Description:** Release workflow job: `bun build --compile` per platform, tarball each (`notesage-pi-acp-{triple}.tar.gz`), generate `SHA256SUMS`, attach to the Notesage GitHub release. Version = app version (lockstep per PRD). Acceptance: dry-run workflow produces all four assets + checksum file.
**Complexity:** M **Category:** backend **Dependencies:** #5 **Files:** `.github/workflows/release.yml`, `bridges/pi-acp/scripts/build-binaries.sh`

## M2 — pi extensions (shipped by Notesage)

### #13 — Permission-gate extension ✅ (verified live inside real pi v0.80.6: allow executes, deny blocks, no-UI blocks by default)

**Description:** TypeScript pi extension: blocking `pi.on("tool_call", …)` for write/execute tools (read-only tools pass through, mirroring the direct-API auto-allow split) → `ctx.ui.confirm` with tool name + args summary; handler errors block fail-safe. Stateless — tiered "always/session" approval is answered Notesage-side via `ScopedApproval`. Embedded as a build asset; unit-tested in the bridge package's harness with the spike-#3 shapes.
**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:** `bridges/pi-acp/extensions/permission-gate.ts`

### #14 — MCP tools extension ✅ (env-only handoff `NOTESAGE_MCP_SERVERS`; no-secrets-on-disk asserted by test; verified live in real pi with a fake MCP stdio server through the permission gate)

**Description:** TypeScript pi extension registering the session's MCP servers' tools with pi and proxying calls (stdio servers spawned by the extension inherit pi's sandbox). Server configs — keychain secrets already resolved by `build_acp_mcp_servers` — reach the extension from the bridge via the transport decided here (env var JSON vs RPC side-channel, evaluated against the pinned pi version). **Hard requirement asserted by test: no secret ever written to disk** (scan the generated config tree after a session). Bridge consumes ACP `session/new` `mcp_servers` unchanged.
**Complexity:** L **Category:** frontend **Dependencies:** #7, #13 **Files:** `bridges/pi-acp/extensions/mcp-tools.ts`, `bridges/pi-acp/src/mcp-handoff.ts`

## M3 — Backend integration

### #15 — Managed-install registry: pi + bridge entries, checksum + version ceiling ⚠️ shared infra ✅ (per-agent checksum_asset — hard verify for pi/bridge, Goose stays record-only; exact pin 0.80.6 with install clamp + held_back in check_updates; folder-tarball Tree install with tar-slip/total-size guards + symlinked bin; cargo check green, unit tests run in macOS CI)

**Description:** `agent_manager.rs`: make the checksum asset per-agent (`GithubBinaryAgentConfig.checksum_asset: Option<&'static str>`; pi/bridge `Some("SHA256SUMS")` → hard-fail verify before extraction, Goose stays `None` digest-record-only) and add `max_version: Option<&'static str>` enforced in install AND `agent_check_updates` ("held back" state). Registry entries for `pi` (`earendil-works/pi`, folder-tarball extraction — multiple files co-located, unlike Goose's single binary) and `notesage-pi-acp` (Notesage releases). Lock tests mirroring `goose_installs_via_github_binary`: repo, asset names per platform, checksum asset, pin range, tamper → explicit failure. Goose install tests stay green.
**Complexity:** L **Category:** backend **Dependencies:** #4, #12 **Files:** `src-tauri/src/commands/agent_manager.rs`

### #16 — `local_agent_write_config` pi variant ✅ (flat layout per spike #1; extensions embedded via include_str! from the bridge package; env per spike #2 recipe incl. NO_PROXY defense-in-depth; piArgs returned for the bridge `--` passthrough)

**Description:** Add the `agent: Option<String>` discriminator (`None` → goose, back-compat). pi variant writes under `~/.notesage/agents/pi/`: `agent/models.json` (provider `local`, `baseUrl: http://localhost:<port>/v1`, `api: "openai-completions"`, dummy key, active catalog model), `agent/settings.json` (`enableInstallTelemetry: false`, skill paths → Notesage skill dirs), both extensions from embedded assets (`include_str!`). Returned env per spike-#2 recipe: `PI_OFFLINE=1`, `PI_CODING_AGENT_DIR`, `NO_PROXY` as validated. Same `<port>:<modelId>` config key. Unit tests mirror the Goose suite: port/model substitution, isolation under the notesage subtree, telemetry off, extension files present, regeneration idempotent.
**Complexity:** M **Category:** backend **Dependencies:** #4, #13, #14 **Files:** `src-tauri/src/commands/local_agent.rs`

### #17 — Sandbox regression-lock for the pi preset ⚠️ shared infra ✅ (zero Bucket C grants for `pi`/`notesage-pi-acp` basenames locked by test; exact-{proxy, llama} port lock already agent-agnostic; sandbox.rs production code unchanged as predicted)

**Description:** Extend the Seatbelt tests: the pi-preset profile allows exactly {proxy port, llama-server port} on localhost and nothing else; the whole pi footprint resolves under the `.notesage` write-allow (no new Bucket C rows). Reuse/extend the Goose regression-lock rather than duplicating. `sandbox.rs` changes expected to be nil-to-minimal — the test IS the deliverable.
**Complexity:** S **Category:** backend **Dependencies:** #16 **Files:** `src-tauri/src/commands/sandbox.rs` (tests)

## State management

### #18 — Types + connection model

**Description:** Widen `localAgentPreset` to `'goose' | 'pi'` across `connections.ts` and comparison sites; `LocalAgentConfig` TS type gains `agent` + `bridgePath`; `tauriApi.localAgentWriteConfig(agent?)`. Verify persist rehydration of existing `'goose'` connections is untouched (no migration needed — additive union). `pnpm typecheck` gate.
**Complexity:** S **Category:** frontend **Dependencies:** #16 **Files:** `src/lib/ai/connections.ts`, `src/lib/tauri.ts`, `src/stores/connections-store.ts`

### #19 — pi setup-flow deps for `runLocalAgentSetup`

**Description:** Supply pi-flavored `LocalAgentSetupDeps`: `installAgent` installs pi + bridge (both via `installAgentIfMissing` semantics), `writeConfig` passes `agent: 'pi'`, `createPresetConnection` builds the `custom_acp` connection with `binaryPath` = bridge binary, `binaryArgs: []`, `localAgentPreset: 'pi'`, empty network allowlist + kernel deny + llama port (mirroring the Goose connection shape in `acp-agent-state.ts`). The driver, rollback gate, and smoke test are reused unchanged — add unit tests for the pi deps only.
**Complexity:** M **Category:** frontend **Dependencies:** #15, #18 **Files:** `src/hooks/useLocalAgentSetup.ts`, `src/lib/ai/acp-agent-state.ts`

## UI

### #20 — Engine choice in the Local Agent setup entry points

**Description:** Add-Connection Local Agent card + `LocalAgentSetupDialog` gain an engine selector (Goose default, pi alternative) using shadcn primitives (survey `RadioGroup` / segmented `Tabs` first per design system), one-line description + attribution per engine ("powered by pi, an open-source agent by Mario Zechner / earendil-works" mirroring the Goose attribution). Strict-neutral palette, both themes, `TooltipProvider` where tooltips appear. Stage/progress/error/retry UI shared unchanged.
**Complexity:** M **Category:** frontend **Dependencies:** #19 **Files:** `src/components/settings/LocalAgentSetupDialog.tsx`, Add-Connection card component

### #21 — Settings connection card: engine + version + held-back state

**Description:** Connection card for a `localAgentPreset` connection shows the engine name and installed agent/bridge versions; when `agent_check_updates` reports an upstream version outside the tested range, render a muted "update held back (untested)" line — informational, not an error. Both themes.
**Complexity:** S **Category:** frontend **Dependencies:** #15, #18 **Files:** `src/components/settings/ConnectionsSettings.tsx` (or per-card component)

## Verification & docs

### #22 — End-to-end verification on real macOS Seatbelt ⚠️ macOS-executed

**Description:** The PRD's live gates, one pass. **Author (agent session):** a step-by-step runbook + as much automation as ports to macOS CI (the real-Seatbelt `#[ignore]` cargo tests extended for the pi profile run there; the interactive app flow does not). **Execute (operator's Mac, mirroring Goose's live-run gate):** staged setup → smoke test green under real Seatbelt; permission flow (allow / deny / 30s timeout) through PermissionCard without wedging; one MCP stdio tool call; teardown leaves no orphaned pi/bridge process (app exit + conversation close); Goose preset re-verified unaffected. Record results in this file; append perf notes per CLAUDE.md if startup paths were touched (expected: none — setup stays lazy). Not "done" until the operator run is recorded.
**Complexity:** L **Category:** both **Dependencies:** #9, #11, #17, #19, #20 **Files:** `docs/tasks/2026-07-29-pi-local-agent-preset-tasks.md` (runbook + results)

### #23 — Docs + quality-gates sweep

**Description:** Update `docs/features/ai-providers.md` (Local Agent preset section: two engines, bridge architecture, extension model), `docs/architecture.md` (bridges/ dir, new registry fields), `docs/prds/2026-07-29-pi-local-agent-preset.md` status. Full gates: `pnpm typecheck`, `pnpm test`, bridge tests, `pnpm test:e2e`, `cargo check` (stubs) + CI `cargo test`, `pnpm coverage:check`, `tauri-capability-surface.test.ts` unchanged, sandbox locks green.
**Complexity:** M **Category:** both **Dependencies:** #22 **Files:** `docs/features/ai-providers.md`, `docs/architecture.md`, PRD
