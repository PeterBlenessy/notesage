# PRD: Orphaned Agent Process Cleanup

**Date:** 2026-02-22
**Phase:** 6.5 — Chat UX & Agent Polish
**Status:** Complete (v0.15.0)
**Version:** 0.14.1

## Problem

When Notesage exits (window close, Cmd+Q, or crash), ACP agent subprocesses (`claude-agent-acp`, `codex-acp`, `copilot`, `gemini`) remain alive as orphaned OS processes. These zombie processes consume system resources (CPU, memory, network) and can interfere with subsequent app launches. Users have no visibility into these orphaned processes and must manually kill them via Activity Monitor or `kill`.

**Root causes:**

1. `AcpState` has no `Drop` implementation — agents are never cleaned up when managed state is released
2. No Tauri exit hook — `lib.rs` uses `Builder::run()` with no `RunEvent::Exit` callback
3. ACP child processes lack `kill_on_drop(true)` — unlike the Copilot LSP which already sets this (at `copilot_lsp.rs:634`)
4. Frontend `stopAcpAgent()` and `stopTaskAgent()` are exported but never called on app exit
5. Error catch blocks in `useAIOperations.ts` clear `acpAgent = null` without calling `acp_agent_stop`, leaking the subprocess

## Goals / Non-Goals

**Goals:**

1. Zero orphaned agent processes after normal app exit (Cmd+Q, window close)
2. Zero orphaned agent processes after Tauri-handled signals (SIGTERM, SIGINT)
3. Fix error-path agent leaks during normal operation
4. Match the existing `kill_on_drop(true)` pattern already used by the Copilot LSP

**Non-Goals:**

- Handling `kill -9` (SIGKILL) — impossible at the OS level, no process can intercept SIGKILL
- Stale PID detection on next launch (detect and kill orphans from a previous crash) — deferred
- Graceful ACP protocol shutdown (ACP has no shutdown command; the existing `AgentCmd::Stop` handler just calls `child.kill()`)
- Agent process health monitoring or auto-restart

## User Stories

- As a user, I want agent processes to stop when I quit the app, so that my system resources aren't consumed by invisible zombie processes.
- As a user, I want agent processes to be cleaned up if an error occurs mid-session, so that broken agents don't accumulate in the background.

## Technical Approach

Three-layer defense-in-depth, any single layer is sufficient:

### Layer 1: `kill_on_drop(true)` on ACP child processes

**File:** `src-tauri/src/commands/acp.rs` (line 262)

Add `.kill_on_drop(true)` to the `tokio::process::Command` chain in `run_agent_thread()`. This matches the existing pattern at `copilot_lsp.rs:634`. When the `Child` struct is dropped for any reason (thread exit, channel break, app shutdown, panic), tokio sends SIGKILL to the subprocess.

This is the single most impactful change.

### Layer 2: Tauri `RunEvent::Exit` hook

**File:** `src-tauri/src/lib.rs`

Switch from `.run(tauri::generate_context!())` to `.build(tauri::generate_context!()).run(callback)`. On `RunEvent::Exit`, drain all agents from `AcpState`:

- `try_lock()` the `tokio::sync::Mutex` (returns immediately — no async needed)
- `drain()` the agents HashMap — dropping each `AgentHandle` closes its `cmd_tx` channel
- Channel close causes `cmd_rx.recv()` in `run_agent_thread` to return `None`, exiting the command loop
- Command loop exit drops `child`, triggering `kill_on_drop` SIGKILL
- `thread_handle.join()` waits for the OS thread to finish (should be near-instant since child is killed)

Add a `stop_all_sync()` method to `AcpState` encapsulating this logic.

### Layer 3: Frontend cleanup

**File:** `src/App.tsx`

Add a `useEffect` with `beforeunload` event handler that calls `stopAcpAgent()` and `stopTaskAgent()`. These are fire-and-forget (`invoke().catch(() => {})`), providing earlier cleanup during normal window close before the Rust shutdown sequence begins. This is supplementary — the Rust exit hook is the primary defense.

### Error path fixes

**File:** `src/hooks/useAIOperations.ts`

Three catch blocks (lines 317, 366, 574) set `acpAgent = null` without stopping the agent process. Change all three to call `stopAcpAgent()` instead, which properly sends the `acp_agent_stop` command before clearing state.

## UI/UX

No UI changes. This is purely backend and lifecycle management.

## Data Model

### New method on `AcpState`

```rust
impl AcpState {
    /// Stop all running agents synchronously. Drains the agents map,
    /// drops channel senders (closing channels), and joins threads.
    /// kill_on_drop handles subprocess cleanup.
    pub fn stop_all_sync(&self) { ... }
}
```

### Modified Tauri builder (`lib.rs`)

```rust
// Before:
.run(tauri::generate_context!())

// After:
.build(tauri::generate_context!())
.expect("error while building tauri application")
.run(|app_handle, event| {
    if let RunEvent::Exit = event {
        app_handle.state::<AcpState>().stop_all_sync();
    }
});
```

No new TypeScript interfaces, stores, or Tauri commands.

## Dependencies

None. All required APIs (`kill_on_drop`, `RunEvent::Exit`, `try_lock`) are already available in the current dependency versions (tokio, tauri v2).

## Quality Gates

### Functional

- [ ] `cargo build` passes with no warnings on new code
- [ ] `npx tsc --noEmit` passes
- [ ] Start app → connect ACP agent → verify process running (`ps aux | grep acp`) → quit app (Cmd+Q) → verify process gone
- [ ] Start app → connect ACP agent → force-close window → verify process gone
- [ ] Start app → trigger ACP error path → verify no orphaned process remains
- [ ] Copilot LSP behavior unchanged (already has `kill_on_drop`)
- [ ] Normal ACP chat/inline actions still work after changes
- [ ] `acp_agent_stop` Tauri command still works for explicit stop

### Code quality

- [ ] ACP spawn uses `kill_on_drop(true)` matching Copilot LSP pattern
- [ ] `lib.rs` uses `build().run()` pattern with `RunEvent::Exit`
- [ ] No `acpAgent = null` without corresponding `stopAcpAgent()` call in error paths

## Out of Scope

- **Stale PID detection:** Writing agent PIDs to disk and cleaning up orphans from previous crashes on next launch
- **Agent health monitoring:** Detecting unresponsive agents and auto-restarting
- **Graceful ACP shutdown protocol:** ACP doesn't define one; `child.kill()` is the correct approach
- **Process group management:** Using `setsid`/process groups to kill agent child trees
- **Filesystem watcher cleanup:** `WatcherState` — already handled by OS when process exits (inotify/FSEvents file descriptors auto-close)
