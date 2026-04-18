# ACP Session Lifecycle Completeness — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-17 |
| **Status** | Complete ✅ |
| **PRD** | [acp-session-lifecycle-completeness](../prds/2026-04-17-acp-session-lifecycle-completeness.md) |
| **Audit** | [acp-audit](../audits/2026-04-14-acp-audit.md) — Batch C |
| **Total** | 13 tasks: 9S, 4M |
| **Suggested order** | Cargo (#1) → Types (#2) → Backend commands (#3-#6) → Frontend API wrappers (#7) → Store model (#8) → Restoration (#9) → Fork branching (#10) → Close on delete (#11) → Tests (#12) → Docs (#13) |

**Risks / open questions:**

- Three of the four methods are behind `unstable_session_*` Cargo features (`close`, `fork`, `resume`). `session/list` is actually stable in both crates (no feature flag). The PRD and initial task text incorrectly listed `unstable_session_list` — corrected during implementation.
- Agents may implement `session/resume` and `session/load` with different semantics (resume = live takeover vs load = replay). The fallback chain must tolerate both.
- Fork semantics: ACP `session/fork` forks from the **current** agent-side state — not from an arbitrary historical message. Only "branch from active leaf" gets a true isolated session. Historical-message branches share the parent session's timeline, with a small UI note.
- Backend command tasks (#3–#6) all touch the same files (`src-tauri/src/commands/acp.rs`, `src-tauri/src/lib.rs`). Do them sequentially in one worktree, not parallel.
- Frontend lifecycle tasks (#9–#11) all touch `useAcpLifecycle.ts` and `chat-store.ts`. Also sequential.

---

## Phase 1 — Protocol Surface

### #1 — Enable unstable Cargo features ✅

**Description:** Add `unstable_session_close`, `unstable_session_list`, `unstable_session_fork`, `unstable_session_resume` to the feature lists for both `agent-client-protocol` and `agent-client-protocol-schema` in `src-tauri/Cargo.toml`. This unblocks all subsequent backend work.

**Acceptance criteria:**
- Both crates list all four new unstable features alongside the existing `unstable_session_model`, `unstable_session_usage`
- `cd src-tauri && cargo check` passes cleanly
- `cd src-tauri && cargo test` still passes — no regression
- No functional change yet

**Complexity:** S
**Category:** backend
**Dependencies:** None
**Files:**
- `src-tauri/Cargo.toml`

---

### #2 — Type session sub-capabilities in `AcpAgentCapabilities` ✅

**Description:** The backend already passes `AgentCapabilities` to the frontend as raw `serde_json::Value`, so no Rust change is needed. Replace the loose `session_capabilities?: Record<string, unknown>` in the frontend type with a precise shape so downstream code can gate cleanly.

**Acceptance criteria:**
- `AcpAgentCapabilities` in `src/lib/ai/acp-utils.ts` has `session_capabilities?: { list?: boolean; fork?: boolean; resume?: boolean; close?: boolean }`
  (each sub-field truthy means the agent advertised that capability; ACP sends each as `Option<...Capabilities>`, which serializes to `null` / object — treat any non-null object as `true`)
- A helper `hasSessionCapability(caps, 'list' | 'fork' | 'resume' | 'close'): boolean` lives in `acp-utils.ts`
- Unit tests cover: capability present (object), capability absent (undefined), capability absent (null)
- TypeScript type check passes

**Complexity:** S
**Category:** frontend
**Dependencies:** None (can parallel with #1)
**Files:**
- `src/lib/ai/acp-utils.ts` — tighten the type, add `hasSessionCapability`
- `src/lib/ai/__tests__/acp-utils.test.ts` — add tests

---

## Phase 2 — Backend Tauri Commands

### #3 — Add `acp_session_close` command ✅

**Description:** Implement a best-effort session close. Follows the `acp_session_load` pattern in `src-tauri/src/commands/acp.rs`. Capability-gated: if the agent didn't advertise `session_capabilities.close`, return an error (the frontend will swallow it).

**Acceptance criteria:**
- New `pub async fn acp_session_close(state, instance_id, session_id) -> Result<(), String>` in `commands/acp.rs`
- Routes through the existing agent thread (matching the `load_session` / `new_session` pattern)
- Registered in `generate_handler![]` in `src-tauri/src/lib.rs`
- Rust unit test that calls the command on a mock agent and asserts the expected JSON-RPC method name is emitted
- `cargo check` + `cargo test` pass

**Complexity:** S
**Category:** backend
**Dependencies:** #1
**Files:**
- `src-tauri/src/commands/acp.rs`
- `src-tauri/src/lib.rs`
- Tests alongside existing `acp.rs` tests

---

### #4 — Add `acp_session_list` command ✅

**Description:** List sessions with optional `cwd` filter and pagination cursor. Returns `{ sessions: Vec<SessionInfo>, next_cursor: Option<String> }`.

**Acceptance criteria:**
- New `pub struct ListResult { sessions: Vec<SessionInfo>, next_cursor: Option<String> }` and `pub struct SessionInfo { session_id: String, cwd: Option<String> }` in `commands/acp.rs`
- New `pub async fn acp_session_list(state, instance_id, cwd: Option<String>, cursor: Option<String>) -> Result<ListResult, String>`
- Capability-gated on `session_capabilities.list`
- Registered in `generate_handler![]`
- Rust unit test for the capability gate
- `cargo check` + `cargo test` pass

**Complexity:** S
**Category:** backend
**Dependencies:** #1
**Files:**
- `src-tauri/src/commands/acp.rs`
- `src-tauri/src/lib.rs`

---

### #5 — Add `acp_session_resume` command ✅

**Description:** Resume an existing session by ID. Takes over a live agent-side session without replay. Returns the same `SessionResult` shape as `acp_session_new` / `acp_session_load` (modes, models, config_options).

**Acceptance criteria:**
- New `pub async fn acp_session_resume(state, instance_id, session_id, working_directory) -> Result<SessionResult, String>`
- Capability-gated on `session_capabilities.resume`
- Registered in `generate_handler![]`
- Populates `SessionResult` from the `ResumeSessionResponse` — modes, models (if `unstable_session_model`), config_options
- Rust unit test for the command
- `cargo check` + `cargo test` pass

**Complexity:** M
**Category:** backend
**Dependencies:** #1
**Files:**
- `src-tauri/src/commands/acp.rs`
- `src-tauri/src/lib.rs`

---

### #6 — Add `acp_session_fork` command ✅

**Description:** Fork an existing session, returning a new session ID that inherits the current agent state. Returns `SessionResult` (same shape as resume/new/load).

**Acceptance criteria:**
- New `pub async fn acp_session_fork(state, instance_id, session_id, working_directory) -> Result<SessionResult, String>`
- Capability-gated on `session_capabilities.fork`
- Registered in `generate_handler![]`
- Populates `SessionResult` from the `ForkSessionResponse`
- Rust unit test for the command
- `cargo check` + `cargo test` pass

**Complexity:** M
**Category:** backend
**Dependencies:** #1
**Files:**
- `src-tauri/src/commands/acp.rs`
- `src-tauri/src/lib.rs`

---

## Phase 3 — Frontend API Surface

### #7 — Frontend wrappers + `AcpSessionInfo` / `AcpListResult` types ✅

**Description:** Add Tauri API wrappers for all four new commands and the types they return.

**Acceptance criteria:**
- `src/lib/ai/acp-utils.ts` exports:
  ```ts
  export interface AcpSessionInfo { session_id: string; cwd?: string }
  export interface AcpListResult { sessions: AcpSessionInfo[]; next_cursor: string | null }
  ```
- `src/lib/tauri.ts` (or wherever `acpSessionLoad` / `acpSessionNew` live) adds:
  - `acpSessionClose(instanceId, sessionId): Promise<void>`
  - `acpSessionList(instanceId, cwd?, cursor?): Promise<AcpListResult>`
  - `acpSessionResume(instanceId, sessionId, cwd): Promise<AcpSessionResult>`
  - `acpSessionFork(instanceId, sessionId, cwd): Promise<AcpSessionResult>`
- Wrappers invoke `acp_session_*` with the correct param names (camelCase on the invoke call, snake_case on the Rust side)
- TypeScript type check passes

**Complexity:** S
**Category:** frontend
**Dependencies:** #3, #4, #5, #6
**Files:**
- `src/lib/ai/acp-utils.ts`
- `src/lib/tauri.ts` (or the file holding `acpSessionLoad`)

---

## Phase 4 — State Model

### #8 — Add `branchSessions` to `Conversation` + resolver ✅

**Description:** Prepare the chat store to track per-branch ACP session IDs. Existing conversations continue to rely on the shared `acpSessionId`; forked branches get their own ID keyed by leaf.

**Acceptance criteria:**
- `Conversation` in `src/stores/chat-store.ts` gains `branchSessions?: Record<string, string>` (leaf-message-id → session-id)
- New exported helper `getSessionIdForLeaf(conv: Conversation, leafId: string | null): string | undefined`:
  - If `leafId` is null or there's no match in `branchSessions`, walk up the parent chain (via `getThread`) and return the first branch-specific session found
  - Falls back to `conv.acpSessionId` when no branch session matches
- Unit tests cover: null leaf, exact match, ancestor match, fallback to conv-level ID, missing entirely (returns undefined)
- Zustand persist migration: no migration needed (the new field is optional) — add a version bump only if other changes justify it
- TypeScript type check passes

**Complexity:** S
**Category:** frontend
**Dependencies:** None (can parallel with #1–#7)
**Files:**
- `src/stores/chat-store.ts`
- `src/stores/__tests__/chat-store.test.ts` (or an existing test file)

---

## Phase 5 — Lifecycle Behavior

### #9 — Restoration flow: resume → load → list → new ✅

**Description:** Rework the restoration block in `useAcpLifecycle.ts` (around line 218–243) to prefer `session/resume`, fall back to `session/load`, use `session/list` as a sanity check on double failure, and fall back to `session/new` last.

**Acceptance criteria:**
- If the stored session ID exists AND `session_capabilities.resume`: try `acpSessionResume`; on success, use it
- On resume failure (or no resume capability) AND `load_session`: try `acpSessionLoad` (existing path)
- If both fail: when `session_capabilities.list` is present, call `acpSessionList({ cwd })`; if the stored session ID isn't in the result, don't retry — just fall through to `new`
- Fall back to `acpSessionNew` as the final step
- Each branch logs at `info` level (preserve existing log pattern)
- The flow works identically for the eager session creation path and the prompt-send path (both currently go through the same restoration block)
- Unit tests mock `tauriApi` and cover all 4 branches: resume success, resume fail + load success, both fail + list confirms missing, both fail + list absent → new

**Complexity:** M
**Category:** frontend
**Dependencies:** #2, #7
**Files:**
- `src/hooks/useAcpLifecycle.ts`
- `src/hooks/__tests__/useAcpLifecycle.test.ts` (add or create)

---

### #10 — Branching via fork (active leaf only) ✅

**Description:** When the user branches from the active leaf and the agent advertises `fork` capability, call `session/fork` and store the new session ID under the new branch's leaf. Historical-message branches fall through to the existing shared-session behavior.

**Acceptance criteria:**
- Identify the branch call site (likely `branchFromMessage` in `chat-store.ts` or the "Branch from here" button handler)
- When the branch point is the **active leaf** AND `session_capabilities.fork` AND the conversation has a live `acpSessionId`:
  1. Call `acpSessionFork(instanceId, currentSessionId, cwd)`
  2. Store the returned `session_id` in `conv.branchSessions[newLeafId]`
  3. On send, resolve the session ID via `getSessionIdForLeaf` (from #8) so prompts route to the forked session
- Otherwise: keep existing behavior (shared session)
- Fork errors (e.g., capability present but agent rejects) fall back to shared session with a toast warning
- Prompt-send path in `useAcpLifecycle.ts` / `ChatPanel.tsx` uses `getSessionIdForLeaf` when sending
- Unit tests: leaf-branch with fork capability → fork called; leaf-branch without fork capability → fork not called; historical branch → fork not called
- Manual test: branch twice from different leaves with an agent that supports fork, verify each branch has its own session ID in the debug log

**Complexity:** M
**Category:** frontend
**Dependencies:** #7, #8, #9
**Files:**
- `src/stores/chat-store.ts`
- `src/hooks/useAcpLifecycle.ts` — update prompt-send to use `getSessionIdForLeaf`
- `src/components/chat/ChatMessage.tsx` or wherever branch buttons live
- tests

---

### #11 — Close on conversation delete ✅

**Description:** When a conversation is deleted, best-effort close its agent session(s) so the agent can release resources.

**Acceptance criteria:**
- `deleteConversation(id)` in `chat-store.ts`:
  1. Before removing the conversation, collect all session IDs: `conv.acpSessionId` plus values of `conv.branchSessions`
  2. For each session, fire `acpSessionClose(instanceId, sessionId).catch(() => {})` (best-effort, ignore errors)
  3. Skip entirely if the agent doesn't advertise `session_capabilities.close`
  4. Proceed with the deletion regardless of close results
- The user-facing delete is non-blocking (we don't await the close responses)
- Unit test that spies on `acpSessionClose` and confirms it's called with each session ID; a failing close doesn't prevent deletion

**Complexity:** S
**Category:** frontend
**Dependencies:** #7, #8
**Files:**
- `src/stores/chat-store.ts`
- tests

---

## Phase 6 — Verification & Docs

### #12 — Integration-style tests for the restoration chain ✅

**Description:** Add a dedicated test file that exercises the end-to-end restoration chain and the branch-session routing, beyond the inline unit tests in #8–#11. Catches interactions the smaller tests miss.

**Acceptance criteria:**
- New test file (e.g., `src/hooks/__tests__/useAcpLifecycle.lifecycle.test.ts` or extend the existing one) covering:
  - Resume success → no load/list/new calls
  - Resume fail, load success → no list/new calls
  - Resume + load fail, list confirms present → retry via new (note: PRD says "give up gracefully" — confirm with implementation)
  - Resume + load fail, list confirms absent → straight to new (no redundant retries)
  - No stored session → straight to new
  - Branch 1 uses forked session, branch 2 uses base session → prompts route correctly
- All tests run in under 2s (mock-based, no real IPC)
- `pnpm test` passes

**Complexity:** S
**Category:** frontend
**Dependencies:** #9, #10, #11
**Files:**
- `src/hooks/__tests__/` (new or extended file)

---

### #13 — Update documentation ✅

**Description:** Update architecture/feature docs and the audit to reflect the new capability.

**Acceptance criteria:**
- `docs/tauri-commands.md`: add the four new commands (`acp_session_close`, `acp_session_list`, `acp_session_resume`, `acp_session_fork`) with signatures, params, return types, events
- `docs/features/ai-providers.md`: update the ACP section to describe the restoration preference chain (resume → load → list → new), the fork-based branching behavior, and the close-on-delete flow
- `docs/audits/2026-04-14-acp-audit.md`:
  - Mark rows #14 (session/list), #18 (session/fork), #19 (session/resume), #20 (session/close) as ✅ in the feature matrix
  - Update the Session Lifecycle table (lines 74–80) with v0.35.0 status and notes
  - Update the audit header pipeline row for this PRD/tasks to "Implemented" and "Complete ✅"
  - Update the summary line (currently "38 of 59 features implemented (64%)")
- Mark this tasks file `Complete ✅` and tick corresponding PRD quality gates

**Complexity:** S
**Category:** docs
**Dependencies:** #12
**Files:**
- `docs/tauri-commands.md`
- `docs/features/ai-providers.md`
- `docs/audits/2026-04-14-acp-audit.md`
- `docs/prds/2026-04-17-acp-session-lifecycle-completeness.md`
- `docs/tasks/2026-04-17-acp-session-lifecycle-completeness-tasks.md`
