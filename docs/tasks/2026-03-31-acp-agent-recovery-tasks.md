# ACP Agent Automatic Recovery — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **PRD** | [acp-agent-recovery](../prds/2026-03-31-acp-agent-recovery.md) |
| **Total** | 10 tasks: 3S, 5M, 2L |
| **Suggested order** | Backend (#1-#3) -&gt; State/Types (#4-#5) -&gt; UI (#6-#8) -&gt; Integration (#9-#10) |

**Risks:**

- ACP `session/load` behavior may vary across agents (Claude Code, Codex, Copilot, Gemini CLI) — session resumption needs testing with each
- `ClientSideConnection` is `!Send`, so SIGKILL must happen on the agent's OS thread or via raw PID kill — can't simply call `child.kill()` from main thread
- Auth re-authentication on respawn may trigger browser OAuth flows for some agents (Copilot, Gemini CLI) — recovery UX degrades if auth is interactive

---

### #1 — Store child PID in AgentHandle for direct SIGKILL ✅

**Description:** Before spawning the agent thread, capture the child process PID and store it in `AgentHandle` so that recovery and quit flows can SIGKILL the subprocess directly, without going through the command channel (which may be stuck).

Currently `AgentHandle` has `cmd_tx` and `thread_handle` but no PID. The child `Process` is owned inside the agent thread closure and not accessible from outside.

**Acceptance criteria:**

- `AgentHandle` has a `child_pid: Arc<Mutex<Option<u32>>>` field
- Agent thread writes the child PID after spawning the subprocess
- PID is accessible from any thread via the `AcpState` map

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/acp.rs` (AgentHandle struct, run_agent_thread)

---

### #2 — Add `acp_agent_reconnect` Tauri command ✅

**Description:** Implement the core reconnection command that kills a hung agent, respawns it, re-authenticates, and resumes the session.

The command accepts `instance_id` and `session_id`. It:

1. Looks up the agent in `AcpState`, retrieves the child PID
2. Sends SIGKILL to the child process PID directly (bypasses command channel)
3. Joins/abandons the agent thread (500ms timeout — if stuck, just remove from map)
4. Spawns a fresh agent subprocess with the same binary, args, env vars, and sandbox config
5. Re-authenticates using stored method
6. Calls `session/load` with the provided session ID
7. Returns the new instance ID

Store the spawn config (binary path, args, env vars, sandbox config, working directory, connection details) in `AgentHandle` so reconnect can reproduce the same setup.

**Acceptance criteria:**

- `acp_agent_reconnect(instance_id, session_id)` Tauri command exists
- Returns `Result<SpawnResult, String>` with new instance ID
- Old subprocess is killed via SIGKILL (not cooperative stop)
- Thread join has 500ms timeout
- New agent spawned with identical config to original
- Session loaded via `session/load`
- Errors are descriptive (spawn failure, auth failure, session load failure)

**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/commands/acp.rs` (new command, AgentHandle additions for spawn config)
- `src-tauri/src/lib.rs` (register command in generate_handler)

---

### #3 — Fix `stop_all_sync` to use SIGKILL with thread join timeout ✅

**Description:** Change the app quit path to kill agent subprocesses directly via PID (SIGKILL) instead of sending cooperative `Stop` commands through the channel. Add a 500ms join timeout so the main thread never blocks indefinitely.

Currently `stop_all_sync` drops `cmd_tx` and calls `th.join()`, which blocks forever if the agent thread is stuck on I/O.

**Acceptance criteria:**

- `stop_all_sync` sends SIGKILL to each agent's child PID
- Thread join uses a 500ms timeout (spawn a helper thread with condvar, or just skip join and let OS clean up)
- App quit completes within 1 second regardless of agent state
- No behavioral change when agents are healthy (kill + short join still works)

**Complexity:** M **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/commands/acp.rs` (stop_all_sync)

---

### #4 — Add system-status message type to chat store ✅

**Description:** Add a `system-status` message role to the chat store for inline reconnection status messages. These messages are rendered in the chat but never sent to AI providers.

**Acceptance criteria:**

- `ChatMessage` type supports `role: 'system-status'`
- New fields: `statusType: 'reconnecting' | 'reconnected' | 'failed'`, `attempt?: number`, `maxAttempts?: number`
- Store has `addSystemStatus(statusType, attempt?, maxAttempts?)` action that inserts/updates system-status messages
- `reconnecting` messages are replaced in-place (same ID) when attempt number changes
- `reconnected` messages have a `dismissAt` timestamp (current time + 3s)
- System-status messages are excluded when building message arrays for AI providers (in `useDirectApiChat` and `useAcpLifecycle`)
- System-status messages are excluded from conversation export

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/ai/types.ts` (ChatMessage type extension)
- `src/stores/chat-store.ts` (addSystemStatus action, message filtering)

---

### #5 — Add unresponsiveness detection timer to `useAcpLifecycle` ✅

**Description:** Start a 60-second inactivity timer when a prompt is sent via ACP. Reset the timer on every `acp-session-update` event. If the timer fires, mark the agent as unresponsive and trigger the recovery flow.

**Acceptance criteria:**

- Timer starts when `acp_session_prompt` is called
- Timer resets on every `acp-session-update` event for the active instance
- Timer fires after 60 seconds of no events
- On fire: calls the recovery flow (task #9)
- Timer is cleared when the prompt completes normally, user cancels, or tab/component unmounts
- Timer does not fire for direct API chats (only ACP path)

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useAcpLifecycle.ts` (timer logic in acpSendChatMessage)
- `src/hooks/useAcpSessionListeners.ts` (timer reset on event)

---

### #6 — Build `ReconnectCard` component ✅

**Description:** Create the inline chat component that shows reconnection status: spinner during reconnection attempts, success checkmark, or failure state with Retry/Switch buttons.

**Acceptance criteria:**

- Three visual states: `reconnecting` (spinner + "Reconnecting to {agentName} (attempt N of 3)..."), `reconnected` (checkmark + "Reconnected", fades out after 3s), `failed` (error icon + message + action buttons)
- Retry button triggers `onRetry` callback
- Switch provider button triggers `onSwitchProvider` callback
- Switch button hidden if no alternative connections available
- Follows existing card patterns (PermissionCard, DomainApprovalCard) for styling
- Smooth transitions between states
- `reconnected` state auto-removes from chat after 3s (via store cleanup or component timer)

**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:**

- `src/components/chat/ReconnectCard.tsx` (new)
- `src/components/chat/ChatMessage.tsx` (render ReconnectCard for system-status messages)

---

### #7 — Build inline provider switcher for failed recovery ✅

**Description:** Implement the "Switch provider" flow that appears after recovery fails. Shows available connections for the `interactive` routing slot with compatibility notes.

**Acceptance criteria:**

- Compact inline picker (popover or expandable section, not a full dialog)
- Lists connections configured for the `interactive` slot from `routing-store` / `connections-store`
- Connections using the same provider as the failed agent show a muted note: "Same backend -- may have the same issue"
- Connections using different providers shown normally
- Selecting a connection triggers the existing `AgentSwitchCard` flow (start fresh or carry history)
- Hidden entirely if no alternative connections exist

**Complexity:** M **Category:** frontend **Dependencies:** #6 **Files:**

- `src/components/chat/ReconnectCard.tsx` (extend with provider picker)
- `src/stores/connections-store.ts` (read available connections)
- `src/stores/routing-store.ts` (read interactive slot)

---

### #8 — Add stop button escalation (5-second SIGKILL) ✅

**Description:** After the user clicks stop, if the agent doesn't respond within 5 seconds, escalate to SIGKILL and enter the recovery flow.

Currently `acpCancelChat` sends `acp_session_cancel` and immediately resets UI state. The agent may never actually stop.

**Acceptance criteria:**

- After `acp_session_cancel` is sent, a 5-second escalation timer starts
- If an `acp-session-update` with `stop_reason: cancelled` or `agent_turn_complete` arrives within 5s, timer is cleared (normal path)
- If timer fires: agent is treated as hung, recovery flow is triggered (same as inactivity detection)
- UI feedback: stop button shows a brief "Stopping..." state during the 5s window
- Timer is cleared on component unmount

**Complexity:** S **Category:** frontend **Dependencies:** #5, #9 **Files:**

- `src/hooks/useAcpLifecycle.ts` (acpCancelChat escalation)

---

### #9 — Implement frontend recovery orchestrator ✅

**Description:** Build the recovery orchestration logic that ties detection (task #5), reconnection (task #2), UI feedback (task #6), and escalation (task #8) together.

This is the core integration task. When the agent is detected as unresponsive:

1. Insert a `system-status` message (`reconnecting`, attempt 1 of 3)
2. Call `acp_agent_reconnect` Tauri command
3. On success: update message to `reconnected`, update `acpAgent` singleton with new instance ID, resume normal operation
4. On failure: increment attempt, wait backoff delay (5s, 15s, 30s), retry
5. After 3 failures: update message to `failed` with Retry/Switch buttons
6. Retry button: single attempt with same flow
7. Switch provider: delegate to existing provider switch mechanism

**Acceptance criteria:**

- Recovery runs up to 3 automatic attempts with backoff (5s, 15s, 30s)
- `acpAgent` singleton updated with new instance ID on success
- Chat session ID preserved (session/load restores context)
- System-status messages update in real time (attempt count, success, failure)
- After recovery, user can send new messages normally
- No conversation messages lost during recovery
- Recovery works for all ACP agents (Claude Code, Codex, Copilot, Gemini CLI)

**Complexity:** L **Category:** frontend **Dependencies:** #2, #4, #5, #6 **Files:**

- `src/hooks/useAcpLifecycle.ts` (recovery orchestration, new `acpRecoverAgent` function)
- `src/lib/ai/acp-agent-state.ts` (update singleton after reconnect)

---

### #10 — Write tests for recovery flows ✅

**Description:** Add unit tests covering the new recovery behavior: timer-based detection, reconnection command, system-status messages, stop escalation, and store filtering.

**Acceptance criteria:**

- Test: system-status messages are excluded from AI provider message arrays
- Test: system-status messages are excluded from conversation export
- Test: `addSystemStatus` action creates and updates messages correctly
- Test: `reconnecting` messages are replaced in-place on attempt change
- Test: `reconnected` messages have correct `dismissAt` timestamp
- Test: ReconnectCard renders all three states correctly
- Test: ReconnectCard hides Switch button when no alternatives exist

**Complexity:** S **Category:** frontend **Dependencies:** #4, #6 **Files:**

- `src/stores/__tests__/chat-store.test.ts` (system-status filtering)
- `src/components/chat/__tests__/ReconnectCard.test.tsx` (new)