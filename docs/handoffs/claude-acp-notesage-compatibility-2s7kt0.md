# Handoff — Local AI Agents (PR #458)

| | |
| --- | --- |
| **Branch** | `claude/acp-notesage-compatibility-2s7kt0` |
| **PR** | [#458](https://github.com/PeterBlenessy/notesage/pull/458) (base: `main`, currently *behind*) |
| **Feature** | Local AI Agents — offline agentic chat for local models |
| **Task breakdown** | `docs/tasks/2026-06-12-local-ai-agents-tasks.md` (per-task ✅ status is authoritative) |
| **PRD** | `docs/prds/2026-06-12-local-ai-agents.md` |
| **Date** | 2026-06-13 |
| **Why this handoff** | The remaining work is GUI- and macOS-only (Seatbelt, real OpenCode binary, visual review) — it cannot be done in the Linux cloud container where the work so far was built. |

## State of play

All of M1 (#1–#6, done before this session) plus **M2 (#7–#14)**, **M3 #15–#20**, **#21 component tests**, and **#22 docs** are committed and pushed. The branch is in sync with its remote.

Verified green in the headless container:
- `pnpm typecheck`, `pnpm test` (5522 unit tests), `cargo check --tests` (via pkg-config stubs), `src/lib/__tests__/tauri-capability-surface.test.ts` (capability lock unchanged).

Session commits (range `73a6df8..HEAD`): one per task #10–#16, then the M3 UI batch, then docs. `git log --oneline 73a6df8..HEAD` for the list and per-commit rationale — **do not restate; read the commit messages**.

## What is actually left (your laptop)

Tackle in this order — item 1 is where the real unknowns are.

### 1. Real runtime verification (macOS-only — highest risk)
Two `VERIFY ON MACOS` markers must be confirmed against the **actual OpenCode binary**; grep for them:
- `src-tauri/src/commands/local_agent.rs:79` (`isolation_env()`) — which env var OpenCode honors to isolate its config tree. Currently sets `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_CACHE_HOME` + `OPENCODE_CONFIG` belt-and-suspenders. Confirm OpenCode doesn't instead use native `~/Library/Application Support/opencode`; if it does, fix `isolation_env()` **and** the Bucket C grant.
- `src-tauri/src/commands/sandbox.rs:102` — the `opencode` Bucket C config/cache dir grant; confirm the real dir names via sandbox violation monitoring (Activity panel).

Then run the end-to-end flow in `pnpm tauri dev`: Add Connection → **Local Agent** card → setup dialog → install OpenCode → bundled llama-server starts → smoke test passes → send one agentic chat turn and confirm a tool call round-trips under Seatbelt + the network sandbox (proxy + llama port only). Watch the Activity panel for Seatbelt denials.

### 2. `/review-ui` + visual pass (finishes #21)
New surfaces, untouched by design review — check light/dark + soft contrast:
- `src/components/settings/LocalAgentSetupDialog.tsx` (stage checklist, model picker, sub-8GB warning, error+Retry, Continue-in-background)
- Add-Connection "Local Agent" card in `src/components/settings/ConnectionsSettings.tsx`
- empty-state "Set up private, offline AI →" in `src/components/chat/ChatMessageList.tsx`
- Offline badge + degraded "Fix" pill in `src/components/cmd/CommandBarContext.tsx`

### 3. Finish #21 tests
- Playwright E2E happy path (mocked IPC) for the setup flow — `e2e/tests/`. Component tests already exist: `src/components/settings/__tests__/LocalAgentSetupDialog.test.tsx`.
- `cd src-tauri && cargo test` (links real GTK/WebKit — only works on the Mac; covers the smoke-test, MCP-build, and sandbox regression-lock Rust tests added this session).

### 4. #23 gate close-out
- `pnpm test:perf` — failed in-container purely on **timing** (an untouched baseline benchmark, markdown parse, overran by the same ~2×). Re-run on the Mac; CI runs it advisory at 1.5×. Record a dated entry in `docs/performance-baseline.md` if you capture real numbers.
- `pnpm coverage:check` (warning-only).

### 5. Rebase
PR is behind `main` — `git pull --rebase origin main` on the laptop where conflicts can be resolved interactively.

## Known follow-up (documented, intentionally deferred)
Crash-recovery `acp_agent_reconnect` reloads the ACP session with **no** MCP servers re-attached (it doesn't carry the renderer's current set). Normal restore (`restoreOrCreateAcpSession`) re-sends them. See the comment at the `acp_session_load` call inside `acp_agent_reconnect` in `src-tauri/src/commands/acp.rs`.

## Orientation pointers (read, don't duplicate)
- Architecture: `docs/architecture.md` (store table `local-ai-store` row; `local_agent.rs`; MCP-via-agent isolation row).
- Feature: `docs/features/ai-providers.md` ("Path 2: ACP" → custom_acp + Local Agent preset + MCP pass-through; Key Files table).
- Logic core (already unit-tested, safe to trust): `src/lib/ai/local-agent-setup.ts` (driver), `local-agent-model.ts` (recommendation), `local-agent-routing.ts` (fallback), `acp-mcp.ts` (MCP inputs); `src/hooks/useLocalAgentSetup.ts` (the glue that wires real IPC — this is the part runtime testing exercises).
- Backend compile gate in a headless checkout: `src-tauri/scripts/generate-pkg-config-stubs.sh` then `PKG_CONFIG_PATH=...stubs cargo check`. **On your Mac you don't need the stubs — `cargo build`/`cargo test` work directly.**

## Suggested skills for the next agent
- **`verify`** (or `run`) — launch the app and drive the real setup flow (item 1). This is the primary task.
- **`review-ui`** — design review of the four new surfaces (item 2).
- **`test-e2e`** — Playwright happy-path spec (item 3).
- **`test-rust`** — `cargo test` in `src-tauri/` (item 3).
- **`test-perf`** — re-baseline perf on real hardware (item 4).
- **`verify`** (the PRD-gate variant) — final pass against `docs/prds/2026-06-12-local-ai-agents.md` quality gates before marking #23 done.

## Do NOT
- Re-implement the backend/logic — it's done and tested; only the env-var/dir specifics (item 1) may need a one-line tweak.
- Put the model identifier or any secrets in commits/PR text.
- Push to a different branch — stay on `claude/acp-notesage-compatibility-2s7kt0`.
