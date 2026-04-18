# Release v0.37.0

**Date:** 2026-04-18
**Previous version:** 0.36.0

## Changes

### Features

**ACP Protocol Tail (Batch C-bis + D)**
Closes the remaining ACP protocol gaps after Batches B (v0.36.0) and C (v0.36.0). See `docs/prds/2026-04-18-acp-protocol-tail.md`.

- **Task agent session parity.** Comment-delegated tasks (via `useAgentTaskOperations`) now use the same restoration chain as the main chat (resume → load → list → new). Reopening a delegated thread after an app restart restores the agent's prior context instead of starting fresh. `session/close` fires on terminal states (completed / failed / cancelled), capability-gated and error-swallowed so it never blocks state transitions.
- **EnvVar auth flow.** Enabled `unstable_auth_methods` on both ACP crates. Agents advertising `AuthMethod::EnvVar` now drive a generic credential form — one password-style input per advertised variable, with the agent-provided "Get yours at" link as helper text. Replaces the hardcoded Gemini API-key panel.
- **`resource_link` content blocks.** ACP agents emitting `resource_link` blocks now render them inline as markdown links (`[name or basename(uri)](uri)`). `file://` URIs inside a project open as editor tabs via the existing link-click extension; other URIs open in the system browser. Description, when present, renders on a truncated subline.
- **`messageId` propagation.** Enabled `unstable_message_id` on both ACP crates. Outbound `session/prompt` carries the user message's UUID as `PromptRequest.message_id`; inbound `agent_message_chunk` events store the echoed `user_message_id` and the agent's own `message_id` on the corresponding `ChatMessage`. No user-visible change — forward-compatibility plumbing for features that need stable protocol IDs (NES, richer plan linkage).

### Improvements
- `user_message_chunk` events are now recognized as a silent no-op instead of logging "Unknown ACP session update type" on every agent echo. No state mutation; we already have the user message locally.
- Auth state now comes from the ACP `authenticate` response. Removed the hardcoded per-provider `<cli> auth status` CLI probes from `acp_binary.rs` (claude, codex, copilot, gemini) — `check_agent_auth` and `resolve_cli_binary` deleted (~130 lines).
- `credentials.envVars` retained as the storage layer for EnvVar auth (populated by the generic form, read at spawn time). Gemini connections with existing stored vars continue working without migration.

### Security
- **npm advisories closed (3):**
  - `dompurify` ^3.3.3 → ^3.4.0 — closes GHSA-39q2-94rc-95cp (`ADD_TAGS` bypasses `FORBID_TAGS`).
  - `basic-ftp` pnpm override `>=5.2.2` → `>=5.3.0` — closes GHSA-rp42-5vxx-qpwr (DoS). Dev-only chain via WDIO > puppeteer.
  - Added `hono >=4.12.14` pnpm override — closes GHSA-458j-xx4x-4375 (JSX SSR HTML injection). Transitive via the ACP SDK chain.
- **Rust advisories closed (2):** `rustls-webpki` 0.103.10 → 0.103.12 closes RUSTSEC-2026-0098 (URI name-constraint bypass) and RUSTSEC-2026-0099 (wildcard name-constraint bypass), both fixed in the same patch. Transitive via `reqwest` / `rustls`.
- `pnpm audit` now reports 0 vulnerabilities.

### Housekeeping
- Removed unused `@tippyjs/react` — 0 imports in source. The four Tiptap suggestion extensions use `tippy.js` directly.
- Removed unused `@agentclientprotocol/claude-agent-acp` — only referenced as a string literal in install-instruction UI. The real ACP agent binary is downloaded from GitHub Releases at runtime via `agent_manager.rs`. Side effect: transitive LGPL-3.0 `@img/sharp-libvips-darwin-arm64` and proprietary `@anthropic-ai/claude-agent-sdk` dropped from the dev tree (−898 lines from `pnpm-lock.yaml`).
- Full dependency audit saved at `docs/audits/2026-04-18-dependencies.md` with follow-up section documenting what was actioned vs deferred.

### Developer Experience
- **Skills retro batch** from the ACP Protocol Tail:
  - `implement-tasks` now requires worktree-isolated sub-agents to commit inside the worktree before returning — "leave changes staged" causes the runtime to clean up the worktree and lose the work.
  - `implement-tasks` treats "deferred / documented only / v1 fallback" acceptance criteria as NOT done until the user explicitly approves reduced scope.
  - `plan-tasks` now updates the PRD header with a `Tasks` row when creating a tasks file — establishes bidirectional PRD ↔ tasks navigation the project relies on.
  - `prd` template reserves a `Tasks` row placeholder in the header for `plan-tasks` to fill in.

## Files Changed

- 29 files changed across 9 commits since v0.36.0
- Frontend: `useAgentTaskOperations`, `useAcpSessionListeners`, `useAcpLifecycle`, `chat-store`, `acp-utils`, `tauri.ts`, `types.ts`, `ConnectAgent.tsx`, `connections.ts`
- Rust: `Cargo.toml`, `acp.rs`, `acp_binary.rs`
- Tests: `useAgentTaskOperations.test.ts`, new `useAcpSessionListeners.test.ts`, `link-utils.test.ts`, `acp-utils.test.ts`
- Docs: `ai-providers.md`, `ai-workflows.md`, PRD, tasks file, audit, skills (retro)
- Deps: `package.json`, `pnpm-lock.yaml`, `Cargo.lock`

## Commits

- `a7b1c55` feat: ACP task agent session parity + cleanup
- `854fc7e` feat: ACP streaming — user_message_chunk, resource_link, messageId
- `f41ac0b` feat: ACP auth consolidation — EnvVar + drop CLI probes
- `ab9925f` test+docs: ACP Protocol Tail tests + documentation
- `02ecf26` docs(skills): retro updates from ACP Protocol Tail batch
- `2894731` chore(deps): close 3 npm advisories (dompurify, basic-ftp, hono)
- `bcf8d23` chore(deps): bump rustls-webpki 0.103.10 → 0.103.12
- `c98f6e1` chore(deps): remove unused @tippyjs/react and claude-agent-acp
- `34bb7cf` docs(audits): add 2026-04-18 dependency audit + follow-up

## Quality Gates
- `pnpm typecheck` — clean
- `pnpm test` — 2779 / 2779 passing (131 files)
- `cd src-tauri && cargo test` — 615 / 615 passing
- `pnpm audit` — 0 vulnerabilities
- ACP Protocol Tail PRD — all 11 quality gates ticked
