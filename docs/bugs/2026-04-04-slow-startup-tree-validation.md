# Bug: Slow startup — sequential iCloud tree validation blocks tool loading

|  |  |
| --- | --- |
| **Date observed** | 2026-04-04 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Chat tools dropdown shows 6/13 tools for ~6 seconds on startup; skill tools appear delayed |
| **Versions affected** | v0.28.3 (and earlier) |
| **Reproducibility** | Always — visible on every app launch and frontend refresh |

## Symptoms

1. Open the app or refresh the frontend
2. Open the chat panel and look at the tools dropdown
3. Only 6 built-in tools are shown for ~5-6 seconds
4. After the delay, all 13 tools (6 built-in + 7 skill tools) appear
5. In dev mode the delay is worse due to React StrictMode double-execution

## Root Cause

The startup pipeline in `useAppLifecycle.ts` runs sequentially:

1. **Tree validation** — `listDirectory` called sequentially for each project and explorer folder. With 7 iCloud projects + 2 folders, this takes **4.1 seconds** due to iCloud filesystem latency.
2. **Index init** — SQLite index initialization for each project, ~700ms total.
3. **`startupReady` set** — at ~5.8s, gates all downstream hooks.
4. **Skill discovery** — `useSkillOperations` runs, extracting skill tools in ~200ms.

The bottleneck is step 1: sequential `listDirectory` IPC calls over iCloud (`~/Library/Mobile Documents/com~apple~CloudDocs/`). Each call blocks on iCloud filesystem access.

## Perf Measurements

```
[perf:startup] trees validated       — { projects: 7, folders: 2, totalFiles: 9, ms: 4128 }
[perf:startup] index init total      — { ms: 730 }
[perf:startup] ready                 — { totalMs: 5822 }
[perf:skills]  skill-tool-extract    — { count: 7, ms: 3, sincePipelineStart: 69 }
```

The skill pipeline itself is fast (69ms). The entire delay is the startup gate.

## Suggested Fixes

### Quick win: parallelize tree validation

Replace sequential `listDirectory` loops with `Promise.all`:

```typescript
// Current (sequential — 4.1s)
for (const project of projects) {
  const tree = await tauriApi.listDirectory(project.path);
  ws.updateProjectTree(project.path, tree);
}

// Fix (parallel — should be ~600ms)
await Promise.all(projects.map(async (project) => {
  const tree = await tauriApi.listDirectory(project.path);
  ws.updateProjectTree(project.path, tree);
}));
```

Same for explorer folders and index init.

### Deeper fix: decouple skill discovery from tree validation

`startupReady` currently gates both filesystem watchers and skill discovery. Skills don't depend on tree validation — they only need the home directory and project paths (already known from persisted state). Consider:

- A separate `skillsReady` gate that fires earlier
- Or running skill discovery in parallel with tree validation

### Optional: cached tree display

Show the persisted tree from localStorage immediately on mount, then refresh from disk in the background. Users see the file tree instantly; stale entries resolve within seconds.

## Key Files

| File | Role |
| --- | --- |
| `src/hooks/useAppLifecycle.ts` | Startup pipeline, tree validation, `startupReady` |
| `src/hooks/useSkillOperations.ts` | Skill discovery, gated by `skillsReady` |
| `src/stores/skill-store.ts` | `skillTools`, `getToolDefinitions()` |
| `src/stores/settings-store.ts` | `homeDir`, `skillsReady` runtime flags |
| `src-tauri/src/commands/file.rs` | `list_directory` Tauri command |
| `src-tauri/src/commands/skills.rs` | Bundled skill extraction + manifest cleanup |
| `src-tauri/src/commands/agents.rs` | Bundled agent extraction + manifest cleanup |

## Resolution

All three suggested fixes implemented:

1. **Parallelize tree validation:** `listDirectory` calls for explorer folders, projects, synced iCloud projects, and per-project index init all run concurrently via `Promise.all`. Reduced tree validation from ~4.1s to ~2-3s.

2. **Decouple skill discovery from tree validation:** New `skillsReady` flag fires immediately after home directory resolution, before tree validation starts. Skill pipeline reads `homeDir` from the settings store (resolved once on startup) instead of making IPC calls. Two-phase pipeline: Phase 1 scans existing files and populates tools immediately (~3s); Phase 2 extracts bundled skills/agents in background without blocking the UI. Bundled extraction includes manifest-based cleanup for deprecated skills/agents (`~/.notesage/.bundled-skills.json`, `~/.notesage/.bundled-agents.json`).

3. **Cached tree display:** Already solved by Zustand persist — `workspace-store` persists the file tree to localStorage, so the sidebar renders instantly on mount from the cached state. The `reloadTrees()` call validates and refreshes the tree in the background. No additional work needed.

**Result:** Tools dropdown loads in ~3s (down from ~12s). Subsequent rescans (e.g., triggered by connection changes) complete in ~60ms.
