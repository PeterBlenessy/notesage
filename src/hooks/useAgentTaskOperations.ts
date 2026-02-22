import { useCallback, useRef } from 'react';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
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

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] };
  const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
    agentBinary: creds.agentBinary,
    agentArgs: creds.agentArgs ?? null,
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
   *
   * Callbacks:
   * - onComplete: fires when the agent finishes (with accumulated output)
   * - onActivity: fires on tool_call / tool_result events (for activity log)
   * - onError: fires if the prompt fails or the agent errors
   */
  const startTask = useCallback(
    async (
      prompt: string,
      onComplete?: (output: string) => void,
      onActivity?: (activity: { kind: string; label: string; detail?: string; event: 'tool_call' | 'tool_result' | 'agent_responding' | 'agent_complete' | 'permission_auto_approved' }) => void,
      onError?: (error: string) => void,
    ): Promise<string> => {
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
      let receivedFirstChunk = false;
      const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        if (event.payload.sessionId !== session.session_id) return;
        const { update } = event.payload;

        const current = tasksRef.current.get(taskId);
        if (!current) return;

        const eventType = update.sessionUpdate;

        if (
          eventType === 'agent_message_chunk' &&
          update.content?.type === 'text' &&
          update.content.text
        ) {
          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });
          }
          current.output += update.content.text;
        } else if (eventType === 'tool_call') {
          const kind = (update as Record<string, unknown>).kind as string | undefined;
          const title = (update as Record<string, unknown>).title as string | undefined;
          const rawInput = (update as Record<string, unknown>).rawInput as string | undefined;
          const label = title || kind || 'Tool call';
          onActivity?.({ kind: kind || 'unknown', label, detail: rawInput?.slice(0, 200), event: 'tool_call' });
        } else if (eventType === 'tool_result') {
          onActivity?.({ kind: 'tool_result', label: 'Tool result', event: 'tool_result' });
        } else if (eventType === 'agent_turn_complete') {
          current.status = 'completed';
          const responsePreview = current.output.length > 100
            ? current.output.slice(0, 100) + '\u2026'
            : current.output || '(empty response)';
          onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
          onComplete?.(current.output);
          // Clean up listeners now that the turn is done
          const c = cleanupRef.current.get(taskId);
          if (c) {
            c();
            cleanupRef.current.delete(taskId);
          }
        }
      });

      // Track and auto-approve permission requests for task agents.
      // All write/edit tool calls are stored in permission-store for visibility.
      // Phase 6.5 will add interactive approval UI.
      const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const payload = event.payload;
        const rawOptions = payload.options as unknown[];
        let firstOptionId: string | null = null;
        if (Array.isArray(rawOptions) && rawOptions.length > 0) {
          const opt = rawOptions[0] as Record<string, unknown>;
          firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
        }

        // Track all task agent permission requests in the store
        const tc = payload.toolCall as Record<string, unknown> | null;
        const toolKind = String(tc?.kind ?? tc?.type ?? 'unknown');
        const readOnly = ['read', 'read_file', 'glob', 'list', 'grep', 'fetch', 'web_search'];
        if (!readOnly.includes(toolKind)) {
          const options = Array.isArray(rawOptions)
            ? rawOptions.map((o) => {
                const opt2 = o as Record<string, unknown>;
                return {
                  optionId: String(opt2?.optionId ?? opt2?.id ?? ''),
                  kind: String(opt2?.kind ?? ''),
                  name: String(opt2?.name ?? ''),
                };
              })
            : [];
          usePermissionStore.getState().addRequest({
            id: `${payload.requestId}-${Date.now()}`,
            instanceId,
            sessionId: payload.sessionId,
            requestId: payload.requestId,
            toolKind,
            toolTitle: String(tc?.title ?? tc?.name ?? ''),
            toolInput: String(tc?.rawInput ?? '').slice(0, 200),
            options,
            timestamp: Date.now(),
          });
        }

        // Auto-approve all for now
        const toolLabel = String(tc?.title ?? tc?.name ?? toolKind);
        onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
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

      // Send the prompt — resolves when the agent finishes its turn.
      // Some agents emit `agent_turn_complete` (Claude Code), others don't (Copilot CLI).
      // We handle both: the event listener catches `agent_turn_complete` if it arrives,
      // and `.then()` catches completion when the invoke resolves (fallback).
      invoke('acp_session_prompt', {
        instanceId,
        sessionId: session.session_id,
        content: prompt,
      })
        .then(() => {
          const t = tasksRef.current.get(taskId);
          if (t && t.status === 'running') {
            // agent_turn_complete didn't fire — complete from invoke resolution
            t.status = 'completed';
            const responsePreview = t.output.length > 100
              ? t.output.slice(0, 100) + '\u2026'
              : t.output || '(empty response)';
            onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
            onComplete?.(t.output);
          }
        })
        .catch((error) => {
          const t = tasksRef.current.get(taskId);
          if (t) {
            t.status = 'failed';
            t.error = error instanceof Error ? error.message : String(error);
          }
          const errMsg = error instanceof Error ? error.message : String(error);
          onError?.(errMsg);
        })
        .finally(() => {
          // Clean up event listeners
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

  /** Cancel a running task. Returns true if session was cancelled, false if already done. */
  const cancelTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      const task = tasksRef.current.get(taskId);
      if (!task || task.status !== 'running') return false;

      let cancelled = false;
      try {
        await invoke('acp_session_cancel', {
          instanceId: task.instanceId,
          sessionId: task.sessionId,
        });
        task.status = 'cancelled';
        cancelled = true;
      } catch {
        // Agent may have already completed
      }

      const cleanup = cleanupRef.current.get(taskId);
      if (cleanup) {
        cleanup();
        cleanupRef.current.delete(taskId);
      }
      return cancelled;
    },
    []
  );

  /** Get the current status of a task. */
  const getTask = useCallback((taskId: string): AgentTask | undefined => {
    return tasksRef.current.get(taskId);
  }, []);

  return { startTask, cancelTask, getTask, taskConnection };
}
