# PRD: ACP Protocol Tail (Batch C-bis + D)

|  |  |
| --- | --- |
| **Date** | 2026-04-18 |
| **Status** | Draft |
| **Priority** | Low-Medium (maintenance) |
| **Impact** | Closes remaining ACP protocol gaps after Batches B/C. Comment-delegated chats gain session continuity; agents' `resource_link` blocks render; auth flows consolidate on ACP primitives. |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batches C-bis + D |

## Problem

After Batches B (rich tool content, v0.36.0) and C (session lifecycle, v0.36.0), a short tail of ACP protocol work remains. Each item is small on its own but accumulates debt:

- **Task-agent conversations diverge from chat.** Comment-delegated agents (via `useAgentTaskOperations`) always call `session/new` — they don't use the restoration chain that the main chat gained in Batch C, nor do they fire `session/close` on completion. A user who reopens a delegated comment thread after an app restart sees an agent with no memory of the prior turns. Meanwhile, task sessions leak agent-side resources.
- **Protocol events fall through.** Two streaming update types are unhandled: `user_message_chunk` logs a debug "Unknown session update type" every time an agent echoes the user's message, and `resource_link` content blocks (URIs with metadata) render nothing — if an agent sends a link to a document, the user sees dead air.
- **Messages have no stable protocol IDs.** Branching, resend, and edit features work today by convention on top of an ID-less wire contract. ACP has `unstable_message_id` exactly for this case; we just don't propagate the IDs yet. Retrofitting when a future feature (NES, rich plan linkage) needs them is painful — a forward-compatible passthrough now is cheap.
- **Auth is still hardcoded per provider.** Notesage pre-checks auth status by shelling out to provider-specific CLIs (`claude auth status`, `codex auth status`) instead of using ACP's own `authenticate` flow. The `EnvVar` auth type — designed exactly for the Gemini-style API-key case — is not used; we ship a bespoke `envVars` field on the connection credentials instead.

None of these is a bug. Each is a "we can do this the ACP-native way" cleanup that reduces per-provider hardcoding and tightens the surface.

## Goals

1. **Restoration parity for task agents** — `useAgentTaskOperations` uses the same capability-gated restoration chain as the main chat (resume → load → list → new).
2. **Task session cleanup** — fire best-effort `session/close` when a task completes, fails, or is cancelled.
3. **Silent `user_message_chunk` handling** — recognize and ignore (no user-visible effect, no spurious debug logs).
4. **Render `resource_link` content blocks** — as a simple link card within text segments.
5. **Propagate `messageId` through prompts and streams** — enable `unstable_message_id`, set outbound message IDs on `PromptRequest`, store echoed IDs on `ChatMessage`. No user-visible change in v1; forward-compatibility groundwork.
6. **Proper `EnvVar` auth** — migrate Gemini-style env-var credentials from the bespoke `envVars` connection field to ACP's `EnvVar` auth method, gated on the `unstable_auth_methods` feature.
7. **Remove hardcoded auth status CLI checks** — rely on ACP's `authenticate` response for auth state instead of per-provider CLI probes.

## Non-Goals

- **MCP server passthrough** (#23) — different enough in scope (bridging Notesage's MCP client into agent sessions) that it deserves its own PRD. Deferred.
- **Content block beyond `resource_link`** — `audio` (#38) and `resource` embedded (#40) are still `x`. Nothing's calling for them yet.
- **Terminal auth type** (#10) — closely related to Batch F (terminal client capability) and parked with that work.
- **Logout** (#11) — low demand, low impact. Left for a future cleanup.
- **Task agent concurrency** — keep one-task-at-a-time semantics; restoration + close are the only lifecycle changes.
- **Breaking existing Gemini connections** — migration from the custom `envVars` field must preserve existing API keys without user action.

## User Stories

1. **As a user continuing a comment thread days later**, I want the agent to remember what we already discussed — not to start fresh every time I reply.
2. **As a user watching an agent emit a link to documentation**, I want to see the link with its title/description so I can click through, not silence.
3. **As a user connecting Gemini**, I want the API-key entry to feel like any other auth method — not a special-case UI pathway. *(This is a small refactor, mostly invisible to the user, but removes per-provider branching in the settings.)*
4. **As a developer**, I want `grep 'auth status'` in the codebase to return zero hits so adding a new provider doesn't need a hardcoded probe.

## Technical Approach

### Phase 1 — Task agent session parity

**Current state.** `useAgentTaskOperations.ts:startAcpTask` calls `tauriApi.acpSessionNew` directly. Task conversations live in chat-store (same store as main chats) and have their own `acpSessionId` field populated when a session is created. But nothing reads that field on the next task — we always create a fresh session.

**Change.**

1. Replace `tauriApi.acpSessionNew(instanceId, cwd)` in `startAcpTask` with a call to `restoreOrCreateAcpSession` (already exported from `src/lib/ai/acp-session-restore.ts`).
2. Supply `storedSessionId` from the task's chat-store conversation — same lookup as `useAcpLifecycle` does.
3. When the task completes (`completed` status), fails, or is cancelled, fire `tauriApi.acpSessionClose(instanceId, sessionId).catch(() => {})` — best-effort, capability-gated on `hasSessionCapability(caps, 'close')`.
4. The existing `setSegmentSessionId` (or equivalent for tasks) continues to persist the session ID on the conversation so the next task continues where we left off.

**Caveat — capability resolution.** Task agents are spawned with `'task'` role (vs `'chat'` for the main chat). They go through the same spawn path, so the same `capabilities` payload is available on `AcpAgentState`. The resolver works unchanged.

**Known limitation** (preserved, not resolved here). If the user keeps multiple concurrent comment threads on the same connection, they'll each try to resume different session IDs through the same agent instance. The current single-session-at-a-time model handles this gracefully because `useAgentTaskOperations` already respawns the agent when the project changes. But we should document the edge case in the `useAgentTaskOperations` header comment.

### Phase 2 — Content-block handling

**`user_message_chunk` (Item #3).**

Add a handler branch in both `useAcpSessionListeners.ts` and `useAgentTaskOperations.ts` that explicitly acknowledges the event (so it doesn't fall through to the `Unknown session update type` debug log) and discards it. We already have the user's message locally in chat-store — echoing is redundant.

```ts
} else if (update.sessionUpdate === 'user_message_chunk') {
  // Agent echoes user message as it's received — we already have it locally.
  // Recognize explicitly to suppress the "Unknown session update" debug log.
}
```

No UI change.

**`resource_link` content blocks (Item #4).**

These are top-level content blocks (same level as `text` and `image`) — arrays of them can appear in `agent_message_chunk.content`. Schema shape:

```ts
{ type: 'resource_link', uri: string, name?: string, description?: string, mimeType?: string, size?: number }
```

Render as a compact link card inline in the text segment. Reuse the existing link-preview styling pattern from the editor's `> [!link](url)` blocks if possible (or a simpler stub — see UI section). Two decision points:

1. **Local file vs. external URI.** If `uri` starts with `file://` and resolves inside a project, render as an internal document link (opens in editor tab). Otherwise render as an external link (opens in system browser).
2. **New segment type or inline in TextSegment?** Adding a `ResourceLinkSegment` is cleaner but adds a type variant. Simpler: append to the current text segment as markdown-style link text, let the existing markdown renderer handle it. Recommend the simpler path for v1.

### Phase 2b — `messageId` propagation

**Prereq:** enable `unstable_message_id` in `Cargo.toml` for both ACP crates.

**Wire contract.**

- On `session/prompt` (outbound), populate `PromptRequest.message_id` with the UUID Notesage already generates for `ChatMessage.id`. One extra field; no logic change.
- On `agent_message_chunk` (inbound), read the optional `user_message_id` echo (the agent confirms which inbound prompt it's responding to) and the agent's own `message_id` for the outbound assistant message.
- Persist both on the corresponding `ChatMessage` as a new optional field (`acpMessageId?: string`). No-op when the agent doesn't emit it.

**Migration.** No action needed — existing messages without an ACP message ID keep working. Going forward, new messages carry IDs.

**Why it's in this PRD.** We're already enabling an unstable feature flag (`unstable_auth_methods`); adding one more costs almost nothing. The chat-store surface is already open for the Phase 1 task-lifecycle changes — piggybacking a one-field passthrough is cheap. And when a future consumer lands (NES referencing specific past messages, richer plan linkage, etc.), the ID is already on disk.

### Phase 3 — Auth consolidation

**`EnvVar` auth type (Item #5).**

**Prereq:** enable `unstable_auth_methods` in `Cargo.toml` for both `agent-client-protocol` and `agent-client-protocol-schema` crates.

**Current state.** Gemini connections have a custom `credentials.envVars: Record<string, string>` field. At spawn time (`useAgentTaskOperations.ts:ensureTaskAgent` and parallel code in `acp_binary.rs`), these env vars are passed to the child process as environment. The connection config dialog has a Gemini-specific panel for API key entry.

**Target state.** Gemini (and future EnvVar-auth agents) advertise an `EnvVar` method in their `authenticate` response. Notesage reads the spec'd var names from `AuthMethodEnvVar.vars[]`, prompts the user for each (with the advertised link to the credentials page), stores them in the keychain (same as existing API keys), and passes them via env on spawn. The connection's existing `envVars` field becomes an implementation detail of how we store the values — the wire contract now matches the spec.

**Migration.** Existing Gemini connections keep their `envVars` intact. On auth refresh, we detect EnvVar advertisement and use the same stored values to respond — user doesn't notice.

**`Authenticate` flow for status (Item #6).**

**Current state.** `acp_binary.rs` has per-provider CLI probes: `claude auth status`, `codex auth status`, `copilot auth status`. These are called before spawning the ACP subprocess to pre-check whether the user is authed.

**Target state.** Spawn the agent first; if `authenticate()` returns an unauthenticated status, surface the `authMethods[]` to the user. No per-provider probe.

**Caveat.** There's a reason we pre-probe today: spawning a fresh agent to only discover it needs auth is a bit wasteful, and for some agents (Gemini) the first spawn has side effects. A two-phase approach mitigates:

1. **Fast path:** if a connection has a stored auth artifact (keychain key, OAuth token expiry in the future, etc.), skip the probe and try to spawn directly.
2. **Unknown-state path:** if no artifact exists or it's expired, spawn the agent, call `authenticate()`, and render the returned methods.

The hardcoded CLI commands get deleted either way.

### Affected paths

| Path | Change |
| --- | --- |
| `src/hooks/useAgentTaskOperations.ts` | Route session creation through `restoreOrCreateAcpSession`; fire `session/close` on terminal states |
| `src/hooks/useAcpSessionListeners.ts` | Add `user_message_chunk` and `resource_link` branches |
| `src/components/chat/segments/TextSegmentView.tsx` (or new `ResourceLinkView`) | Render `resource_link` as link card |
| `src-tauri/Cargo.toml` | Enable `unstable_auth_methods` + `unstable_message_id` features |
| `src-tauri/src/commands/acp.rs` | Populate `PromptRequest.message_id`; read echoed `user_message_id` + response `message_id` |
| `src/lib/ai/types.ts` | Optional `acpMessageId` field on `ChatMessage` |
| `src-tauri/src/commands/acp_binary.rs` | Delete per-provider auth-status CLI probes |
| `src-tauri/src/commands/acp.rs` | Handle `AuthMethod::EnvVar` variant in authenticate flow |
| `src/components/settings/ConnectionsSettings.tsx` | Gemini panel becomes a generic EnvVar auth variant |
| `src/lib/ai/connections.ts` | `envVars` field preserved for storage; auth flow reads from `AuthMethodEnvVar.vars` at auth time |

## UI/UX

### Resource-link rendering

v1 stub:

```
[title or filename]   external-host.com
optional one-line description, truncated...
```

Compact, single-line-optional-two-lines card. Click opens the URI — editor tab for `file://` inside a project, system browser otherwise. No preview fetch (that's what the editor's link-preview feature is for).

### Auth method changes

**Settings > Connections > Add connection.** The current Gemini panel prompts for "API key (paste it here)" with a link to Google AI Studio. After the migration, the same UX happens but driven by the ACP `authenticate` response rather than hardcoded fields:

```
Before:                           After (EnvVar auth):
┌──────────────────────────┐     ┌──────────────────────────┐
│ API key                  │     │ <EnvVar label from agent>│  <- label + link from agent
│ [____________________]   │     │ Get yours at: [link]     │
│ Get one at Google AI ↗   │     │ GEMINI_API_KEY           │
└──────────────────────────┘     │ [____________________]   │
                                  │ (more vars if advertised)│
                                  └──────────────────────────┘
```

Visually very similar; the data source for the labels/link shifts from hardcoded strings to agent-advertised strings.

### Task-agent session continuity (no UI change)

Entirely behind the scenes. The user notices only that the agent remembers previous delegation turns.

## Data Model

```rust
// src-tauri/src/commands/acp.rs — new variant handling
enum AuthMethod {
    Agent,
    EnvVar { id, name, description?, vars: Vec<AuthEnvVar>, link? },  // new
    // (Terminal variant stays deferred to Batch F-adjacent work)
}
```

```typescript
// src/lib/ai/connections.ts — unchanged shape, new auth flow
interface GenericEnvVarCredentials {
  type: 'env_var';
  vars: Record<string, string>;  // populated from AuthMethodEnvVar.vars at auth time
}
```

## Dependencies

- Cargo feature bump: `unstable_auth_methods` on both ACP crates
- No new npm packages
- No new Tauri plugins

## Quality Gates

- [ ] Enabling `unstable_auth_methods` + `unstable_message_id` doesn't break existing ACP connections (`cargo test` green in `src-tauri/`)
- [ ] Reopening a comment thread after an app restart restores the agent's prior context (via `session/resume` or `session/load`, depending on capability)
- [ ] Task completion fires a `session/close` call (observable in the ACP message log) when the agent supports it; errors silently tolerated
- [ ] `Unknown ACP session update type: user_message_chunk` debug log no longer appears
- [ ] An agent-emitted `resource_link` renders as a clickable link card inline in the message; clicking a `file://` link inside a project opens the editor tab
- [ ] `PromptRequest.message_id` is set on outbound prompts; echoed `user_message_id` and response `message_id` are stored on the corresponding `ChatMessage` when the agent emits them
- [ ] Gemini connection migration: existing connections with `envVars` values continue to work with no user action; fresh connections go through the EnvVar auth flow
- [ ] `acp_binary.rs` has no per-provider `auth status` CLI probes
- [ ] TypeScript type check passes
- [ ] All existing tests continue to pass
- [ ] Unit tests for `user_message_chunk` noop handler, `resource_link` rendering, `messageId` round-trip, and the `restoreOrCreateAcpSession` call site in `useAgentTaskOperations`

## Out of Scope

- MCP server passthrough (separate PRD pending)
- `audio` / embedded `resource` content blocks
- `Terminal` auth type (parked with Batch F)
- `logout` method
- Provider-specific auth onboarding polish beyond what EnvVar already enables
- Refactor of the task-agent concurrency model
