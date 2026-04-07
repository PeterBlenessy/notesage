# Bug: `startupReady` never set — skills, agents, and tools not loading

**Reported:** 2026-04-07
**Severity:** Critical
**Status:** Fixed (pending manual verification)
**Affects:** v0.30.1 (production laptop)

## Symptoms

- Settings UI says "Add skills to .notesage/skills/ in your project or ~/.notesage/skills/ globally"
- Skills exist on disk at `~/.notesage/skills/` (verified manually)
- No bundled agents visible in agent picker
- Chat panel footer shows only 10 built-in tools (no skill-derived tools)
- Issue reproduces on every app launch

## Root Cause

`startupReady` is never set to `true`, which gates `useSkillDiscovery()` from running.

**Call chain:**

1. `useAppLifecycle()` mounts a `useEffect` that calls `reloadTrees()` (fire-and-forget async)
2. `reloadTrees()` runs sequential `await` calls: tree validation → iCloud scan → index init → `setStartupReady(true)`
3. If any `await` hangs (e.g., `listDirectory` on cloud storage, `scanICloudForProjects`), the chain never reaches `setStartupReady`
4. `useSkillDiscovery()` checks `if (!startupReady) return` and never fires

**Evidence from production logs (2026-04-07):**

- Backend log shows successful index init (`Global index DB initialized`, `Project index DB initialized`)
- Tab preloads complete normally (`perf:tab-preload`)
- **Zero** `notesage::frontend::skills` log entries (skill discovery never ran)
- **Zero** `perf:startup` entries (startup function never reached completion)
- No errors logged — the hang is silent

**Likely hang location:**

The prod laptop has projects on cloud storage:
- `~/Library/CloudStorage/OneDrive-AxisCommunicationsAB/AI-Workspace/` (OneDrive)
- `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/Private Notes/` (iCloud)

`listDirectory` or `scanICloudForProjects` on these paths may hang if cloud files aren't locally materialized. The entire startup chain blocks because there's no timeout or try/finally around `reloadTrees()`.

## Impact

- All skills and agents invisible (bundled and custom)
- Skill-derived tools not available for AI tool calling (only 10 built-in tools shown)
- Agent picker empty
- Filesystem watchers may also be delayed (gated on startup)

## Fix

1. Wrap `reloadTrees()` in try/finally that always sets `startupReady`
2. Add a safety timeout (e.g., 30s) so even a hang doesn't permanently block
3. Add `log.info` at each major step for production debugging

## Key Files

- `src/hooks/useAppLifecycle.ts` — `reloadTrees()` function (line ~189) and startup effect (line ~180)
- `src/hooks/useSkillOperations.ts` — `useSkillDiscovery()` gated on `startupReady` (line ~197)
- `src/stores/settings-store.ts` — `startupReady` flag
