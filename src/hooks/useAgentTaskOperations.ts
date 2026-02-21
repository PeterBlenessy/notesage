import { useCallback, useRef } from 'react';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore } from '@/stores/chat-store';
import type { Connection } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// ACP types (shared with useAIOperations — consider extracting if they grow)
// ---------------------------------------------------------------------------

interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: { id: string; name: string; description: string | null }[];
}

interface AcpSessionResult {
  session_id: string;
}

interface AcpSessionUpdatePayload {
  instanceId: string;
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: { type: string; text?: string };
    [key: string]: unknown;
  };
}

interface AcpPermissionRequestPayload {
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolCall: unknown;
  options: { optionId: string; kind: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Task agent state (module-level, survives re-renders)
// ---------------------------------------------------------------------------

interface TaskAgentState {
  instanceId: string;
  connectionId: string;
  sessionId: string | null;
}

let taskAgent: TaskAgentState | null = null;

export function stopTaskAgent(): void {
  if (taskAgent) {
    invoke('acp_agent_stop', { instanceId: taskAgent.instanceId }).catch(() => {});
    taskAgent = null;
  }
}

async function ensureTaskAgent(connection: Connection, cwd: string): Promise<string> {
  if (taskAgent && taskAgent.connectionId !== connection.id) {
    try {
      await invoke('acp_agent_stop', { instanceId: taskAgent.instanceId });
    } catch {
      // Agent may already be stopped
    }
    taskAgent = null;
  }

  if (taskAgent) {
    return taskAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string };
  const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
    agentBinary: creds.agentBinary,
    role: 'task',
    workingDirectory: cwd,
  });

  // Try to authenticate — some agents handle auth internally
  try {
    await invoke('acp_agent_authenticate', { instanceId: result.instance_id });
  } catch (authErr) {
    const msg = String(authErr);
    if (!msg.toLowerCase().includes('not implemented')) throw authErr;
  }

  taskAgent = {
    instanceId: result.instance_id,
    connectionId: connection.id,
    sessionId: null,
  };

  return result.instance_id;
}

// ---------------------------------------------------------------------------
// Task status tracking
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  instanceId: string;
  sessionId: string;
  output: string;
  error?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentTaskOperations() {
  const tasksRef = useRef<Map<string, AgentTask>>(new Map());
  const cleanupRef = useRef<Map<string, () => void>>(new Map());

  const { selectedProjectPaths } = useChatStore();

  const taskConnection = useRoutingStore((s) => {
    const id = s.routing.agent_tasks;
    if (!id) return null;
    return s.getConnectionForUseCase('agent_tasks');
  });

  /**
   * Start a background agent task. Returns a task ID for tracking.
   * The task runs in its own ACP session (separate from interactive chat).
   */
  const startTask = useCallback(
    async (prompt: string): Promise<string> => {
      if (!taskConnection || taskConnection.authMethod !== 'agent_managed') {
        throw new Error('No agent connection configured for tasks. Set up agent routing in Settings.');
      }

      const cwd = selectedProjectPaths[0] || '/tmp';
      const instanceId = await ensureTaskAgent(taskConnection, cwd);

      // Each task gets its own session
      const session = await invoke<AcpSessionResult>('acp_session_new', {
        instanceId,
        workingDirectory: cwd,
      });

      const taskId = `task-${Date.now()}`;
      const task: AgentTask = {
        id: taskId,
        prompt,
        status: 'running',
        instanceId,
        sessionId: session.session_id,
        output: '',
        createdAt: Date.now(),
      };
      tasksRef.current.set(taskId, task);

      // Listen for session updates
      const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        if (event.payload.sessionId !== session.session_id) return;
        const { update } = event.payload;

        const current = tasksRef.current.get(taskId);
        if (!current) return;

        if (
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content?.type === 'text' &&
          update.content.text
        ) {
          current.output += update.content.text;
        } else if (update.sessionUpdate === 'agent_turn_complete') {
          current.status = 'completed';
        }
      });

      // Auto-approve permission requests for task agents (Phase 6.5 will add proper UI)
      const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const payload = event.payload;
        const rawOptions = payload.options as unknown[];
        let firstOptionId: string | null = null;
        if (Array.isArray(rawOptions) && rawOptions.length > 0) {
          const opt = rawOptions[0] as Record<string, unknown>;
          firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
        }
        invoke('acp_permission_respond', {
          instanceId,
          requestId: payload.requestId,
          optionId: firstOptionId,
        }).catch(() => {});
      });

      const cleanup = () => {
        unlisten();
        unlistenPermission();
      };
      cleanupRef.current.set(taskId, cleanup);

      // Send the prompt (non-blocking from the caller's perspective after setup)
      invoke('acp_session_prompt', {
        instanceId,
        sessionId: session.session_id,
        content: prompt,
      })
        .catch((error) => {
          const t = tasksRef.current.get(taskId);
          if (t) {
            t.status = 'failed';
            t.error = error instanceof Error ? error.message : String(error);
          }
        })
        .finally(() => {
          const c = cleanupRef.current.get(taskId);
          if (c) {
            c();
            cleanupRef.current.delete(taskId);
          }
        });

      return taskId;
    },
    [taskConnection, selectedProjectPaths]
  );

  /** Cancel a running task. */
  const cancelTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.get(taskId);
      if (!task || task.status !== 'running') return;

      try {
        await invoke('acp_session_cancel', {
          instanceId: task.instanceId,
          sessionId: task.sessionId,
        });
        task.status = 'cancelled';
      } catch {
        // Agent may have already completed
      }

      const cleanup = cleanupRef.current.get(taskId);
      if (cleanup) {
        cleanup();
        cleanupRef.current.delete(taskId);
      }
    },
    []
  );

  /** Get the current status of a task. */
  const getTask = useCallback((taskId: string): AgentTask | undefined => {
    return tasksRef.current.get(taskId);
  }, []);

  return { startTask, cancelTask, getTask, taskConnection };
}
