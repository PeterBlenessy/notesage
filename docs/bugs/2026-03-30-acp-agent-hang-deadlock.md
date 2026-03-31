# Bug: ACP agent hang causes unrecoverable chat and app quit deadlock

|  |  |
| --- | --- |
| **Date observed** | 2026-03-30 |
| **Status** | Fixed |
| **PRD** | [acp-agent-recovery](../prds/2026-03-31-acp-agent-recovery.md) |
| **Tasks** | [acp-agent-recovery-tasks](../tasks/2026-03-31-acp-agent-recovery-tasks.md) |
| **Severity** | High |
| **Impact** | Chat becomes permanently unresponsive; stop button has no effect; quitting the app hangs and is killed by macOS |
| **Versions affected** | v0.26.0 |
| **Reproducibility** | Intermittent — triggered when the ACP agent subprocess stops responding (likely upstream API timeout or availability issue) |

## Symptoms

1. User is chatting with Claude Code via ACP agent
2. Agent stops responding mid-conversation — spinner runs indefinitely
3. Clicking the stop button has no visible effect
4. Sending follow-up messages produces no response — all new messages also hang
5. Attempting to quit the app (Cmd+Q) causes a hang; macOS kills the app after \~1 second

## Crash log

`~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/Private Notes/notesage-logs/Notesage-crash-2026-03-30.txt`

macOS reported a `hang` event (not a crash), duration 1.07s. The app was killed by the watchdog.

## Root causes

### 1. Stop button sends ACP cancel, not process kill

The chat stop button calls `acpCancelChat` → `acp_session_cancel` → `conn.cancel()`. This sends a `session/cancel` JSON-RPC **notification** to the agent's stdin. It relies on the agent subprocess to cooperate and respond with a cancelled `PromptResponse`.

When the agent subprocess is hung (e.g., stuck on an API call), it never processes the cancel notification. There is no escalation path — the UI has no way to forcibly kill a hung agent.

**Code path:** `ChatFooter.tsx:170` → `useAIOperations.ts:135` → `useAcpLifecycle.ts:355` → Tauri `acp_session_cancel` → `conn.cancel()` (ACP notification, fire-and-forget to subprocess stdin)

### 2. Hung agent blocks all subsequent commands

The agent thread runs a single-threaded tokio `LocalSet` with:

- An I/O task (`io_task`) that reads/writes JSON-RPC on the agent's stdin/stdout
- A command loop that receives frontend commands (`Prompt`, `Cancel`, `Stop`) via `tokio::sync::mpsc`
- Per-prompt `spawn_local` tasks that call `conn.prompt()` and await responses

When the agent subprocess stops producing output:

- `conn.prompt()` awaits a `PromptResponse` via a oneshot that never fires (the agent never sends a response)
- The I/O task is stuck on `read_line()` from the agent's stdout
- New prompt commands are received and spawn new tasks, but each `conn.prompt()` writes the request and then also hangs awaiting a response
- The ACP cancel notification is successfully written to stdin, but the subprocess ignores it

**Crash log evidence:** Thread `0xce8dc4` (`acp-/opt/homebrew/bin/claude-agent-acp`) had `last ran 664.366s ago` — the agent thread was parked on `kevent` for 11 minutes, indicating the subprocess produced no output for that entire period.

### 3. App quit deadlocks on thread join

The `RunEvent::Exit` handler calls `AcpState::stop_all_sync()` on the **main thread**, which:

1. Drops `cmd_tx` (closes the command channel)
2. Calls `th.join()` — blocks the main thread waiting for the agent thread to exit

But the agent thread is parked on `kevent` waiting for subprocess I/O that never arrives. The channel close should signal the command loop to exit, but the tokio runtime needs to wake up and poll the `cmd_rx` receiver for that to happen. With the I/O task also waiting on `read_line()`, the runtime parks indefinitely.

**Crash log evidence:** Main thread blocked at `AcpState::stop_all_sync` → `JoinInner::join` → `__ulock_wait`, with the note: `blocked by turnstile waiting for thread 0xce8dc4` (the agent thread).

## Technical details

**Architecture:**

- `src-tauri/src/commands/acp.rs`: `run_agent_thread()` — owns the `LocalSet` + `current_thread` tokio runtime
- `agent-client-protocol` v0.10.2: `rpc.rs` `handle_io()` — `select_biased!` loop multiplexing stdout reads and stdin writes
- `conn.cancel()` is a notification (write-only, no response expected from protocol)
- `conn.prompt()` is a request (write + await response via oneshot)

**Key observation:** The ACP `session/cancel` is a **cooperative** mechanism — it asks the agent to stop. When the agent is unresponsive, cooperative cancellation is useless. The only reliable way to stop a hung agent is SIGKILL.

## Impact on user experience

- Chat is permanently broken with no recovery path
- User must force-quit the app
- Conversation context is lost
- No indication of what went wrong — just an infinite spinner
- Likely to recur during API availability issues (Anthropic has had several in recent weeks)