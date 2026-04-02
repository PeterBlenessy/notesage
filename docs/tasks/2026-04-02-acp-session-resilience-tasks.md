# ACP Session Resilience — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-02 |
| **Status** | Not started |
| **PRD** | [acp-session-resilience](../prds/2026-04-02-acp-session-resilience.md) |
| **Total** | 10 tasks: 3S, 5M, 2L |
| **Suggested order** | Backend (#1-#2) → Frontend lifecycle (#3-#6) → UI (#7-#8) → Polish (#9) → Tests (#10) |

**Risks:**

- `session/load` depends on the agent having persisted its session. If the agent crashed before persisting, `session/load` will fail — the fallback must handle this gracefully (fresh session with system prompt, not a crash loop).
- The `acp-agent-exited` event must fire reliably across all exit paths (normal exit, crash, SIGKILL). The agent thread's command loop exits when `cmd_rx` closes or the child exits — we need to detect the child exit from within the loop AND after the loop ends.
- Reusing the existing assistant message for retry requires careful handling: clear partial segments/content without losing the message itself, avoid duplicate text if some content was already streamed.

---

### #1 — Emit `acp-agent-exited` Tauri event on process death

**Description:** When the ACP agent process exits (for any reason — crash, SIGKILL, normal exit), emit an `acp-agent-exited` event with the instance ID and exit status. This enables the frontend to detect crashes instantly instead of waiting for the prompt timeout.

**Complexity:** M
**Category:** backend
**Dependencies:** None
**Files:**
- `src-tauri/src/commands/acp.rs` — detect child process exit in the agent thread, emit event via the `AppHandle`

**Acceptance criteria:**
- Event payload: `{ instanceId: string, exitCode: number | null, signal: string | null }`
- Emitted when child process exits during an active prompt (crash detection)
- Emitted when child process exits outside a prompt (background death)
- The event fires within seconds of process death, not after a timeout
- Does not fire on intentional `Stop` command (user-initiated kill) — only unexpected exits
- Agent thread cleanup (network proxy, etc.) still runs after event emission

---

### #2 — Add `acp_is_agent_alive` Tauri command

**Description:** Add a lightweight command that checks if a specific ACP agent's process is still running. The frontend calls this when the unresponsive timer fires to decide whether to show "still running" or "process died" UI.

**Complexity:** S
**Category:** backend
**Dependencies:** None
**Files:**
- `src-tauri/src/commands/acp.rs` — new command checking if the agent handle exists and thread is alive
- `src-tauri/src/lib.rs` — register the new command

**Acceptance criteria:**
- `acp_is_agent_alive(instanceId) → Result<bool, String>`
- Returns `true` if the agent handle exists in the state map and the thread handle is not finished
- Returns `false` if the handle is missing or the thread has completed
- Lightweight — no IPC to the agent, just checks the handle

---

### #3 — Replace auto-kill recovery with user decision flow

**Description:** Remove the `acpRecoverAgent` function that auto-kills and reconnects. Replace with a flow that: (a) checks if agent is alive, (b) if alive, sets a store flag to show the unresponsive banner, (c) if dead, sets a store flag to show the "exited" error card.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #2
**Files:**
- `src/hooks/useAcpLifecycle.ts` — replace `acpRecoverAgent` callback, update timer callback, add `acp-agent-exited` event listener
- `src/stores/chat-store.ts` — add `pendingAgentAction` state (or use existing system-status mechanism)

**Acceptance criteria:**
- Timer fires → calls `acp_is_agent_alive` → alive: sets store state for unresponsive banner; dead: sets store state for exited card
- `acp-agent-exited` event listener during active prompt → immediately sets exited state (no timer wait)
- No automatic SIGKILL on unresponsive timer (the user chooses)
- The `onUnresponsiveCallback` no longer calls `acpRecoverAgent` — it triggers the check + banner flow
- Timer continues to reset on each ACP event (existing `resetUnresponsiveTimer` behavior unchanged)

---

### #4 — Update retry flow: same-branch, reuse assistant message

**Description:** When the user clicks "Retry session" (from banner or error card), the retry must: (a) not create a new branch, (b) reuse the existing assistant message (clear its partial content/segments), (c) continue streaming into it.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #3
**Files:**
- `src/hooks/useAcpLifecycle.ts` — new `retryWithRestore` function replacing the auto-retry in `catch` block
- `src/stores/chat-store.ts` — may need a `resetAssistantMessage(timestamp)` action to clear content/segments without removing the message

**Acceptance criteria:**
- Retry does NOT call `branchFromMessage` — appends to the current leaf
- The existing assistant message (which may have partial content from before the crash) is cleared and reused
- If the assistant message has `isError: true`, clear the error state
- Segments array is reset to `[]` on the reused message
- `content` is reset to `''` on the reused message
- The streaming cursor appears on the reused message as if it were a new response

---

### #5 — Use `acp_agent_reconnect` + `session/load` for context restoration

**Description:** Wire the retry flow to use the existing `acp_agent_reconnect` Rust command (which spawns a new agent, re-authenticates, and calls `session/load`). Handle the case where `session/load` fails (agent didn't persist) by falling back to a fresh session with system prompt.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #4
**Files:**
- `src/hooks/useAcpLifecycle.ts` — `retryWithRestore` calls `acp_agent_reconnect`, falls back to fresh session on failure
- `src/stores/chat-store.ts` — update segment session ID tracking after reconnect

**Acceptance criteria:**
- `retryWithRestore` calls `invoke('acp_agent_reconnect', { instanceId, sessionId })` 
- On success: updates agent singleton with new instance ID, sets up new listeners, resends last user prompt
- On `session/load` failure: falls back to `acp_session_new` + system prompt prefix (same as first message in a new session)
- Conversation segment's `sessionId` is updated to the new session
- The `ConversationSegment.historyIncluded` flag is respected — if the current segment started fresh, only messages from the current segment are relevant for fallback context

---

### #6 — Handle "Keep waiting" and "Cancel" actions

**Description:** Wire the "Keep waiting" and "Cancel" buttons from the unresponsive banner. Keep waiting: dismiss banner, reset timer. Cancel: send ACP cancel, stop loading, keep conversation.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #3
**Files:**
- `src/hooks/useAcpLifecycle.ts` — expose `keepWaiting` and `cancelPrompt` callbacks
- Store or component state for banner visibility

**Acceptance criteria:**
- **Keep waiting**: Clears the banner/store state, resets the unresponsive timer. Agent continues undisturbed. No process kill.
- **Cancel**: Calls `invoke('acp_session_cancel', { instanceId, sessionId })`. Runs cleanup (listeners, loading state). Does NOT kill the agent process — it stays alive for future messages.
- After cancel, the partially-streamed assistant message retains whatever content was received (not cleared)
- `finalizeSegments` is called on cancel so segments don't show running spinners

---

### #7 — Create `AgentStatusBanner` component

**Description:** Build the chat-panel banner that shows when the agent is unresponsive or has exited. Two variants: "unresponsive but alive" (3 buttons: Wait, Retry, Cancel) and "exited" (2 buttons: Restart, Cancel).

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #3, #4, #6
**Files:**
- `src/components/chat/AgentStatusBanner.tsx` — new component
- `src/components/chat/ChatMessageList.tsx` — render the banner above the message list or at the bottom

**Acceptance criteria:**
- **Unresponsive variant**: Shows elapsed time ("Agent hasn't responded in 5m12s"), "still running" note, three buttons
- **Exited variant**: Shows "Agent process exited unexpectedly" with exit code if available, two buttons
- Buttons wire to callbacks from `useAcpLifecycle` (keepWaiting, retryWithRestore, cancelPrompt)
- Styled consistently with `ReconnectCard` — muted background, rounded corners, compact
- Banner dismisses automatically when the agent resumes sending events (timer reset clears the state)
- Light/dark mode correct

---

### #8 — Remove old `ReconnectCard` system-status flow for unresponsive recovery

**Description:** Clean up the old `addSystemStatus('reconnecting'/'reconnected'/'failed')` flow that was used by `acpRecoverAgent`. The `ReconnectCard` component and system-status messages for reconnection are replaced by `AgentStatusBanner`.

**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #7
**Files:**
- `src/hooks/useAcpLifecycle.ts` — remove `addSystemStatus` calls from recovery path
- `src/components/chat/ChatMessage.tsx` — keep `ReconnectCard` for backward compat with persisted system-status messages, but no new ones are created for unresponsive recovery

**Acceptance criteria:**
- No new system-status messages inserted during unresponsive/exited handling
- Old persisted system-status messages in existing conversations still render via `ReconnectCard` (backward compat)
- The `addSystemStatus` action stays in the store (used elsewhere?) but is not called from the recovery flow
- No dead code left from the old `acpRecoverAgent` function

---

### #9 — Update auto-retry on connection errors to use same-branch restore

**Description:** The existing `catch` block in `acpSendChatMessage` auto-retries once on connection errors (dead agent, broken pipe). Update this to use the same `retryWithRestore` function instead of its own inline retry — same-branch, session/load, reuse message.

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #5
**Files:**
- `src/hooks/useAcpLifecycle.ts` — replace the inline retry in the `catch` block with a call to `retryWithRestore`

**Acceptance criteria:**
- Connection errors (`isAcpConnectionError`) trigger `retryWithRestore` instead of inline respawn
- Same-branch behavior: no `branchFromMessage`
- Context restored via `session/load` with fallback
- If retry also fails, show error on the assistant message (same as current behavior)
- Only one retry attempt (same as current), not a loop

---

### #10 — Tests for session resilience

**Description:** Write tests covering the new lifecycle flows: timer → alive check → banner, process exit → exited card, retry with same-branch, cancel preserving content.

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #3, #4, #5, #6
**Files:**
- `src/hooks/__tests__/useAcpLifecycle-resilience.test.ts` — new test file

**Acceptance criteria:**
- Timer fires + agent alive → unresponsive banner state set (not auto-kill)
- Timer fires + agent dead → exited state set
- `acp-agent-exited` event → exited state set immediately
- Keep waiting → timer reset, banner dismissed
- Cancel → `acp_session_cancel` called, loading stopped, content preserved, segments finalized
- Retry → `acp_agent_reconnect` called, same assistant message reused, no branch created
- Retry with `session/load` failure → falls back to fresh session with system prompt
- `resetAssistantMessage` clears content and segments but preserves the message in the conversation
