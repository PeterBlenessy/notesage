// ---------------------------------------------------------------------------
// Background agent tasks — public hook.
//
// The heavy lifting lives in `src/hooks/agent-task/`:
// - `task-registry.ts` — runtime registry for in-flight task records and
//   listener-cleanup closures (formerly hidden module-scope Maps here)
// - `run-task.ts`      — shared run lifecycle (`runAgentTask` + strategy shape)
// - `acp.ts` / `copilot-lsp.ts` / `direct-api.ts` — the per-backend flows
//
// This module keeps the public API stable: the hook itself plus the
// `stopTaskAgent` / `ensureTaskAgent` helpers and the task types are
// re-exported from their new homes.
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useActivityStore } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { hasSessionCapability } from '@/lib/ai/acp-utils';
import { getProjectLock, ProjectLockViolation, describeLockTarget } from '@/lib/ai/project-lock';
import { agentTaskRegistry, type InternalTask } from '@/hooks/agent-task/task-registry';
import type { TaskCallbacks, TaskMeta } from '@/hooks/agent-task/run-task';
import { startAcpTask, taskCapabilities } from '@/hooks/agent-task/acp';
import { startCopilotLspTask } from '@/hooks/agent-task/copilot-lsp';
import { startDirectApiTask } from '@/hooks/agent-task/direct-api';

// Public API re-exports (call sites and tests import these from this module).
export { stopTaskAgent, ensureTaskAgent } from '@/hooks/agent-task/acp';
export type { TaskStatus, InternalTask } from '@/hooks/agent-task/task-registry';
export type { TaskActivityEvent, TaskCallbacks, TaskMeta } from '@/hooks/agent-task/run-task';

export interface UseAgentTaskOperationsReturn {
  startTask: (prompt: string, callbacks?: TaskCallbacks, taskMeta?: TaskMeta) => Promise<string>;
  cancelTask: (taskId: string) => Promise<boolean>;
  getTask: (taskId: string) => InternalTask | undefined;
  taskConnection: Connection | null;
}

export function useAgentTaskOperations(): UseAgentTaskOperationsReturn {
  const selectedProjectPaths = useChatStore(selectProjectPaths);

  const taskConnection = useRoutingStore((s) => {
    const slot = s.routing.agent_tasks;
    if (!slot?.connectionId) return null;
    return s.getConnectionForUseCase('agent_tasks');
  });

  /**
   * Start a background agent task. Returns a task ID for tracking.
   *
   * Routes automatically based on the connection's auth method:
   * - `agent_managed`: runs via ACP agent session (full tool use)
   * - `api_key` / `local`: runs via direct API streaming chat (single-turn)
   *
   * @param prompt - The prompt to send to the agent
   * @param callbacks - Optional callbacks for streaming, completion, activity, and errors
   * @param taskMeta - Optional metadata for the activity strip (type, label, source file, etc.)
   */
  const startTask = useCallback(
    async (
      prompt: string,
      callbacks?: TaskCallbacks,
      taskMeta?: TaskMeta,
    ): Promise<string> => {
      const metadataMap = useProjectMetadataStore.getState().metadataMap;
      const sourceProjectRoot = taskMeta?.projectRoot ?? (selectedProjectPaths[0] ?? null);
      const sourceLock = sourceProjectRoot ? getProjectLock(sourceProjectRoot, metadataMap) : null;

      let resolvedConnection: Connection | null = taskConnection;
      if (sourceLock) {
        const allConnections = useConnectionsStore.getState().connections;
        const lockedConn = allConnections.find((c) => c.id === sourceLock.connectionId) ?? null;
        if (!lockedConn) {
          const label = describeLockTarget(sourceLock.connectionId);
          toast.error(`Project is locked to ${label}, but that connection is not available.`, {
            id: `project-lock-violation:${sourceProjectRoot}`,
          });
          throw new ProjectLockViolation(sourceProjectRoot!, sourceLock.connectionId, taskConnection?.id ?? null);
        }
        resolvedConnection = lockedConn;
      }

      if (!resolvedConnection) {
        throw new Error('No connection configured for agent tasks. Set up routing in Settings.');
      }

      if (resolvedConnection.authMethod === 'agent_managed') {
        const creds = resolvedConnection.credentials;
        if ('agentBinary' in creds && creds.agentBinary === 'copilot-language-server') {
          return startCopilotLspTask(prompt, callbacks, taskMeta, resolvedConnection);
        }
        return startAcpTask(prompt, callbacks, taskMeta, resolvedConnection, selectedProjectPaths);
      }
      return startDirectApiTask(prompt, callbacks, taskMeta, resolvedConnection);
    },
    [taskConnection, selectedProjectPaths]
  );

  /** Cancel a running task. Returns true if session was cancelled, false if already done. */
  const cancelTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      const task = agentTaskRegistry.getTask(taskId);
      if (!task || task.status !== 'running') return false;

      let cancelled = false;

      // ACP tasks have instanceId + sessionId; direct-API tasks don't
      if (task.instanceId && task.sessionId) {
        try {
          await tauriApi.acpSessionCancel(task.instanceId, task.sessionId);
          cancelled = true;
        } catch {
          // Expected: agent session may have already completed or agent crashed
        }
        // Best-effort session close so the agent can free resources.
        if (hasSessionCapability(taskCapabilities(), 'close')) {
          tauriApi.acpSessionClose(task.instanceId, task.sessionId).catch(() => {}); // Expected: best-effort cleanup
        }
      }

      task.status = 'cancelled';

      // Only update activity-store if this task is tracked there
      const as = useActivityStore.getState();
      if (as.tasks.some((t) => t.id === taskId)) {
        as.completeAllActivities(taskId);
        as.updateTaskStatus(taskId, 'cancelled');
      }

      agentTaskRegistry.runCleanup(taskId);
      return cancelled;
    },
    []
  );

  /** Get the current status of a task. */
  const getTask = useCallback((taskId: string): InternalTask | undefined => {
    return agentTaskRegistry.getTask(taskId);
  }, []);

  return { startTask, cancelTask, getTask, taskConnection };
}
