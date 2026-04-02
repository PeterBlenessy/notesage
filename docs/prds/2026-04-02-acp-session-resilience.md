# PRD: ACP Session Resilience

|  |  |
| --- | --- |
| **Date** | 2026-04-02 |
| **Status** | Implemented |
| **Priority** | High |
| **Impact** | Agents are never killed while actively working; full conversation context is preserved across restarts; retry continues in the same branch |

## Problem

The current ACP agent lifecycle has three critical issues:

1. **Premature auto-kill.** A 5-minute unresponsive timer kills agents that are still alive but have gaps between events (thinking, long web fetches, large file reads). Backend logs confirm the agent was alive and working when killed — the health check showed `acp=1/1 alive` at the moment the timer fired.

2. **Context loss on restart.** When the agent is killed and restarted, the retry only sends the last user message with a fresh system prompt. The agent loses all prior conversation context — tool call results, research findings, files it read, decisions it made. This makes the retry functionally useless for complex multi-step tasks.

3. **Dead branches on retry.** The retry creates a new branch from the last message. The user lands on a "2 branches" indicator at the conversation root with no way back to the original thread. Subsequent retries compound the problem with more dead branches.

**Evidence from logs (2026-04-02):**

```
17:33:12  Last ACP tool_call event
17:34:12  60s timer fires → agent killed (was alive, health check confirms)
17:34:17  Reconnect + retry with fresh session (context lost)
17:37:51  Last event from retry, agent continues working...
18:04:20  30-minute backend timeout → retry also killed
```

The agent was actively researching (reading files, fetching URLs) and got interrupted twice.

## Goals

1. **Never auto-kill a working agent.** If the process is alive, don't kill it. Let the user decide.
2. **Preserve full context on restart.** Use ACP `session/load` (already implemented in Rust backend) to restore the conversation in a new agent process.
3. **Continue in the same branch.** Retries append to the current thread, not create new branches.
4. **Give users control.** When something goes wrong, show clear options — not automated guesses that make things worse.

## Non-Goals

- Changing the ACP protocol itself
- Implementing agent-side persistence (that's the agent's responsibility)
- Multi-agent orchestration or failover between different providers
- Offline queue / retry-when-online for network failures

## Design

### Remove auto-kill on unresponsive timer

**Current:** Timer fires after 5 minutes of no ACP events → `acpRecoverAgent()` → SIGKILL → respawn → retry.

**New:** Timer fires → check if process is alive via backend health check → if alive, show a non-blocking banner and let the user decide. If dead, show error with restart option.

The backend `acp_session_prompt` hard timeout stays at 30 minutes as a safety net for truly abandoned prompts (process alive but pipe broken, deadlocked, etc.).

### User-facing unresponsive banner

When the timer fires and the agent process is alive, show a subtle banner in the chat panel:

```
┌──────────────────────────────────────────────────┐
│  ⏳ Agent hasn't responded in 5 minutes.          │
│  The agent process is still running.              │
│                                                   │
│  [Keep waiting]  [Retry session]  [Cancel]        │
└──────────────────────────────────────────────────┘
```

- **Keep waiting**: Dismiss banner, reset timer. Agent continues undisturbed.
- **Retry session**: Kill agent, respawn, restore context via `session/load`, resend last prompt. Continue in same branch.
- **Cancel**: Stop the current prompt. Keep conversation as-is. Agent stays alive for future messages.

When the agent process is confirmed dead (process exit, broken pipe), skip the banner and show an error with automatic retry option:

```
┌──────────────────────────────────────────────────┐
│  ⚠ Agent process exited unexpectedly.             │
│                                                   │
│  [Restart & restore session]  [Cancel]            │
└──────────────────────────────────────────────────┘
```

### Context restoration via session/load

The Rust backend already has `acp_agent_reconnect` which:
1. Kills the old process
2. Spawns a fresh agent with the same config (binary, args, env, sandbox)
3. Re-authenticates
4. Calls `acp_session_load(session_id)` — the agent replays conversation history

The frontend retry flow should:

1. Call `acp_agent_reconnect` (existing command)
2. Update the module-level agent singleton with the new instance ID
3. Set up new event listeners
4. Resend the last user prompt (the one that was interrupted)
5. **Continue appending to the existing assistant message** — don't create a new one, don't branch

### Conversation context boundaries

When resending after reconnect, respect the conversation segment model:

- The `ConversationSegment` tracks which messages belong to which agent session
- If the user switched agents mid-conversation with "start fresh" (new segment, `historyIncluded: false`), only messages from the current segment are relevant
- If they chose "include history" (new segment, `historyIncluded: true`), all prior messages are relevant
- The `session/load` command handles this at the ACP protocol level — the agent decides what to replay based on its persisted session state

### Same-branch retry (no branching)

**Current:** Retry calls `branchFromMessage()` → creates a divergent branch → user sees "2 branches" and gets confused.

**New:** Retry does NOT branch. It either:
- Continues appending to the existing (partially-streamed) assistant message, OR
- If the assistant message has error content, clears it and reuses it for the retry response

The user sees a seamless continuation, not a branch point.

### Process death detection

Add proactive process exit detection alongside the existing timer:

1. **Backend**: When the agent process exits (detected by the thread's `child.wait()`), emit an `acp-agent-exited` Tauri event with `{ instanceId, exitCode }`.
2. **Frontend**: Listen for `acp-agent-exited` during active prompts. If received, immediately show the "Agent process exited" error card — don't wait for the prompt timeout.

This catches crashes instantly rather than waiting 5 minutes or 30 minutes.

## Implementation Plan

- [x] Add `acp-agent-exited` Tauri event emission on process death (Rust)

- [x] Replace auto-kill recovery with user-facing `AgentStatusBanner` component

- [x] Add process alive check (frontend → `acp_is_agent_alive` command)

- [x] Update retry flow to continue in same branch (no `branchFromMessage`)

- [x] Update retry flow to reuse/continue existing assistant message

- [x] Update retry flow to use `acp_agent_reconnect` + `session/load` for context restoration

- [x] Remove `acpRecoverAgent` auto-kill-and-reconnect function

- [x] Keep 5-minute unresponsive timer but change its action (show banner, not kill)

- [x] Keep 30-minute backend hard timeout as safety net

- [ ] Test: agent doing long research (many tool calls) is not interrupted

- [ ] Test: laptop close → reopen → agent state is recoverable

- [ ] Test: agent crash mid-conversation → restart preserves context

- [ ] Test: retry after error continues in same branch, no dead branches created

## Quality Gates

- [ ] Agent doing active tool calls for >5 minutes is never auto-killed

- [ ] User sees banner with options when agent is unresponsive but alive

- [ ] Agent process death is detected within seconds (not minutes)

- [ ] Retry after crash restores full conversation context via `session/load`

- [ ] Retry continues in the same branch — no new branches created

- [ ] Conversation segment boundaries are respected on context restoration

- [ ] Cancel stops the prompt without killing the agent

- [ ] Existing auto-approve permission flow still works after reconnect

- [ ] System status messages (reconnecting/reconnected) still display correctly

## Out of Scope

- Agent-side session persistence improvements (that's `claude-agent-acp`'s responsibility)
- Graceful shutdown (SIGTERM before SIGKILL) — ACP agents don't handle signals
- Queuing prompts while agent is restarting
- Multi-device session sync
