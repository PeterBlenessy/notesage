# PRD: ACP Agent Automatic Recovery

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Users can continue chatting after an agent becomes unresponsive, instead of losing the conversation |
| **Bug** | [acp-agent-hang-deadlock](../bugs/2026-03-30-acp-agent-hang-deadlock.md) |
| **Tasks** | [acp-agent-recovery-tasks](../tasks/2026-03-31-acp-agent-recovery-tasks.md) |

## Problem

When the ACP agent subprocess stops responding — typically because the upstream AI provider API is unavailable or timing out — the chat becomes permanently stuck. The user sees an infinite spinner, the stop button has no effect, follow-up messages hang, and the only escape is force-quitting the app.

This is particularly likely during API availability disturbances, which Anthropic has experienced multiple times in recent months. The current architecture treats the agent subprocess as always-cooperative: cancel is a polite notification that the subprocess can ignore, and there is no timeout, escalation, or recovery mechanism.

The result is a dead conversation with no way back. The user loses their context and has to restart from scratch.

## Goals

1. **Detect unresponsive agents** — recognize when a prompt has produced no activity for a reasonable period and surface this to the user, rather than spinning forever
2. **Transparent auto-recovery** — kill the hung subprocess, respawn the agent, reload the session, and continue the conversation without user intervention
3. **Graceful degradation when recovery fails** — after repeated failures, give the user clear information and control over what happens next
4. **Clean app quit** — the app must never hang on quit due to an unresponsive agent

## Non-Goals

- Diagnosing *why* the upstream API is unavailable (that's the provider's problem)
- Automatically switching providers without user consent
- Automatically resending the user's message after recovery — the user resends via the message resend button (see [chat-message-resend-edit PRD](2026-03-31-chat-message-resend-edit.md))
- Handling partial-response stalls (agent was streaming text and stopped mid-sentence) — this is a different, less common failure mode that can be addressed later
- Offline mode or message queuing for later delivery

## User Stories

- As a user chatting with an AI agent, I want the app to recover automatically when the agent gets stuck, so I don't have to force-quit and lose my conversation
- As a user, I want to know when something went wrong and what the app is doing about it, so I don't feel confused by a silent spinner
- As a user, if recovery keeps failing, I want clear options (retry, switch provider) so I can make an informed decision instead of being stuck
- As a user, I want to be able to quit the app at any time, even if an agent is hung

## User Experience

### Phase 1: Detection (0–60 seconds after sending a message)

The user sends a message. The agent begins processing. The user sees the normal loading state (typing indicator / spinner).

After **60 seconds** with zero `session_notification` events from the agent, the app considers the agent unresponsive.

**Why 60 seconds:** Long enough that legitimate slow responses (complex tool chains, thinking time) are not falsely flagged. Short enough that the user doesn't sit confused for minutes. Some ACP agents (Claude Code) can take 30–45 seconds on complex operations with tool calls, so 60 seconds provides headroom.

### Phase 2: Automatic recovery (transparent, \~60–120 seconds)

The chat shows an inline system message:

> **Connection interrupted** — reconnecting to Claude Code...

The app performs up to **3 reconnection attempts** with backoff:

| Attempt | Delay before attempt | Total elapsed |
| --- | --- | --- |
| 1 | 5 seconds | \~65s |
| 2 | 15 seconds | \~80s |
| 3 | 30 seconds | \~110s |

Each attempt:

1. Kills the hung subprocess (SIGKILL)
2. Spawns a fresh `claude-agent-acp` process
3. Authenticates (reuses stored credentials)
4. Calls `session/load` with the existing session ID
5. If successful: updates the inline message to "Reconnected" (auto-dismisses after 3 seconds), chat is ready for the user to resend their message

The inline message updates with attempt progress:

> **Connection interrupted** — reconnecting to Claude Code (attempt 2 of 3)...

If any attempt succeeds, the user's chat is back to a working state. The last user message that was never answered remains visible in the chat. The user can click the resend button on that message to retry, or type something new.

### Phase 3: Manual recovery (after 3 failed attempts)

If all 3 reconnection attempts fail, the inline system message changes to:

> **Unable to reach Claude Code** — this is likely an API availability issue.
>
> \[ Retry \] \[ Switch provider... \]

**Retry button:** Each click performs one reconnection attempt (same kill → spawn → auth → load flow). If it succeeds, the message updates to "Reconnected" and the chat continues. If it fails, the message returns to the failed state with the buttons.

**Switch provider button:** Opens a compact inline picker showing other connections configured for the `interactive` routing slot. Each option is labeled with provider name and a note about compatibility:

- Connections using the same upstream API (e.g., "Anthropic Direct" when Claude Code is down) are shown with a muted note: "Same backend — may have the same issue"
- Connections using a different provider (e.g., "OpenAI", "Ollama") are shown normally
- If no other connections are configured, this button is hidden

Switching provider mid-conversation follows the existing `AgentSwitchCard` flow — the user is asked whether to start fresh or carry history forward. The conversation messages are preserved in either case.

### App quit behavior

Regardless of agent state, Cmd+Q must always work:

- `stop_all_sync` kills agent subprocesses directly (SIGKILL) rather than sending cooperative stop commands
- Thread join has a 500ms timeout — if the agent thread doesn't exit, it is abandoned (OS cleans up on process exit)
- No user-visible change — the app just closes promptly

### Stop button behavior

The stop button in the chat input should also be improved:

- First click: sends ACP `session/cancel` notification (existing behavior)
- If no response within **5 seconds**: escalates to SIGKILL, treats the agent as hung, and enters the automatic recovery flow (Phase 2)

This means a single stop-click that doesn't work self-heals within a few seconds, rather than requiring the user to figure out that the agent is stuck.

## Technical Approach

### Unresponsiveness detection

**Frontend timer in** `useAcpLifecycle`**:**

- Start a 60-second timer when a prompt is sent via `acp_session_prompt`
- Reset the timer on every `acp-session-update` event for the active instance
- If the timer fires: mark the agent as unresponsive, begin recovery

**Why frontend, not backend:** The frontend owns the chat UX and the inline message display. The backend agent thread may itself be stuck, so detection must not depend on it.

### Recovery flow

**New Tauri command:** `acp_agent_reconnect`

Accepts an `instance_id` and `session_id`. Performs:

1. Kill the current subprocess (SIGKILL via process ID, not through the command channel)
2. Clean up the agent thread (drop handle, abandon if stuck)
3. Spawn a fresh agent subprocess with the same binary, args, and sandbox config
4. Re-authenticate using the same method
5. Call `session/load` with the provided session ID
6. Return the new instance ID (the old one is invalidated)

The frontend updates its `acpAgent` state with the new instance ID and resumes normal operation.

**Failure modes:**

- Subprocess fails to spawn → immediate failure, surface to user
- Authentication fails → immediate failure (credentials may have expired — surface to user)
- `session/load` fails → the session may not be resumable; surface to user, offer to start a new conversation
- `session/load` succeeds but next prompt also times out → counts as another failure, retry loop continues

### Stop button escalation

**Frontend timer in** `useAcpLifecycle.acpCancelChat`**:**

- After calling `acp_session_cancel`, start a 5-second escalation timer
- If no `acp-session-update` with `stop_reason: cancelled` arrives within 5 seconds, treat as hung and enter the recovery flow

### App quit fix

`AcpState::stop_all_sync` **changes:**

- For each agent: send SIGKILL directly to the child process PID (stored in `AgentHandle`) rather than sending `AgentCmd::Stop` through the channel
- Use `thread::JoinHandle::join` with a timeout (500ms). Rust's `JoinHandle` doesn't have a native timeout, so use a condvar-with-timeout or simply don't join (let the OS clean up on process exit)
- This is a shutdown path — correctness matters less than promptness

### Inline system messages

Add a new message type to `chat-store`:

```typescript
interface SystemMessage {
  id: string;
  role: 'system-status';
  type: 'reconnecting' | 'reconnected' | 'failed';
  attempt?: number;
  maxAttempts?: number;
  timestamp: number;
}
```

These messages are rendered inline in the chat but are **not** sent to the AI provider. They are transient — `reconnecting` messages are replaced in-place as the state changes, and `reconnected` messages auto-dismiss after 3 seconds.

A new `ReconnectCard` component renders the appropriate state:

- `reconnecting`: spinner + "Reconnecting (attempt N of 3)..."
- `reconnected`: checkmark + "Reconnected" (fades out)
- `failed`: error icon + message + Retry/Switch buttons

## Quality Gates

- [x] Agent hang detected within 60 seconds of inactivity

- [x] Automatic recovery succeeds when the underlying issue is transient (agent respawns and session loads)

- [x] After 3 failed recovery attempts, user sees clear message with Retry and Switch options

- [x] Retry button triggers one recovery attempt per click

- [x] Switch provider button shows available alternatives with compatibility notes

- [x] Stop button escalates to kill after 5 seconds of no response

- [x] App quit (Cmd+Q) completes within 1 second regardless of agent state

- [x] No conversation messages are lost during recovery

- [x] Recovery flow works for all ACP agents (Claude Code, Codex, Copilot, Gemini CLI)

- [x] Inline system messages do not get sent to the AI provider as conversation context

- [x] Reconnected state auto-dismisses after 3 seconds

- [x] Chat remains functional after successful recovery (user can send new messages)