# Bug: Local AI server not starting in production build

|  |  |
| --- | --- |
| **Date observed** | 2026-03-24 |
| **Status** | Open |
| **Severity** | Medium |
| **Impact** | Local AI unusable on laptop production build |
| **Versions affected** | v0.21.0+ (worked in v0.19.3) |
| **Tasks** | [local-ai-not-starting-production-tasks](../tasks/2026-03-24-local-ai-not-starting-production-tasks.md) |

## Symptoms

- Local AI status shows as "Stopped" (amber/yellow health indicator)
- No way to manually start the server — there is no explicit "Start" button
- Health check indicator is amber/orange (not green or red)
- No `local_ai` or `llama_server` log entries in the production log after startup

## Context

Local AI worked correctly through v0.19.3 on the laptop (production build). After upgrading to v0.21.0+, the server simply never starts. The logs confirm this — the last `llama-server` entries on the laptop are from v0.19.3 (March 16), and no attempt to start the server is logged on v0.22.x.

The dev machine works fine because the binary resolution paths differ between dev and production builds.

## Production log evidence

```
# v0.19.3 — last working version on laptop
[2026-03-16][09:55:16] Started llama-server on port 8090 with model 'gemma-3-4b' (pid 2271)

# v0.21.0 — no llama-server entries at all
[2026-03-16][16:13:43] Notesage starting up (version 0.21.0)
  ... index and health check logs only, no local_ai entries ...

# v0.22.10 — still no llama-server entries
[2026-03-24][10:01:13] Notesage starting up (version 0.22.10)
  ... no local_ai entries at all ...
```

## Root cause (likely)

The auto-start in `useLocalAI.ts` (lines 68-96) depends on ALL of these conditions being true:

```typescript
startupReady && hasLocalAIConnection && activeModelId &&
binaryStatus === 'available' && model.downloaded
```

If **any** condition fails, the server silently doesn't start and the connection status is set to `'expired'` (amber indicator). There is **no logging** when conditions aren't met — the decision is entirely frontend-side and invisible.

Likely failure points:

1. **Binary not found in production:** The sidecar binary resolution changed between versions. `check_llama_server_available()` checks 4 locations: bundled sidecar → dev binaries → `~/.notesage/bin/` → system PATH. The production build may not find the binary at any location.
2. **Connection not created:** The `local_bundled` connection type may not have been auto-created after upgrade, leaving `hasLocalAIConnection` false.
3. **Model ID mismatch:** `activeModelId` persisted from v0.19.3 may not match the model catalog in v0.22.x.

## Affected files

- `src/hooks/useLocalAI.ts` — auto-start logic, binary check, crash detection
- `src/stores/local-ai-store.ts` — persisted `activeModelId`, `binaryStatus`
- `src-tauri/src/commands/local_inference.rs` — `check_llama_server_available()`, `start_local_server()`

## Proposed fixes

1. **Add diagnostic logging to auto-start hook:** When the auto-start conditions aren't all met, log exactly which condition failed (e.g., "Local AI auto-start skipped: binaryStatus=not_found")
2. **Add a manual "Start/Restart" button** in Local AI settings that works regardless of auto-start conditions, with clear error feedback on failure
3. **Verify binary bundling in production build:** Check that the sidecar binary is included in the release `.app` bundle and that the resolution path works post-install
4. **Surface specific failure reason in UI:** Replace the generic amber dot with a status message like "AI engine not found" or "No model selected"