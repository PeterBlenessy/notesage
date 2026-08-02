# Handoff — pi Local Agent preset

> **Temporary file. Delete before merge.** This is an onboarding brief for a
> local (macOS) agent to finish the last two items and verify the branch.
> Branch: `claude/pi-dev-goose-comparison-4cckof`.

## What this branch is

Adds **pi** ([earendil-works/pi](https://github.com/earendil-works/pi), MIT) as a
**second** Local Agent preset engine beside Goose — a fully-offline agentic chat
engine wired to the bundled llama-server, same one-click setup and same
kernel-enforced zero-network guarantee as Goose. Goose stays the default; the
setup dialog has an engine picker.

pi has **no ACP, no MCP, and no permission prompts** in its core — its embedding
surface is a JSONL RPC over stdio plus TypeScript extensions. So Notesage
supplies those layers itself; the rest of the ACP stack (session updates,
PermissionCards, segments, smoke test, session restore) is unchanged.

Canonical docs on the branch:
- PRD: `docs/prds/2026-07-29-pi-local-agent-preset.md`
- Tasks: `docs/tasks/2026-07-29-pi-local-agent-preset-tasks.md`
- Spike findings: `docs/research/2026-07-29-pi-spikes.md`
- Feature docs: `docs/features/ai-providers.md` (pi engine section)

## Architecture (three pieces)

1. **`notesage-pi-acp` bridge** (`bridges/pi-acp/`, in-repo TypeScript,
   Bun-compiled). Presents ACP (`@agentclientprotocol/sdk`) on its stdio and
   drives `pi --mode rpc` as a child in its own process group. Translates pi
   events → ACP session updates; maps ACP session/new·load·fork·prompt·cancel
   onto pi's `new_session`/`switch_session`/`clone`/`prompt`/`abort`; brokers
   `extension_ui_request` ↔ ACP `session/request_permission`.
   - Modules: `src/pi-process.ts` (child mgmt), `src/pi-rpc.ts` (correlation),
     `src/acp-server.ts` (ACP agent), `src/translate.ts` (events),
     `src/permissions.ts` (permission broker), `src/mcp-handoff.ts`, `src/usage.ts`,
     `src/index.ts` (`main()` wiring + CLI).
   - Spawned as: `notesage-pi-acp --pi-bin <pi> -- --provider local --model <id> --session-dir <dir>`
     (post-`--` args regenerated per endpoint so a model switch respawns).
2. **Two shipped pi extensions** (`bridges/pi-acp/extensions/`), embedded at
   compile time and (re)written into the flat `PI_CODING_AGENT_DIR`
   (`~/.notesage/agents/pi/`) on every config generation:
   - `permission-gate.ts` — blocks non-read-only tool calls behind `ctx.ui.select`
     (block-by-default with no UI). Stateless; tiered approvals stay in Notesage's
     `ScopedApproval` store.
   - `mcp-tools.ts` — reads stdio MCP configs from the `NOTESAGE_MCP_SERVERS` env
     (resolved keychain secrets ride the env, **never disk**), spawns each server
     under pi's sandbox, registers its tools.
3. **Config** — `local_agent_write_config(agent: 'pi')` (`src-tauri/src/commands/local_agent.rs`)
   writes `models.json` (dummy-key OpenAI-compatible provider at the live
   llama-server port), `settings.json`, and the two extensions; spawn env is
   `PI_OFFLINE=1` + `PI_CODING_AGENT_DIR` + `NO_PROXY`. Same `<port>:<modelId>`
   respawn key and the same empty-allowlist / kernel-deny / llama-port-allowed
   sandbox posture as Goose (zero Bucket C `$HOME` grants).

## Guiding decisions (do not re-litigate)

- **pi is a second engine, not a Goose replacement.** Goose stays default.
- **No protocol fork downstream.** Everything after `acp.rs` is unchanged; the
  bridge is the only component that knows pi's RPC exists. (Explicit non-goal: a
  native Rust pi-RPC path.)
- **First-party binaries get bundled; third-party binaries get downloaded.**
  This is the line that drives the OPEN pivot below. llama-server = bundled
  sidecar (`externalBin`). Goose / pi / the agent CLIs = managed downloads
  (`agent_manager.rs`). The bridge is **our code**, so it belongs on the bundled
  side — it was mistakenly set up as a managed download (see "Open item 1").
- **ACP sessionId = pi's session FILE PATH** (opaque, survives bridge restarts,
  exactly what `switch_session` wants). **ACP fork = pi `clone`** (duplicate the
  active branch), NOT pi's rewind-style `fork`.
- **Permission gate is stateless.** Tiered allow-always/session lives in
  Notesage's `ScopedApproval` store, which answers the ACP request without
  re-prompting; from pi's view every decision is one-shot.
- **MCP secrets never touch disk.** They ride the pi process env
  (`NOTESAGE_MCP_SERVERS`), asserted by test.
- **pi is pinned to an EXACT tested version (0.80.6).** pi ships multiple 0.x
  releases/week; installs clamp to the pin and newer upstream releases surface as
  "held back" until a Notesage release moves it. The bridge versions lockstep
  with the app.
- **Errors go to toasts + logs, never raw strings in UI components** (just fixed
  for the setup dialog; a broader codebase audit is an optional follow-up).

## Load-bearing spike findings (baked into the code; know them before editing)

From `docs/research/2026-07-29-pi-spikes.md`, verified against pi v0.80.6:
- **`PI_CODING_AGENT_DIR` layout is FLAT** — `models.json`, `settings.json`,
  `extensions/` sit directly under the dir (no `agent/` nesting when redirected).
- **pi's release tarball is a FOLDER** — `pi/pi` executable + co-located
  `photon_rs_bg.wasm` / `theme/` / `node_modules/`. The pi managed install
  extracts the whole tree and symlinks the binary (`ArchiveInstall::Tree`).
- **On macOS, pi HONORS `HTTP(S)_PROXY`** for the localhost llama call
  (contradicting an earlier Linux run). `NO_PROXY=localhost,127.0.0.1` is
  **REQUIRED**, not optional — without it the model call routes into Notesage's
  domain-filtering proxy and the turn stalls ~15s. `build_pi_env` sets it
  unconditionally; don't remove it.
- **Never `abort` while an `extension_ui_request` is outstanding** — it wedges
  pi. The deny/timeout path answers the UI request (`cancelled: true`) FIRST,
  then aborts. Enforced in `PermissionBroker.cancelAll()` + `PiAcpAgent.cancel`.
- `ctx.hasUI === true` in RPC mode (interactive gate path is live).

## Work already done (all pushed)

- **Spikes:** #1 (Bun-binary/RPC/extension parity) + #3 (permission round-trip)
  PASS on Linux; **#2 (zero-network under Seatbelt) PASS on macOS** (operator
  ran `scripts/spikes/pi-seatbelt-spike.sh`). Go/no-go = **GO**.
- **Bridge (#5–#12):** full package with orphan-proof process teardown, ACP
  handshake/sessions, event→session-update translation (incl. Diff content),
  permission broker, best-effort usage, Bun-compiled release binaries, and a
  compiled-binary ACP E2E test driven by a real `@agentclientprotocol/sdk`
  client. Opt-in real-pi tests gated on `PI_BINARY` / `BRIDGE_BINARY` env.
- **Extensions (#13–#14):** permission gate + MCP tools, verified live against
  real pi (allow executes / deny blocks; MCP tool discovered+called; no secret
  on disk).
- **Rust (#15–#17):** managed-install with per-agent checksum + exact-version
  pin; pi config variant; sandbox zero-Bucket-C regression lock.
- **Frontend (#18–#21):** `localAgentPreset: 'goose' | 'pi'`, per-engine setup
  flow, shadcn RadioGroup engine picker, connection-card "held back" state.
- **#23:** docs + Linux gate sweep (root vitest 6476/0, bridge tests, typecheck,
  cargo check, capability-surface lock).
- **Follow-up fixes:** workflow-lint compliance, root vitest excludes
  `bridges/**`, the NO_PROXY correction, and the setup-error toast/logging fix.

Current status lines are in the PRD and tasks-file headers. Everything is green
on Linux; the only things that can't run in a Linux/cloud session are the two
items below.

---

## OPEN ITEM 1 — bundle the bridge as a Tauri sidecar (the 404 fix)

**Why:** the bridge is downloaded from a Notesage GitHub release
(`agent_manager.rs` `github_binary_agent_config("notesage-pi-acp")`), but the
asset is only published by a tag-triggered release job — so on an unreleased
branch the install 404s (`notesage-pi-acp download returned 404`). The bridge is
our own code and should be a **bundled sidecar**, following the **llama-server**
precedent, not a managed download. This deletes the whole download / checksum /
publish-timing machinery for the bridge. **pi itself stays a managed download —
it's genuinely third-party.**

Steps:
1. **Provision script** — new `scripts/build-pi-acp-bridge.sh`, mirroring
   `scripts/download-llama-server.sh`'s output naming: `cd bridges/pi-acp && bun
   build --compile --target=bun-darwin-<arch>` → `src-tauri/binaries/notesage-pi-acp-<rust-triple>`
   (+ `chmod +x`). (The bridge's own `scripts/build-binaries.sh` already does the
   per-target compile — reuse/adapt it to emit into `src-tauri/binaries/`.)
2. **Bundle** — add `"binaries/notesage-pi-acp"` to `externalBin` in
   `src-tauri/tauri.conf.json` (Tauri appends the triple, like
   `binaries/llama-server`). Gitignore `src-tauri/binaries/notesage-pi-acp-*`.
3. **Runtime resolution** — add a Tauri command returning the bridge sidecar's
   absolute path, mirroring `resolve_bundled_sidecar` in
   `src-tauri/src/commands/model_providers/binary_resolution.rs` (next-to-exe in
   prod, dev source dir in dev).
4. **Remove the download path** — delete the `"notesage-pi-acp"` arm from
   `github_binary_agent_config` in `agent_manager.rs` (+ its checksum/pin bits
   that are bridge-specific) and delete the `build-bridge` job from
   `.github/workflows/release.yml`. Keep the pi arm + its checksum/pin.
5. **Setup flow** — in `src/hooks/useLocalAgentSetup.ts`, for the pi engine
   install **only** the `pi` binary via managed download; resolve the bridge via
   the new sidecar command instead of `agent_resolve_binary('notesage-pi-acp')`.
   (The bridge's stable spawn args stay `['--pi-bin', <pi>]`; the live post-`--`
   provider/model/session-dir args come from `LocalAgentConfig.piArgs`.)
6. **Docs** — update `docs/features/ai-providers.md` + PRD/tasks to say the
   bridge is a **bundled sidecar** (first-party) and pi stays a **managed
   download** (third-party). Remove the now-obsolete checksum-verification
   language for the bridge.

## OPEN ITEM 2 — #22 live end-to-end verification (macOS, in-app)

`pnpm tauri dev`, then in the Local Agent setup dialog pick the **pi** engine and
confirm:
- Setup completes with no 404 and no raw error text (errors now surface as a
  dismissable toast; check `log` output for detail if anything fails).
- A real agentic turn streams tokens.
- A PermissionCard appears for a write/execute tool; **allow** executes it,
  **deny** blocks it, and a 30s no-answer auto-denies — none wedge the session.
- One MCP stdio tool call works (if you have an MCP server configured).
- **No orphaned processes:** after Cmd-Q (and after just deleting the pi
  conversation), `pgrep -fl 'notesage-pi-acp|pi --mode rpc'` returns nothing.
- Goose preset still works (regression check).

Record the outcome in `docs/research/2026-07-29-pi-spikes.md` (or the tasks file
#22 line). Then this branch is ready for a PR.

## Gates before merge

`pnpm typecheck` · `pnpm test` · `cargo test` in `src-tauri/` · bridge tests
(`cd bridges/pi-acp && pnpm test`, plus the opt-in `PI_BINARY=<pi> BRIDGE_BINARY=<compiled bridge> pnpm test`) ·
`tauri-capability-surface.test.ts` unchanged. Conventions: Conventional-Commits,
workflow files use `actions/checkout@v6` and a `# TODO:` comment above any
`actions/upload-artifact@v4`.

## Optional follow-up (not blocking)

Audit the rest of the app for the same "raw backend error rendered inline in a
component" anti-pattern the setup dialog had, and convert those to
toast + `log.error`. Report findings first; don't mass-edit.

---
_Delete this file before opening the PR._
