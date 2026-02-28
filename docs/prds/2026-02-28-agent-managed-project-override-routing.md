# PRD: Agent-Managed Project Override Routing Fix

**Date:** 2026-02-28 **Status:** Implemented **Priority:** High (bug fix)

## Problem

Two related bugs in the AI routing layer:

1. **agent_managed project overrides silently ignored.** When a project overrides its AI provider to an `agent_managed` connection (e.g., Claude Code via ACP), the override is silently skipped. `generateText` and `sendChatMessage` only check `interactiveConnection?.authMethod === 'agent_managed'` — which reflects *global* routing, not the project override. If global routing is an API key connection but the project overrides to agent_managed, the ACP path is never taken.

2. **Chat project selector allows conflicting provider overrides.** Users can multi-select projects that each override to different providers. Since overrides only apply when exactly one project is selected (`selectedProjectPaths.length === 1`), multi-selecting silently drops all overrides with no user feedback.

## Solution

### Fix 1: `effectiveConnection` in `useAIOperations`

Add an `effectiveConnection` useMemo that resolves:

```
effectiveConnection = projectOverrideConnection ?? interactiveConnection
```

Where `projectOverrideConnection` looks up `singleMetadata?.ai.provider` as a connection ID in the connections store.

Replace all `interactiveConnection` references in the ACP routing checks (`generateText`, `sendChatMessage`, message badge metadata) with `effectiveConnection`.

### Fix 2: Conflict detection in ChatPanel project selector

**Individual toggle:** When selecting a project whose non-null provider override conflicts with any already-selected project's override, swap to just the new project and show an info toast.

**Select all:** If projects have more than one distinct non-null override, block the action and show an info toast.

Toast uses stable `id: 'provider-conflict'` to prevent duplicates.

## Files Changed

- `src/hooks/useAIOperations.ts` — added `effectiveConnection` useMemo, replaced `interactiveConnection` in ACP routing
- `src/components/chat/ChatPanel.tsx` — added `handleProjectToggle` with conflict detection, updated `handleToggleAll`

## Verification

1. Set global routing to Anthropic API key; set project override to Claude Code (agent_managed)
2. Select that project in chat → send message → verify ACP routing (activity log visible)
3. Select a project with no override → verify fallback to global routing
4. Select two projects with different overrides → verify swap with toast
5. Try "Select All" with conflicting overrides → verify toast + no change