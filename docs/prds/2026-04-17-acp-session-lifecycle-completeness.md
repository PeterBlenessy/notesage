# PRD: ACP Session Lifecycle Completeness

|  |  |
| --- | --- |
| **Date** | 2026-04-17 |
| **Status** | Implemented ✅ |
| **Priority** | Medium |
| **Impact** | Chats survive app restarts with real agent-side context; branches get isolated agent context; conversation delete frees agent resources |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batch C |

## Problem

Four ACP session-lifecycle methods remain unimplemented, each causing concrete UX or correctness issues today:

- **`session/close`** — Notesage never tells agents when a conversation is gone. Sessions linger agent-side until the process dies, wasting memory and (for cloud-backed agents like Codex) billable context.
- **`session/list`** — We rely on our own persisted `acpSessionId` to restore sessions. If the store is lost or out of sync with the agent (e.g., agent crashed and restarted cleanly), we have no way to discover what's actually available.
- **`session/resume`** — The proper way to take over a live agent session. Today we use `session/load` (replay-based) for everything, which works but is heavier than needed when the agent still has the session in memory.
- **`session/fork`** — All chat branches today share a single agent-side session ID. The agent sees a single linear timeline even when the user switches branches; its context can diverge from what the user sees. Forking creates truly isolated sub-sessions.

All four are gated on `sessionCapabilities.{list, fork, resume, close}` and are marked unstable in the ACP crate (features behind `unstable_session_*` flags). Not every agent will support every method.

## Goals

1. **Cross-restart session continuity** — after quitting and relaunching Notesage, existing ACP chats transparently reconnect to their agent sessions with real context, preferring `session/resume` when available and falling back to `session/load`, then `session/new`.
2. **Branch isolation via fork** — when the user branches from the active leaf, call `session/fork` so the new branch has its own agent context going forward.
3. **Clean up on delete** — when the user deletes a conversation, call `session/close` (best-effort) so agents release resources.
4. **Robust resume discovery** — when `session/resume` or `session/load` fails (session unknown to agent), call `session/list` to confirm whether a session exists before falling back to `session/new`.
5. **Capability-gated everywhere** — every new method is called only when the agent advertises support.

## Non-Goals

- **In-app session browser UI** — no new "browse all agent sessions" view. `session/list` is an implementation detail of the resume/cleanup flow, not a user-facing feature.
- **Historical-message branching with agent state rewind** — ACP has no primitive for "put the agent back at message M, then fork". Historical branches continue to share the parent session; only leaf-branches get a fresh forked session. Documented as a known limitation.
- **MCP server passthrough (#23)** — originally grouped with Batch C in the audit; moved to a later batch. It touches a different system (MCP client + connection config) and can ship independently.
- **Graceful shutdown close-all** — we keep relying on `kill_on_drop` + `RunEvent::Exit` for quit. Sending `session/close` for every live session at quit adds latency risk without much benefit (the process dies anyway).
- **Agent switch closing the old session** — current agent-switch boundaries stay as-is; we don't call `session/close` on the prior agent's session.

## User Stories

1. **As a user restarting Notesage**, I want my recent ACP chats to pick up right where they left off — with the agent remembering the full context — without having to re-send a recap.
2. **As a user branching a chat**, I want the new branch to explore a different direction without the agent's reasoning being contaminated by the other branch's follow-ups.
3. **As a user cleaning up old chats**, I want deleting a conversation to actually release agent-side resources, not just hide it from my history.

## Technical Approach

### ACP schema / cargo features

Enable three additional unstable features in `src-tauri/Cargo.toml` for both crates (note: `session/list` is stable and does NOT need a feature flag):

```toml
agent-client-protocol = { version = "0.10.4", features = [
    "unstable_session_model",
    "unstable_session_usage",
    "unstable_session_close",
    "unstable_session_fork",
    "unstable_session_resume",
] }
agent-client-protocol-schema = { version = "0.11.4", features = [
    "unstable_session_model",
    "unstable_session_usage",
    "unstable_session_close",
    "unstable_session_fork",
    "unstable_session_resume",
] }
```

### Capability extraction (capability probe)

Today `acp_agent_spawn` already extracts `AgentCapabilities`. Extend it to read `sessionCapabilities.{list, fork, resume, close}` presence (each is `Option<Session*Capabilities>`; `Some(_)` = supported). Store as four booleans on `AcpSpawnResult` and `connections-store` probing data:

```typescript
interface AcpAgentCapabilities {
  load_session?: boolean;
  prompt_capabilities?: { image?: boolean };
  session_capabilities?: {
    list?: boolean;
    fork?: boolean;
    resume?: boolean;
    close?: boolean;
  };
}
```

Capability flags drive everything downstream — every new command short-circuits when the capability is absent.

### New Tauri commands (`src-tauri/src/commands/acp.rs`)

Mirror the existing `acp_session_load` / `acp_session_new` pattern:

| Command | Signature | Capability gate |
| --- | --- | --- |
| `acp_session_close` | `(instance_id, session_id) -> Result<(), String>` | `session_capabilities.close` |
| `acp_session_list` | `(instance_id, cwd: Option<String>, cursor: Option<String>) -> Result<AcpListResult, String>` | `session_capabilities.list` |
| `acp_session_resume` | `(instance_id, session_id, cwd) -> Result<AcpSessionResult, String>` | `session_capabilities.resume` |
| `acp_session_fork` | `(instance_id, session_id, cwd) -> Result<AcpSessionResult, String>` | `session_capabilities.fork` |

Each calls the crate's `Agent::close_session` / `list_sessions` / `resume_session` / `fork_session` via the existing connection. `AcpListResult` is `{ sessions: AcpSessionInfo[], next_cursor: Option<String> }`. `AcpSessionResult` (already defined) is reused for resume/fork since both return modes/config/model state.

### Session restoration flow (cross-restart continuity)

Today in `useAcpLifecycle.ts` (around line 216–240):

```
if (storedSessionId && loadSession capability) {
  try session/load → use it
  on failure: session/new
} else {
  session/new
}
```

New flow:

```
if (storedSessionId) {
  if (resume capability) try session/resume
  else if (load capability) try session/load
  on either failure:
    if (list capability) call session/list to verify sessionId exists
    if not found: session/new (fresh)
    if found but resume/load both failed: session/new (give up gracefully)
} else {
  session/new
}
```

Preference order: **resume → load → new**. Rationale: `resume` is the lightest (agent still has session in memory, no replay); `load` replays history to the client (works even after agent restart if persisted); `new` is the fallback. `session/list` acts as a sanity check before giving up — avoids the edge case where the stored ID is simply stale/wrong and the session legitimately doesn't exist anymore.

### Branching via fork

Today `branchFromMessage(messageTimestamp)` just moves `activeLeafId` inside the chat-store tree. All branches share a single `conversation.acpSessionId`.

New behavior — move the ACP session onto the branch rather than the conversation:

1. Add `acpSessionId?: string` to branch metadata (per-leaf, not per-conversation). Simplest implementation: store it on the leaf message, or a separate `branchSessions: Record<leafId, sessionId>` map on `Conversation`.
2. When the user branches from the **active leaf** (i.e., they're at the end of the current branch) and the agent advertises `fork` capability:
   - Call `session/fork(currentSessionId, cwd)` to get a new session ID
   - Store it under the new branch's leaf
   - The new branch's prompts go to the forked session; old branch's prompts still go to the original session
3. When the user branches from a **historical message** (not the leaf):
   - Best-effort: fall back to sharing the parent session. The new branch will see agent context that's "ahead" of the branch point — document this as a known limitation in the UI (small info tooltip on the branch switcher).
4. When the user **switches branches**, `ChatPanel` resolves `acpSessionId` from the active leaf (or falls back to the conversation-level ID for pre-migration chats and historical branches).

**Migration:** existing conversations keep `conversation.acpSessionId` and continue to work as a single shared session. Forking only activates for *new* branches created after this feature ships.

### Close on conversation delete

In `chat-store.deleteConversation(id)`:

1. Before removing the conversation, read its `acpSessionId` (and any per-branch session IDs once implemented).
2. For each live session, fire `acp_session_close(instanceId, sessionId)` as a best-effort background call. Ignore errors — the conversation is being deleted regardless.
3. Skip if the agent doesn't advertise `close` capability — nothing to call.

Keep it synchronous-from-the-user's-view but asynchronous-to-the-agent: don't block the delete on the response.

### Affected paths

| Path | Change |
| --- | --- |
| Chat panel (ACP sessions) | Restoration now prefers `resume`; branching from the active leaf calls `fork`; conversation delete calls `close`. |
| Delegation panel (agent tasks) | `useAgentTaskOperations` is not affected — task agents don't persist across restarts, so fork/resume don't apply. `close` could be added for task completion, but out of scope. |
| Direct API chat | No change — direct API has no session concept. |
| Copilot LSP | No change — uses its own `conversation/*` namespace. |

## Data Model

```typescript
// src/lib/ai/acp-utils.ts
export interface AcpSessionInfo {
  session_id: string;
  cwd?: string;
}

export interface AcpListResult {
  sessions: AcpSessionInfo[];
  next_cursor: string | null;
}

// Extend existing AcpAgentCapabilities
export interface AcpAgentCapabilities {
  load_session?: boolean;
  prompt_capabilities?: { image?: boolean };
  session_capabilities?: {
    list?: boolean;
    fork?: boolean;
    resume?: boolean;
    close?: boolean;
  };
  [key: string]: unknown;
}

// src/stores/chat-store.ts — Conversation
export interface Conversation {
  // ...existing fields
  /** ACP session ID shared by the conversation (pre-fork behavior, and fallback for historical branches). */
  acpSessionId?: string;
  /** Per-branch ACP session IDs, keyed by leaf message ID. Populated only when fork is used. */
  branchSessions?: Record<string, string>;
}
```

## Dependencies

- No new npm packages
- Four additional Cargo features on `agent-client-protocol` + `agent-client-protocol-schema` (all unstable but already vendored in the pinned version)

## Quality Gates

- [x] Enabling the three unstable features (`session_close`, `session_fork`, `session_resume` — `session_list` is stable) does not break any existing ACP functionality (`cargo test` in `src-tauri/` green, 611 tests pass)
- [x] Capability probe correctly reads `sessionCapabilities.{list, fork, resume, close}` via `hasSessionCapability()` helper
- [ ] Connection config UI shows which of list/fork/resume/close are supported *(explicitly not done — nice-to-have, deferred)*
- [x] `session/close` fires on conversation delete when capability is present; errors silently tolerated
- [x] `session/resume` is preferred over `session/load` on restart; falls back gracefully on either failure
- [x] `session/list` is called as a verification step when resume/load both fail, to decide between retry and fresh session
- [x] `session/fork` is called when branching from the **active leaf** and the capability is present
- [x] Historical branches (non-leaf branching) continue to work as-is *(UI info note deferred — minor polish)*
- [x] Per-branch `acpSessionId` resolution works correctly on branch switch (prompts route to the right agent session via `resolveActiveSessionId` / `getSessionIdForLeaf`)
- [x] Existing conversations (pre-fork) keep working — no migration required (field is optional)
- [x] Unit tests for the capability probe, restoration fallback chain, and branch-session resolution (37 new tests across 3 files)
- [ ] Integration test with a live ACP agent that spawns, closes a session, and confirms acknowledgment *(manual — requires a connected agent; skipped in automated CI)*

## Out of Scope

- Graceful close-all on app quit (existing SIGKILL path is sufficient)
- Close on agent switch (existing provider isolation handles context separation at the chat-store level)
- MCP server passthrough (deferred to its own batch)
- A dedicated "agent sessions" browser UI
- Historical-message branching with agent state rewind (not expressible in ACP)
- Pagination UI for `session/list` (we only need "exists?" — a single page is sufficient; we'll cap requests at one page)
