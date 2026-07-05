// ---------------------------------------------------------------------------
// Background guard effects for the ACP chat lifecycle, extracted from
// `useAcpLifecycle`:
//
// - `useAcpWorkspaceRespawn` — tears down and respawns every live agent when
//   the workspace folders change (the Seatbelt sandbox scope is derived from
//   the workspace, so every profile is invalidated).
// - `useAcpAgentExitWatcher` — listens for agent process death and cleans up
//   the exited conversation's stream.
//
// Both operate on the hook-owned per-conversation `CleanupMap`; the map
// instance is stable for the lifetime of the owning hook, so it's passed by
// value rather than via ref.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { useSessionRunStore, ACTIVE_STATUSES } from '@/stores/session-run-store';
import { getAllAcpAgentEntries, stopAllAcpAgents } from '@/lib/ai/acp-agent-state';
import { runConvCleanup, type CleanupMap } from '@/hooks/acp/conv-cleanup';
import { clearUnresponsiveTimer } from '@/hooks/acp/unresponsive-monitor';

/**
 * Respawn agents when workspace folders change (sandbox paths need updating).
 *
 * Task #29: before tearing down the agent, gracefully cancel any in-flight
 * turn and drain pending permission requests. Without this, a stale
 * permission prompt can linger in the UI pointing at a session tied to a
 * dead agent — approving it races against the new agent's spawn and either
 * no-ops or hits the wrong instance. Ordering matters:
 *   1. Cancel the active ACP turn (tells the agent to stop streaming).
 *   2. Deny pending permissions for this instance (fire-and-forget; the
 *      store is then drained so the UI doesn't render dead cards).
 *   3. `stopAcpAgent()` — now the SIGTERM is the cleanup, not a mid-turn
 *      interrupt that dumps errors into the logs.
 */
export function useAcpWorkspaceRespawn(
  cleanupMap: CleanupMap,
  setLoading: (loading: boolean) => void,
  setActiveTool: (tool: string | null) => void,
): void {
  const workspaceProjects = useWorkspaceStore((s) => s.projects);
  const workspaceExplorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const prevWorkspaceKeyRef = useRef('');
  useEffect(() => {
    const key = [
      ...workspaceProjects.map((p) => p.path),
      ...workspaceExplorerFolders.map((f) => f.path),
    ].sort().join('|');

    // A workspace folder change invalidates the Seatbelt sandbox of EVERY live
    // agent (each writable scope is derived from the workspace), so every
    // registry entry must be torn down and respawned — not just the foreground
    // one (task #2: the registry may now hold several concurrent agents).
    const liveEntries = getAllAcpAgentEntries();
    if (prevWorkspaceKeyRef.current && prevWorkspaceKeyRef.current !== key && liveEntries.length > 0) {
      log.info('ai', `Workspace folders changed — restarting ${liveEntries.length} agent(s) for updated sandbox`);

      const permStore = usePermissionStore.getState();
      const runs = useSessionRunStore.getState().runs;
      let anyTurnActive = false;

      for (const [conversationId, agent] of liveEntries) {
        const instanceId = agent.instanceId;
        const sessionId = agent.chatSessionId;
        const pendingForInstance = permStore.requests.filter((r) => r.instanceId === instanceId);
        // Per-conversation run-state, NOT the global `isLoading` (which a
        // background completion could have just cleared, so it no longer tells us
        // whether THIS agent's turn is active under concurrency).
        const runStatus = runs[conversationId]?.status;
        const turnActive = (runStatus !== undefined && ACTIVE_STATUSES.includes(runStatus)) || pendingForInstance.length > 0;
        if (!turnActive) continue;
        anyTurnActive = true;

        // 1. Cancel the ACP turn if a session is active. Agent may be dying
        //    already — swallow rejections rather than throwing into React.
        if (sessionId) {
          invoke('acp_session_cancel', { instanceId, sessionId }).catch((err) => {
            log.warn('ai', `acp_session_cancel during workspace change failed: ${String(err)}`);
          });
        }

        // 2. Deny every pending permission waiter on this instance, then
        //    drain the store. `acp_permission_respond` resolves the agent-
        //    side future; `clearRequestsForInstance` drops the UI cards.
        for (const req of pendingForInstance) {
          invoke('acp_permission_respond', {
            instanceId,
            requestId: req.requestId,
            optionId: null,
          }).catch(() => {
            // Expected: fire-and-forget deny during context reset.
          });
        }
        permStore.clearRequestsForInstance(instanceId);

        // 3. Tear down THIS conversation's in-flight chat listeners (review #3 —
        //    each affected conversation, not just whatever the old single
        //    cleanupRef happened to hold). `cancelled` marks its message
        //    interrupted and clears its run.
        runConvCleanup(cleanupMap, conversationId, true);
      }

      if (anyTurnActive) {
        // 4. Surface a toast so the user knows why the stream stopped. The
        //    stable id prevents duplicate toasts if two workspace changes
        //    fire back-to-back.
        toast.info('Context reset: workspace changed, previous turn cancelled', {
          id: 'acp-workspace-context-reset',
        });

        clearUnresponsiveTimer();
        setLoading(false);
        setActiveTool(null);
      }

      stopAllAcpAgents();
    }
    prevWorkspaceKeyRef.current = key;
  }, [workspaceProjects, workspaceExplorerFolders, cleanupMap, setLoading, setActiveTool]);
}

/** Listen for agent process death events and clean up the exited stream. */
export function useAcpAgentExitWatcher(cleanupMap: CleanupMap): void {
  useEffect(() => {
    // Mounted-flag pattern (see `useSandboxViolations`): `listen()` resolves
    // asynchronously, so an unmount racing the registration must unlisten
    // the late registration immediately instead of leaking it.
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<{ instanceId: string; exitCode: number | null }>('acp-agent-exited', (event) => {
      // Match the exited process against any registered agent — the registry
      // may hold several concurrent instances (task #2), not just one. Pair it
      // with its conversation key so we tear down only THAT conversation's
      // stream (review #3), not whatever the old single cleanupRef held.
      const owner = getAllAcpAgentEntries().find(([, a]) => a.instanceId === event.payload.instanceId);
      if (!owner) return;
      const [ownerConversationId] = owner;

      log.warn('ai', `ACP agent process exited (code: ${event.payload.exitCode})`);
      useAgentStatusStore.getState().setStatus('exited', event.payload.exitCode);

      // Clean up if we're mid-prompt
      clearUnresponsiveTimer();
      runConvCleanup(cleanupMap, ownerConversationId);
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn(); // Already unmounted — clean up immediately
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [cleanupMap]);
}
