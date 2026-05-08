# Release v0.37.0

**Date:** 2026-04-18
**Previous version:** 0.36.0

Closes the remaining ACP-protocol gaps from the previous release: comment-delegated agent tasks now restore their conversation context after a restart, agents that authenticate with environment-variable credentials get a generic credentials form, and links from AI messages are now clickable. Plus a security-update wave (3 npm + 2 Rust advisories closed) and dependency cleanup.

## Changes

### Features

- **Comments delegated to AI agents now restore their context after a restart.** Reopening a delegated comment thread after restarting Notesage continues where you left off instead of starting fresh — the agent remembers the prior turn. When a delegated task finishes (completed, failed, or cancelled) Notesage cleanly closes the agent's session so resources don't leak.
- **AI agents that authenticate with credentials** (API keys, tokens, environment variables) now drive a generic credentials form provided by the agent itself. The form fields adapt to whatever each agent advertises, with the agent's own "Get yours at" link as helper text. Replaces the Gemini-specific API-key panel — works for any agent that advertises this auth mode. Existing Gemini connections continue working without re-entering credentials.
- **AI messages can now include clickable file references.** When an agent sends a link to a file inside your project, clicking it opens the file as a tab. Links to external URLs open in your browser. Optional descriptions render as a second line of text under the link.

### Improvements

- **AI agent authentication is more reliable.** Auth state is now driven by the agent itself rather than by Notesage probing each provider's CLI separately. Fewer false alarms, fewer brittle edge cases on non-standard installs.
- **Cleaner dev-console output.** Agent message echoes no longer log "Unknown ACP session update type" warnings on every chunk.

### Security

- **DOCX viewer's "Convert to Markdown" path is safer.** Underlying XML library updated to close four advisories around how XML metadata (DocumentType nodes, processing instructions, comments) was serialised — relevant when opening DOCX files from untrusted sources.
- **Inline Excalidraw drawings updated** to close a cross-site-scripting advisory in the math-label rendering for Mermaid sequence diagrams.
- **Dev-tooling chain updated** to close a denial-of-service advisory in an FTP library used only during E2E test setup, and a server-side rendering injection advisory in a JSX library pulled in transitively. Neither was reachable in shipped paths but the audit is now clean.
- **Rust TLS stack patched** to close two name-constraint bypass advisories. Transitive via the HTTP client used for AI provider calls.

## Under the hood

PRD: `docs/prds/2026-04-18-acp-protocol-tail.md`. Full dependency audit at `docs/audits/2026-04-18-dependencies.md`.

- **Task agent session parity** — comment-delegated tasks (via `useAgentTaskOperations`) now use the same `restoreOrCreateAcpSession` chain as the main chat: `session/resume` → `session/load` → `session/list` → `session/new`. `session/close` fires on terminal states (completed / failed / cancelled), capability-gated and error-swallowed so it never blocks state transitions.
- **EnvVar auth flow** — enabled `unstable_auth_methods` on both ACP crates. Agents advertising `AuthMethod::EnvVar` drive a generic credential form; submitted values are stored in `credentials.envVars` (keychain) and passed to the child process as environment variables on spawn. `credentials.envVars` retained as the storage layer; Gemini connections with existing stored vars continue working without migration.
- **`resource_link` content blocks** — `acp-utils.ts`'s `normalizeToolCallContent` extended to handle `resource_link` blocks alongside `Diff` / `Content` / `Terminal`. `file://` URIs inside a project open as editor tabs via the existing link-click extension; other URIs open via `openExternal`.
- **`messageId` propagation** — enabled `unstable_message_id` on both ACP crates. Outbound `session/prompt` carries the user message's UUID as `PromptRequest.message_id`; inbound `agent_message_chunk` events store the echoed `user_message_id` and the agent's own `message_id` on the corresponding `ChatMessage`. Forward-compatibility plumbing — no user-visible change yet, but unblocks features that need stable protocol IDs (next-edit-suggestions, richer plan linkage).
- **`user_message_chunk` events** recognised as a silent no-op — agent echoes no longer log "Unknown ACP session update type" on every chunk. No state mutation; we already have the user message locally.
- Removed the hardcoded per-provider `<cli> auth status` CLI probes from `acp_binary.rs` (claude, codex, copilot, gemini) — `check_agent_auth` and `resolve_cli_binary` deleted (~130 lines). Auth state now comes from the ACP `authenticate` response.
- **Dependency cleanup:** removed unused `@tippyjs/react` (0 source imports — the four Tiptap suggestion extensions use `tippy.js` directly) and `@agentclientprotocol/claude-agent-acp` (only referenced as a string literal in install-instruction UI; the real ACP agent binary is downloaded from GitHub Releases at runtime via `agent_manager.rs`). Side effect: transitive LGPL-3.0 `@img/sharp-libvips-darwin-arm64` and proprietary `@anthropic-ai/claude-agent-sdk` dropped from the dev tree (−898 lines from `pnpm-lock.yaml`).
- **Skills retro batch** from this cycle: `implement-tasks` now requires worktree-isolated sub-agents to commit inside the worktree before returning, and treats "deferred / documented-only / v1 fallback" acceptance criteria as NOT done until the user explicitly approves reduced scope. `plan-tasks` updates the PRD header with a `Tasks` row when creating a tasks file. `prd` template reserves a `Tasks` row placeholder.

### Security advisory IDs

For the security-conscious user looking up specific CVEs:

- npm: GHSA-39q2-94rc-95cp (`dompurify` 3.3.3 → 3.4.0), GHSA-rp42-5vxx-qpwr (`basic-ftp` ≥5.3.0 — dev-only via WDIO > puppeteer), GHSA-458j-xx4x-4375 (`hono` ≥4.12.14 — transitive via ACP SDK)
- Rust: RUSTSEC-2026-0098 + RUSTSEC-2026-0099 (`rustls-webpki` 0.103.10 → 0.103.12 — transitive via `reqwest` / `rustls`)
- `pnpm audit` reports 0 vulnerabilities.

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
