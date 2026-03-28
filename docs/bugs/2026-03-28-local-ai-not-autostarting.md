# Bug: Local AI not auto-starting on app launch and after updates

|  |  |
| --- | --- |
| **Date observed** | 2026-03-28 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Local AI (bundled llama-server) requires manual start after every app launch and after app updates |
| **Versions affected** | v0.23.2 (current) |
| **Reproducibility** | Frequent, especially after app updates |

## Symptoms

1. App starts with Local AI configured and a model downloaded
2. Local AI server does not auto-start; requires clicking "Start" manually in settings
3. After an app update is installed and the app restarts, the local AI server is stopped and does not restart
4. The `pkill -f llama-server` in setup may also kill llama-server instances started by other apps (Ollama, LM Studio, etc.)

## Root Cause

### Primary: Race condition between pkill and auto-start

In `lib.rs` (lines 244-263), the Tauri `setup()` hook runs `pkill -f llama-server` synchronously during initialization:

```rust
.setup(|app| {
    for pattern in &["claude-agent-acp", "codex-acp", "llama-server"] {
        let _ = std::process::Command::new("pkill")
            .args(["-f", pattern])
            .output();
    }
    local_inference::kill_orphaned_servers();
    // ...
})
```

The frontend's `useLocalAI()` hook (mounted in `App.tsx`) fires almost immediately after and calls `startLocalServer()`. If `pkill` is still executing or macOS hasn't fully cleaned up the process, the **newly spawned** server gets killed by the same broad pattern match.

This is worse after app updates because:

- The binary replacement triggers a restart
- The previous llama-server may still be shutting down
- `pkill -f llama-server` catches both the old and new process

### Secondary: Broad pattern match kills other apps' servers

`pkill -f llama-server` matches **any** process with "llama-server" in its command line, not just the one Notesage started. This kills llama-server instances from Ollama, LM Studio, or any other app.

### Contributing: Model list dependency

The auto-start effect in `useLocalAI.ts` (lines 77-150) depends on the `models` array being populated:

```typescript
const model = models.find((m) => m.id === activeModelId);
if (!model?.downloaded) {
    return; // skip auto-start
}
```

If the model catalog takes time to load, auto-start is silently skipped with no retry mechanism.

## Suggested Fix

Replace `pkill -f llama-server` with PID-file-based cleanup:

1. The server already writes a PID file — use it to kill only the specific orphaned Notesage process
2. Read the PID from the file, verify it's actually a llama-server process, then kill by exact PID
3. This avoids killing llama-server instances from other applications
4. Add a guard in the auto-start flow to wait for cleanup completion before spawning

## Key Files

| File | Lines | Role |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | 244-263 | Setup hook with pkill |
| `src-tauri/src/commands/local_inference.rs` | 42-61, 348-367 | Orphan server cleanup |
| `src/hooks/useLocalAI.ts` | 15-150 | Frontend auto-start logic |
| `src/stores/local-ai-store.ts` | 81-232 | Store persistence |
| `src/App.tsx` | 73 | Hook mount point |
