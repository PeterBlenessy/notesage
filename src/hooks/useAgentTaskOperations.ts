import { useCallback, useRef } from 'react';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { Connection } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { listen } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// ACP event payload types
// ---------------------------------------------------------------------------

interface AcpSessionUpdate {
  sessionUpdate: 'agent_message_chunk' | 'tool_call' | 'tool_result' | 'agent_turn_complete' | string;
  content?: { type: string; text?: string };
  kind?: string;
  title?: string;
  rawInput?: string;
}

interface AcpSessionUpdatePayload {
  instanceId: string;
  sessionId: string;
  update: AcpSessionUpdate;
}

interface AcpToolCall {
  kind?: string;
  type?: string;
  title?: string;
  name?: string;
  rawInput?: string;
}

interface AcpPermissionOption {
  optionId?: string;
  id?: string;
  kind?: string;
  name?: string;
}

interface AcpPermissionRequestPayload {
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolCall: AcpToolCall | null;
  options: AcpPermissionOption[];
}

// ---------------------------------------------------------------------------
// Task agent state (module-level singleton, survives re-renders)
//
// Only one task agent runs at a time. This module-level state is intentional:
// useAgentTaskOperations is called from useCommentDelegation, which is wired
// in a single place (Editor.tsx). If the hook were ever used in multiple
// component trees, they would share this agent instance.
// ---------------------------------------------------------------------------

interface TaskAgentState {
  instanceId: string;
  connectionId: string;
  sessionId: string | null;
}

let taskAgent: TaskAgentState | null = null;

export function stopTaskAgent(): void {
  if (taskAgent) {
    tauriApi.acpAgentStop(taskAgent.instanceId).catch(() => {});
    taskAgent = null;
  }
}

async function ensureTaskAgent(connection: Connection, cwd: string): Promise<string> {
  if (taskAgent && taskAgent.connectionId !== connection.id) {
    try {
      await tauriApi.acpAgentStop(taskAgent.instanceId);
    } catch {
      // Agent may already be stopped
    }
    taskAgent = null;
  }

  if (taskAgent) {
    return taskAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] };
  const result = await tauriApi.acpAgentSpawn(
    creds.agentBinary,
    creds.agentArgs ?? null,
    'task',
    cwd,
  );

  // Try to authenticate — some agents handle auth internally
  try {
    await tauriApi.acpAgentAuthenticate(result.instance_id);
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
      const session = await tauriApi.acpSessionNew(instanceId, cwd);

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
          const label = update.title || update.kind || 'Tool call';
          onActivity?.({ kind: update.kind || 'unknown', label, detail: update.rawInput?.slice(0, 200), event: 'tool_call' });
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
        const rawOptions = payload.options;
        let firstOptionId: string | null = null;
        if (Array.isArray(rawOptions) && rawOptions.length > 0) {
          const opt = rawOptions[0];
          firstOptionId = String(opt?.optionId ?? opt?.id ?? '');
        }

        // Track all task agent permission requests in the store
        const tc = payload.toolCall;
        const toolKind = String(tc?.kind ?? tc?.type ?? 'unknown');
        const readOnly = ['read', 'read_file', 'glob', 'list', 'grep', 'fetch', 'web_search'];
        if (!readOnly.includes(toolKind)) {
          const options = Array.isArray(rawOptions)
            ? rawOptions.map((o) => ({
                optionId: String(o?.optionId ?? o?.id ?? ''),
                kind: String(o?.kind ?? ''),
                name: String(o?.name ?? ''),
              }))
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
        tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
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
      tauriApi.acpSessionPrompt(instanceId, session.session_id, prompt)
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
        await tauriApi.acpSessionCancel(task.instanceId, task.sessionId);
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
