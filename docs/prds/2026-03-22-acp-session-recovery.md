# ACP Session Recovery

**Date:** 2026-03-22 **Status:** Complete

## Problem

When an ACP agent subprocess dies (dev hot-reload, crash, network timeout), the user gets raw protocol errors like:

```
Claude Code: new_session failed: Internal error: {
  "details": "Query closed before response received"
}
```

This is unacceptable UX. The user has no idea what happened or what to do. The app should recover automatically and show human-readable messages when it can't.

### Root causes

1. **Stale frontend reference**: `acpAgent` (module-level variable) holds an `instanceId` that no longer exists in the Rust backend's `AcpState.agents` map. `ensureAcpAgent` trusts this ref without verifying.
2. **No automatic retry**: When a session/prompt fails due to a dead connection, the error is shown immediately. The user must manually retry by sending another message.
3. **Raw error passthrough**: Protocol-level errors from the ACP crate are shown verbatim to the user.

## Goals

1. Automatically recover from dead agent connections without user intervention.
2. Show human-readable error messages when recovery fails.
3. Log all error states for debugging.
4. Handle both chat (`acpSendChatMessage`) and inline action (`acpGenerateText`) paths.

## Non-Goals

- Retry logic for non-connection errors (auth failures, rate limits, etc.)
- Backend-side keepalive or heartbeat
- Automatic reconnection for mid-stream failures (agent dies while streaming a response)

## Technical Approach

### 1. Backend: Add `acp_agent_exists` command

A lightweight check that verifies an instance ID is still registered in `AcpState.agents`. No I/O, just a map lookup.

```rust
#[tauri::command]
pub async fn acp_agent_exists(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    Ok(state.agents.lock().await.contains_key(&instance_id))
}
```

### 2. Frontend: Health check in `ensureAcpAgent`

Before reusing a cached `acpAgent`, verify the backend still has it:

```typescript
if (acpAgent) {
  const alive = await invoke<boolean>('acp_agent_exists', { instanceId: acpAgent.instanceId });
  if (!alive) {
    log.info('ai', 'ACP agent no longer exists in backend, clearing stale reference');
    acpAgent = null;
  }
}
```

If the agent is gone, clear the ref and fall through to the spawn path. This prevents the "first message always fails" scenario.

### 3. Frontend: Auto-retry on connection errors

In both `acpSendChatMessage` and `acpGenerateText`, wrap the send in a try/catch that detects connection-type errors and retries once:

- Detect errors matching: `Query closed`, `no longer running`, `did not respond`, `EOF`, `broken pipe`, `No agent found`
- On first failure: log the error, call `stopAcpAgent()`, update the assistant message to "Reconnecting...", retry the operation
- On retry failure: show user-friendly error, log the raw error for debugging
- On non-connection errors: show user-friendly error immediately (no retry)

### 4. User-friendly error messages

Replace raw error passthrough with translated messages:

| Raw error pattern | User-facing message |
| --- | --- |
| `Query closed`, `EOF`, `broken pipe` | "Lost connection to {agent}. Please try again." |
| `no longer running`, `did not respond` | "Lost connection to {agent}. Please try again." |
| `No agent found` | "Lost connection to {agent}. Please try again." |
| `timed out` | "{agent} is taking too long to respond. Please try again." |
| `not found` (binary) | "{agent} is not installed. Check Settings &gt; Connections." |
| `authenticate` / `auth` | "Authentication failed for {agent}. Check Settings &gt; Connections." |
| Other | "Something went wrong with {agent}. Please try again." |

The raw error is always logged at error level for debugging.

### 5. Logging

All error states must be logged with context:

- Health check failure: `log.info('ai', 'ACP agent {instanceId} no longer exists, will respawn')`
- First attempt failure: `log.warn('ai', 'ACP connection error, retrying: {rawError}')`
- Retry failure: `log.error('ai', 'ACP retry failed: {rawError}')`
- Non-connection error: `log.error('ai', 'ACP error: {rawError}')`

## Files to modify

| File | Changes |
| --- | --- |
| `src-tauri/src/commands/acp.rs` | Add `acp_agent_exists` command |
| `src-tauri/src/commands/mod.rs` | Register `acp_agent_exists` in command list |
| `src-tauri/src/lib.rs` | Add to `generate_handler![]` |
| `src/hooks/useAcpLifecycle.ts` | Health check in `ensureAcpAgent`, retry wrapper, friendly errors |
| `src/lib/ai/errors.ts` | Add/update `friendlyAIError` for ACP-specific patterns |

## Quality Gates

- [x] Sending a message after agent death recovers automatically (no user action needed)

- [x] User never sees raw protocol errors like "Query closed before response received"

- [x] Error messages are human-readable and actionable

- [x] All error states logged with raw error for debugging

- [x] Works for both chat and inline actions (Improve/Summarize/Expand)

- [x] No regression when agent is healthy (health check adds negligible latency)

- [x] Retry only happens once (no infinite retry loops)