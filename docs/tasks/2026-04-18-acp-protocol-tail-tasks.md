# ACP Protocol Tail — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-18 |
| **Status** | Not started |
| **PRD** | [acp-protocol-tail](../prds/2026-04-18-acp-protocol-tail.md) |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batches C-bis + D |
| **Total** | 13 tasks: 8S, 5M |
| **Suggested order** | Task parity (#1–#2) → Streaming/content (#3–#5) → Auth consolidation (#6–#11) → Tests (#12) → Docs (#13) |

**Risks / open questions:**

- **Gemini migration risk.** The EnvVar auth switch needs to preserve existing `credentials.envVars` payloads. If the keychain storage layer changes at the same time, users lose their API keys. Keep the field shape intact and only change the auth-flow entry point.
- **Fast-path auth heuristic.** The PRD proposes a "stored artifact present → skip probe, spawn directly" heuristic to avoid spawning an agent just to discover it needs auth. The exact artifact shape differs per provider (OAuth token expiry, plaintext key in keychain, SSO cookie). A simple "has any credential stored for this connection" boolean is probably enough for v1; refine only if real friction appears.
- `resource_link` **rendering decision.** PRD recommended "inline as markdown-style link in the current text segment" (v1 simple path). If the agent emits links as a standalone content array (not interleaved with text), this path needs a small extension to attach the link to the preceding text segment.
- **Phase independence.** Phases 1/2/3 touch different files and don't depend on each other. They can run in parallel worktrees. Within Phase 3: #10 depends on #9; #8 depends on #6–#7.

---

## Phase 1 — Task Agent Parity

### #1 — Route task agent session creation through `restoreOrCreateAcpSession` ✅

**Description:** Replace the direct `tauriApi.acpSessionNew` call in `startAcpTask` with `restoreOrCreateAcpSession` from `@/lib/ai/acp-session-restore`, so comment-delegated agents resume prior context on reopen.

**Acceptance criteria:**

- `useAgentTaskOperations.ts:startAcpTask` looks up the active conversation's `acpSessionId` (same pattern as `useAcpLifecycle`) and passes it to `restoreOrCreateAcpSession`
- Capabilities come from the spawned agent's `AcpSpawnResult.capabilities` (same as chat path)
- After the restoration resolves, the returned `session_id` is stored on the conversation via the existing `setSegmentSessionId` action (or equivalent)
- No regression for first-time task delegations (no stored ID → falls through to `session/new`)
- Unit tests: first run calls `session/new`; second run with stored ID calls `session/resume` (when advertised); mock both branches via `tauri-mock`

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useAgentTaskOperations.ts`
- `src/hooks/__tests__/useAgentTaskOperations.test.ts` (add cases)

---

### #2 — Fire `session/close` on task completion / failure / cancellation ✅

**Description:** When a task reaches a terminal status (`completed`, `failed`, `cancelled`), fire a best-effort `acp_session_close` call so the agent can free resources. Capability-gated on `sessionCapabilities.close`.

**Acceptance criteria:**

- `startAcpTask`'s completion, error, and cancel paths each call `tauriApi.acpSessionClose(instanceId, sessionId).catch(() => {})` before cleanup
- Skipped when the agent doesn't advertise the `close` capability (`hasSessionCapability(caps, 'close')` returns false)
- Errors are swallowed — the task's state transition is not blocked on close success
- Unit test: completes a mock task, asserts `acpSessionClose` was called once with the right IDs; a failing close doesn't affect `updateTaskStatus`

**Complexity:** S **Category:** frontend **Dependencies:** #1 (conceptually — same file; run sequentially in one worktree) **Files:**

- `src/hooks/useAgentTaskOperations.ts`
- `src/hooks/__tests__/useAgentTaskOperations.test.ts`

---

## Phase 2 — Streaming / Content Blocks

### #3 — Recognize `user_message_chunk` as a silent noop ✅

**Description:** Add an explicit branch for `user_message_chunk` in both the chat and task session listeners so it no longer falls through to the `Unknown ACP session update type` debug log. Discards the chunk — no user-visible effect.

**Acceptance criteria:**

- `useAcpSessionListeners.ts` adds `else if (update.sessionUpdate === 'user_message_chunk') { /* recognized, no-op */ }` before the fallthrough `else if` that logs unknown types
- Same branch added to `useAgentTaskOperations.ts` session update handler
- `Unknown ACP session update type: user_message_chunk` debug log no longer appears during a session
- No change to the message store / segments
- Unit test: dispatching a `user_message_chunk` event does not modify chat-store state and does not log

**Complexity:** S **Category:** frontend **Dependencies:** None (parallel with #1/#4) **Files:**

- `src/hooks/useAcpSessionListeners.ts`
- `src/hooks/useAgentTaskOperations.ts`
- tests

---

### #4 — Render `resource_link` content blocks inline ✅

**Description:** When an agent emits a `resource_link` content block (URI + optional name/description/mimeType/size), render it as a compact link inline in the chat. File URIs that resolve inside a project open as editor tabs; other URIs open in the system browser.

**Acceptance criteria:**

- Normalize `resource_link` content blocks from ACP in `acp-utils.ts` (new helper `normalizeResourceLinkBlock` or extend the chunk-content handler)
- Append to the active text segment as a markdown-formatted link (`[title](uri)`) — reuses the existing markdown renderer, no new segment type needed
- `file://` URIs inside a known project path open an editor tab; other URIs open via `openExternal`
- `name` used as link text when present; fall back to the basename of the URI
- `description` rendered as a short subline (truncated to \~80 chars) when present
- Works both in chat panel and in the task activity rendering if task agents emit links
- Unit test: a `resource_link` chunk with `file://` inside a project opens the editor tab on click; external URL opens via `openExternal`

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/ai/acp-utils.ts` — normalizer
- `src/hooks/useAcpSessionListeners.ts` — branch for `resource_link` content
- `src/hooks/useAgentTaskOperations.ts` — same branch for parity
- `src/lib/ai/types.ts` — if a new segment shape is needed (likely not)
- tests

---

### #5 — Propagate `messageId` through ACP prompts and streams ✅

**Description:** Enable `unstable_message_id` and plumb message IDs end-to-end. On outbound `session/prompt`, populate `PromptRequest.message_id` with the UUID Notesage already generates for `ChatMessage.id`. On inbound stream events, read the optional `user_message_id` echo and the agent's own `message_id` and persist both on the corresponding `ChatMessage`. No user-visible change in v1; forward-compatibility groundwork.

**Acceptance criteria:**

- `unstable_message_id` enabled on both ACP crates in `src-tauri/Cargo.toml`
- `acp_session_prompt` Tauri command accepts an optional `message_id` param and forwards it on the `PromptRequest`
- Frontend `acpSessionPrompt` wrapper passes the user `ChatMessage.id` as the outbound `message_id`
- `agent_message_chunk` handler (chat + task listeners) reads `user_message_id` and `message_id` fields when present, stores them on the corresponding `ChatMessage` as `acpMessageId`
- New optional `acpMessageId?: string` field added to `ChatMessage` in `types.ts`
- Works when the agent doesn't emit either field (no-op — existing messages keep their current ID scheme)
- `cargo check` + `cargo test` pass; frontend typecheck passes
- Unit test: round-trip a mocked prompt through the backend, assert the echoed `message_id` lands on the user message

**Complexity:** S **Category:** both **Dependencies:** None (parallel with #1–#4) **Files:**

- `src-tauri/Cargo.toml`
- `src-tauri/src/commands/acp.rs`
- `src/lib/ai/types.ts`
- `src/lib/tauri.ts` (or wherever `acpSessionPrompt` is defined)
- `src/hooks/useAcpSessionListeners.ts` + `useAgentTaskOperations.ts`

---

## Phase 3 — Auth Consolidation

### #6 — Enable `unstable_auth_methods` Cargo features ✅

**Description:** Add `unstable_auth_methods` to the feature list on both `agent-client-protocol` and `agent-client-protocol-schema` crates in `src-tauri/Cargo.toml`. This unblocks `AuthMethod::EnvVar` and `AuthMethod::Terminal` variants (the Terminal variant stays unused — that's Batch F territory).

**Acceptance criteria:**

- Both crates list `unstable_auth_methods` alongside existing unstable features
- `cd src-tauri && cargo check` passes
- `cd src-tauri && cargo test` passes — no regressions
- No functional change yet (prereq for #6)

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/Cargo.toml`

---

### #7 — Handle `AuthMethod::EnvVar` in the authenticate flow ✅

**Description:** Recognize and forward the `EnvVar` auth method variant from the agent's `authenticate` response up to the frontend. Required vars propagate to the UI so the user can enter values.

**Acceptance criteria:**

- Backend `AuthMethodInfo` extraction in `acp.rs` accepts `AuthMethod::EnvVar { id, name, description, vars, link }` and serializes the full shape to the frontend (not just `{ id, name, description }`)
- Frontend type `AuthMethodInfo` in `src/lib/ai/acp-utils.ts` (or wherever the auth method type lives) gains optional `vars: AuthEnvVar[]` and `link?: string` fields, gated by discriminated `type: 'env_var' | 'agent'`
- Agents that advertise only `EnvVar` methods skip the browser-OAuth UI path; agents advertising `Agent` continue to work unchanged
- Unit test: a mock agent that advertises an `EnvVar` method returns the `vars[]` and `link` intact through the IPC round-trip

**Complexity:** M **Category:** both **Dependencies:** #6 **Files:**

- `src-tauri/src/commands/acp.rs` — match `AuthMethod::EnvVar`
- `src/lib/ai/acp-utils.ts` — extend `AuthMethodInfo` shape
- tests

---

### #8 — Generic EnvVar auth UI

**Description:** Replace the Gemini-specific "API key" settings panel with a generic EnvVar flow driven by the agent-advertised `vars[]` and `link`. Existing Gemini connections keep working via migration.

**Acceptance criteria:**

- A new auth settings component renders each advertised var as a labeled password-style input, with the agent-provided `link` as a helper (e.g. "Get yours at: ")
- Submitting the form stores values in the keychain under the same `envVars` field used today (no change to storage format — only the auth-flow entry point)
- Gemini's existing hardcoded panel is removed; connections fall back to the generic panel
- Migration: when the user opens an existing Gemini connection, stored `envVars` pre-populate the inputs
- No UI regression for API-key-based connections (Anthropic / OpenAI) — those use a different auth method, not `EnvVar`

**Complexity:** M **Category:** frontend **Dependencies:** #7 **Files:**

- `src/components/settings/ConnectionsSettings.tsx` (or nearest connection config dialog)
- `src/components/settings/GeminiAuthPanel.tsx` — delete or fold into generic
- `src/lib/ai/connections.ts` — confirm `envVars` field shape is reused

---

### #9 — Delete hardcoded `<provider> auth status` CLI probes ✅

**Description:** Remove the per-provider CLI probes in `acp_binary.rs` (`claude auth status`, `codex auth status`, `copilot auth status`). Auth state now comes from the ACP `authenticate` response, not from out-of-band CLI calls.

**Acceptance criteria:**

- The `check_auth_status` path in `acp_binary.rs` (lines 173–202 of the file at commit time) is deleted along with its callers
- Any frontend code that relied on the returned auth status falls back to the `authenticate` flow
- `cargo check` + `cargo test` pass
- Grep confirmation: `grep "auth status" src-tauri/src/commands/acp_binary.rs` returns zero hits
- Manual test: connecting a Claude Code agent with valid auth still works; connecting an unauthenticated agent shows the authenticate flow per spec

**Complexity:** S **Category:** backend **Dependencies:** #7 (the `authenticate` response has to carry enough info to replace the probe) **Files:**

- `src-tauri/src/commands/acp_binary.rs`
- any Rust/TS callers of the removed probe (search and update)

---

### #10 — Stored-artifact fast path for auth state ✅

**Description:** Before spawning an agent purely to discover it needs auth, short-circuit when a credential artifact exists for the connection (keychain entry, stored envVars, etc.). This preserves the "don't spawn unless needed" property that the old CLI probes provided.

**Acceptance criteria:**

- `acp_agent_spawn` (or a new helper on the frontend side) checks whether the connection has stored credentials before spawning
- For connections with a stored credential, proceed with the normal spawn+authenticate path
- For connections without stored credentials, show the `authenticate` flow directly without spawning the agent first
- The exact heuristic is "any non-empty value in the connection's credential fields" — we don't validate liveness
- Manual test: a fresh connection with no keys shows the auth UI without spawning; a connection with keys spawns and authenticates

**Complexity:** S **Category:** both **Dependencies:** #9 **Files:**

- `src-tauri/src/commands/acp.rs` (spawn path) or frontend auth gate
- `src/hooks/useAcpLifecycle.ts` or wherever the spawn entry point lives

---

### #11 — Sunset the custom `envVars` connection field (if redundant) ✅

**Description:** Audit whether the bespoke `credentials.envVars` TypeScript field is still needed after #6–#9, or whether it can be fully replaced by the generic EnvVar auth flow. Delete if possible; keep with a comment if still needed for migration.

**Acceptance criteria:**

- Audit result recorded in the PR description: either (a) field deleted with migration confirmed working, or (b) field kept with explicit reason documented
- If deleted: existing Gemini connections still authenticate after restart
- If kept: a one-line comment in `connections.ts` notes why (e.g. "kept for backwards compatibility with pre-v0.37 stored credentials")

**Complexity:** S **Category:** frontend **Dependencies:** #8, #10 **Files:**

- `src/lib/ai/connections.ts`
- possibly `src/stores/connections-store.ts` persist migration

---

## Phase 4 — Verification & Docs

### #12 — Integration tests

**Description:** Add integration-style tests covering the interactions between the phases. Existing unit tests from #1–#10 cover individual changes; this task catches the cross-cutting cases.

**Acceptance criteria:**

- Test: task agent delegation reopens an existing conversation → `session/resume` is attempted and succeeds (mock)
- Test: task agent completion fires `session/close` once
- Test: `user_message_chunk` during streaming doesn't log or mutate state
- Test: a synthetic agent response containing a `resource_link` renders a link with the expected target
- Test: a `file://` resource link inside a project opens via `openTab`; an external one calls `openExternal`
- Test: authenticate flow with an `EnvVar` method returns `vars[]` end-to-end (Rust + TS)
- All tests under 5s total, mock-based

**Complexity:** S **Category:** frontend (+ one Rust test for #7's end-to-end) **Dependencies:** #1–#11 **Files:**

- `src/hooks/__tests__/` (new or extended)
- `src-tauri/src/commands/` (Rust test alongside `acp.rs`)

---

### #13 — Documentation updates

**Description:** Reflect the new capability in the appropriate docs and mark audit rows shipped.

**Acceptance criteria:**

- `docs/features/ai-workflows.md` (delegation section) — note that delegation now restores agent-side context via `session/resume` / `session/load`
- `docs/features/ai-providers.md` (ACP section) — note EnvVar auth flow, mention `resource_link` rendering
- `docs/tauri-commands.md` — remove stale references to the deleted `auth status` probes if any exist
- `docs/audits/2026-04-14-acp-audit.md` — mark rows for #9 (EnvVar auth), #35 (user_message_chunk), #39 (resource_link), #59 (messageId tracking), and the Auth status pre-check row as <span style="color: rgb(34, 197, 94);">✔</span> Shipped in v0.XX.X; update feature matrix summary
- Mark this tasks file <span style="color: rgb(34, 197, 94);">✔</span> complete; tick PRD quality gates
- Mark the audit's bundled "Batch C-bis + D — ACP Protocol Tail" entry as shipped

**Complexity:** S **Category:** docs **Dependencies:** #12 **Files:**

- `docs/features/ai-workflows.md`
- `docs/features/ai-providers.md`
- `docs/tauri-commands.md`
- `docs/audits/2026-04-14-acp-audit.md`
- `docs/prds/2026-04-18-acp-protocol-tail.md`
- `docs/tasks/2026-04-18-acp-protocol-tail-tasks.md`