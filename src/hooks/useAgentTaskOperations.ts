import { useCallback } from 'react';
import { useRoutingStore } from '@/stores/routing-store';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useActivityStore, type AgentTaskType } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { formatAcpToolName, truncateDetail } from '@/hooks/useAIOperations';
import { log } from '@/lib/logger';

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
  /** Project root the agent was spawned for (sandbox scope). */
  projectRoot: string;
  sessionId: string | null;
}

let taskAgent: TaskAgentState | null = null;

export function stopTaskAgent(): void {
  if (taskAgent) {
    tauriApi.acpAgentStop(taskAgent.instanceId).catch(() => {});
    taskAgent = null;
  }
}

async function ensureTaskAgent(connection: Connection, cwd: string, sandboxPaths?: string[]): Promise<string> {
  // Respawn if connection changed OR project changed (different sandbox scope)
  if (taskAgent && (taskAgent.connectionId !== connection.id || taskAgent.projectRoot !== cwd)) {
    if (taskAgent.projectRoot !== cwd) {
      log.info('ai', `Task agent project changed (${taskAgent.projectRoot} → ${cwd}), respawning for sandbox`);
    }
    try {
      await tauriApi.acpAgentStop(taskAgent.instanceId);
    } catch {
      // Agent may already be stopped
    }
    taskAgent = null;
  }

  // Verify the backend still has this agent (may be gone after app restart or crash)
  if (taskAgent) {
    const alive = await invoke<boolean>('acp_agent_exists', { instanceId: taskAgent.instanceId });
    if (!alive) {
      log.info('ai', `Task agent ${taskAgent.instanceId} no longer exists in backend, respawning`);
      taskAgent = null;
    }
  }

  if (taskAgent) {
    return taskAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] };
  // Inject model flag — codex-acp uses -c model="...", others use --model
  const args = [...(creds.agentArgs ?? [])];
  if (connection.config?.model) {
    let modelId = connection.config.model;
    if (creds.agentBinary === 'codex-acp' && connection.config.reasoningEffort) {
      modelId = `${modelId}/${connection.config.reasoningEffort}`;
    }
    if (creds.agentBinary === 'codex-acp') {
      args.push('-c', `model="${modelId}"`);
    } else {
      args.push('--model', modelId);
    }
  }
  // Build network sandbox config if enabled
  const networkSandboxEnabled = connection.networkSandboxEnabled ?? false;
  let networkAllowedDomains: string[] | null = null;
  if (networkSandboxEnabled) {
    const providerOption = PROVIDER_OPTIONS.find(
      (o) => o.agentBinary === creds.agentBinary || o.lspBinary === creds.agentBinary
    );
    const builtIn = providerOption?.installMeta?.allowedDomains ?? [];
    const permStore = usePermissionStore.getState();
    const userDomains = permStore.getDomainAllowedList(connection.id);
    networkAllowedDomains = [...builtIn, ...userDomains];
  }

  // Delegation: sandbox to single folder only
  const result = await tauriApi.acpAgentSpawn(
    creds.agentBinary,
    args.length > 0 ? args : null,
    'task',
    cwd,
    connection.sandboxEnabled ?? null,
    [...(sandboxPaths ?? (cwd !== '/tmp' ? [cwd] : [])), ...(connection.extraWritablePaths ?? [])],
    networkSandboxEnabled || null,
    networkAllowedDomains,
    connection.kernelNetworkDeny ?? null,
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
    projectRoot: cwd,
    sessionId: null,
  };

  return result.instance_id;
}

// ---------------------------------------------------------------------------
// Task status tracking (module-level, shared across all hook instances)
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface InternalTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  instanceId: string | null;
  sessionId: string | null;
  output: string;
  error?: string;
  createdAt: number;
}

const tasksMap = new Map<string, InternalTask>();
const cleanupMap = new Map<string, () => void>();

// ---------------------------------------------------------------------------
// Callback & metadata types for startTask
// ---------------------------------------------------------------------------

export interface TaskActivityEvent {
  kind: string;
  label: string;
  detail?: string;
  event: 'tool_call' | 'tool_result' | 'agent_responding' | 'agent_complete' | 'permission_auto_approved';
}

export interface TaskCallbacks {
  onComplete?: (output: string) => void;
  onActivity?: (activity: TaskActivityEvent) => void;
  onError?: (error: string) => void;
  onChunk?: (chunk: string) => void;
}

export interface TaskMeta {
  type: AgentTaskType;
  label: string;
  sourceFile?: string;
  commentId?: string;
  documentId?: string;
  /** Project root for sandbox scope — overrides selectedProjectPaths when set. */
  projectRoot?: string;
  /** If provided, reuse this existing activity store task instead of creating a new one. */
  existingTaskId?: string;
  /** When false, skips activity-store tracking (chat mode stays invisible to the agent panel). Default: true. */
  trackInActivityStore?: boolean;
}

// ---------------------------------------------------------------------------
// Shared task setup helper
// ---------------------------------------------------------------------------

function setupTask(
  prompt: string,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): { taskId: string; task: InternalTask; track: boolean } {
  const track = taskMeta?.trackInActivityStore !== false;
  const existingId = taskMeta?.existingTaskId;
  const existingActivityTask = track && existingId
    ? useActivityStore.getState().tasks.find((t) => t.id === existingId)
    : undefined;
  const taskId = existingActivityTask ? existingId! : `task-${Date.now()}`;

  const task: InternalTask = {
    id: taskId,
    prompt,
    status: 'running',
    instanceId: null,
    sessionId: null,
    output: '',
    createdAt: Date.now(),
  };
  tasksMap.set(taskId, task);

  if (track) {
    if (existingActivityTask) {
      useActivityStore.getState().resetTaskForContinuation(taskId);
    } else {
      useActivityStore.getState().addTask({
        id: taskId,
        type: taskMeta?.type ?? 'chat',
        label: taskMeta?.label ?? prompt.slice(0, 50),
        status: 'running',
        sourceFile: taskMeta?.sourceFile,
        commentId: taskMeta?.commentId,
        documentId: taskMeta?.documentId,
        connectionProvider: connection.provider,
      });
    }
  }

  return { taskId, task, track };
}

// ---------------------------------------------------------------------------
// ACP path (agent_managed connections)
// ---------------------------------------------------------------------------

async function startAcpTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
  selectedProjectPaths: string[],
): Promise<string> {
  const { onComplete, onActivity, onError, onChunk } = callbacks ?? {};

  // Use explicit projectRoot from taskMeta (delegation), fall back to chat selection
  const cwd = taskMeta?.projectRoot ?? (selectedProjectPaths[0] || '/tmp');
  const instanceId = await ensureTaskAgent(connection, cwd);
  const session = await tauriApi.acpSessionNew(instanceId, cwd);

  const { taskId, task, track } = setupTask(prompt, taskMeta, connection);
  task.instanceId = instanceId;
  task.sessionId = session.session_id;

  // Listen for session updates
  let receivedFirstChunk = false;
  const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
    if (event.payload.instanceId !== instanceId) return;
    if (event.payload.sessionId !== session.session_id) return;
    const { update } = event.payload;

    const current = tasksMap.get(taskId);
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
      onChunk?.(update.content.text);
      if (track) useActivityStore.getState().appendPartialOutput(taskId, update.content.text);
    } else if (eventType === 'agent_thought_chunk') {
      const text = update.content?.text;
      if (text && track) {
        useActivityStore.getState().appendThinkingOutput(taskId, text);
      }
    } else if (eventType === 'tool_call') {
      const label = formatAcpToolName(update.kind, update.title);
      const detail = truncateDetail(update.rawInput, 200);
      onActivity?.({ kind: update.kind || 'unknown', label, detail: detail || undefined, event: 'tool_call' });
      if (track) {
        useActivityStore.getState().appendActivity(taskId, {
          label,
          detail: detail || undefined,
          status: 'running',
          timestamp: Date.now(),
        });
      }
    } else if (eventType === 'tool_call_update') {
      const label = formatAcpToolName(update.kind, update.title);
      onActivity?.({ kind: update.kind || 'unknown', label, event: 'tool_call' });
    } else if (eventType === 'tool_result') {
      onActivity?.({ kind: 'tool_result', label: 'Tool result', event: 'tool_result' });
      if (track) useActivityStore.getState().completeLastActivity(taskId);
    } else if (eventType === 'agent_turn_complete') {
      current.status = 'completed';
      const responsePreview = current.output.length > 100
        ? current.output.slice(0, 100) + '\u2026'
        : current.output || '(empty response)';
      onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
      onComplete?.(current.output);
      if (track) {
        const activityStore = useActivityStore.getState();
        activityStore.completeAllActivities(taskId);
        activityStore.updateTaskStatus(taskId, 'done');
        activityStore.setFinalOutput(taskId, current.output);
      }
      const c = cleanupMap.get(taskId);
      if (c) { c(); cleanupMap.delete(taskId); }
    }
  });

  const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
    if (event.payload.instanceId !== instanceId) return;
    const payload = event.payload;
    const rawOptions = payload.options;
    let firstOptionId: string | null = null;
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      const opt = rawOptions[0];
      firstOptionId = String(opt?.optionId ?? opt?.id ?? '');
    }

    const tc = payload.toolCall;
    const toolKind = String(tc?.kind ?? tc?.type ?? 'unknown');
    const toolLabel = String(tc?.title ?? tc?.name ?? toolKind);
    const readOnly = ['read', 'read_file', 'glob', 'list', 'grep', 'fetch', 'web_search'];

    // Delegation: auto-approve all tools. The OS-level sandbox is the real
    // enforcement layer — the agent can't access files outside its scoped project.
    // Write tools are logged in the activity panel for transparency.
    if (!readOnly.includes(toolKind)) {
      log.info('ai', `Delegation auto-approved write tool: ${toolLabel} (${toolKind})`);
    }
    onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
    tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {});
  });

  const cleanup = () => { unlisten(); unlistenPermission(); };
  cleanupMap.set(taskId, cleanup);

  // Prepend project scope instruction so the agent respects folder boundaries
  const scopeInstruction = cwd !== '/tmp'
    ? `<project-scope>\nYou are working in the project folder: ${cwd}\nYou MUST only read and write files within this folder. Do NOT access files outside this project. If the user asks you to access files in a different folder, explain that you are scoped to this project and suggest they move the conversation to the chat panel for broader access.\n</project-scope>\n\n`
    : '';
  const scopedPrompt = scopeInstruction + prompt;

  tauriApi.acpSessionPrompt(instanceId, session.session_id, scopedPrompt)
    .then(() => {
      const t = tasksMap.get(taskId);
      if (t && t.status === 'running') {
        t.status = 'completed';
        const responsePreview = t.output.length > 100
          ? t.output.slice(0, 100) + '\u2026'
          : t.output || '(empty response)';
        onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
        onComplete?.(t.output);
        if (track) {
          const as = useActivityStore.getState();
          as.completeAllActivities(taskId);
          as.updateTaskStatus(taskId, 'done');
          as.setFinalOutput(taskId, t.output);
        }
      }
    })
    .catch((error) => {
      const t = tasksMap.get(taskId);
      if (t) {
        t.status = 'failed';
        t.error = error instanceof Error ? error.message : String(error);
      }
      onError?.(error instanceof Error ? error.message : String(error));
      if (track) {
        const as = useActivityStore.getState();
        as.completeAllActivities(taskId);
        as.updateTaskStatus(taskId, 'error');
      }
    })
    .finally(() => {
      const c = cleanupMap.get(taskId);
      if (c) { c(); cleanupMap.delete(taskId); }
    });

  return taskId;
}

// ---------------------------------------------------------------------------
// Direct API path (api_key / local connections — streaming chat)
// ---------------------------------------------------------------------------

async function startDirectApiTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): Promise<string> {
  const { onComplete, onActivity, onError, onChunk } = callbacks ?? {};

  const { taskId, track } = setupTask(prompt, taskMeta, connection);

  // Resolve provider credentials
  let provider: string;
  let apiKey: string | null = null;
  let ollamaUrl: string | null = null;
  const config = connection.config;

  if (connection.credentials.type === 'api_key') {
    provider = connection.provider;
    apiKey = connection.credentials.key;
  } else if (connection.credentials.type === 'local') {
    provider = connection.provider;
    ollamaUrl = connection.credentials.url;
  } else {
    throw new Error('Unsupported credential type for direct API task');
  }

  // Build messages: system + user prompt
  const messages = [
    { role: 'system', content: 'You are a helpful AI assistant working on a delegated task. Respond with your analysis or the requested content.' },
    { role: 'user', content: prompt },
  ];

  // Listen for stream events
  const unlistenChunk = await listen<string>('ai-stream-chunk', (event) => {
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;

    current.output += event.payload;
    onChunk?.(event.payload);
    if (track) useActivityStore.getState().appendPartialOutput(taskId, event.payload);
  });

  const unlistenDone = await listen('ai-stream-done', () => {
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;

    current.status = 'completed';
    const responsePreview = current.output.length > 100
      ? current.output.slice(0, 100) + '\u2026'
      : current.output || '(empty response)';
    onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
    onComplete?.(current.output);
    if (track) {
      const as = useActivityStore.getState();
      as.completeAllActivities(taskId);
      as.updateTaskStatus(taskId, 'done');
      as.setFinalOutput(taskId, current.output);
    }
  });

  const cleanup = () => { unlistenChunk(); unlistenDone(); };
  cleanupMap.set(taskId, cleanup);

  onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });

  // Start streaming
  invoke('ai_chat_stream', {
    messages,
    provider,
    apiKey,
    ollamaUrl,
    webSearchEnabled: false,
    model: config?.model ?? null,
    temperature: config?.temperature ?? null,
    maxTokens: config?.maxTokens ?? null,
    baseUrl: config?.baseUrl ?? null,
  })
    .catch((error) => {
      const t = tasksMap.get(taskId);
      if (t) {
        t.status = 'failed';
        t.error = error instanceof Error ? error.message : String(error);
      }
      onError?.(error instanceof Error ? error.message : String(error));
      if (track) {
        const as = useActivityStore.getState();
        as.completeAllActivities(taskId);
        as.updateTaskStatus(taskId, 'error');
      }
    })
    .finally(() => {
      const c = cleanupMap.get(taskId);
      if (c) { c(); cleanupMap.delete(taskId); }
    });

  return taskId;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentTaskOperations() {
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
      if (!taskConnection) {
        throw new Error('No connection configured for agent tasks. Set up routing in Settings.');
      }

      // Route based on auth method
      if (taskConnection.authMethod === 'agent_managed') {
        return startAcpTask(prompt, callbacks, taskMeta, taskConnection, selectedProjectPaths);
      }
      return startDirectApiTask(prompt, callbacks, taskMeta, taskConnection);
    },
    [taskConnection, selectedProjectPaths]
  );

  /** Cancel a running task. Returns true if session was cancelled, false if already done. */
  const cancelTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      const task = tasksMap.get(taskId);
      if (!task || task.status !== 'running') return false;

      let cancelled = false;

      // ACP tasks have instanceId + sessionId; direct-API tasks don't
      if (task.instanceId && task.sessionId) {
        try {
          await tauriApi.acpSessionCancel(task.instanceId, task.sessionId);
          cancelled = true;
        } catch {
          // Agent may have already completed
        }
      }

      task.status = 'cancelled';

      // Only update activity-store if this task is tracked there
      const as = useActivityStore.getState();
      if (as.tasks.some((t) => t.id === taskId)) {
        as.completeAllActivities(taskId);
        as.updateTaskStatus(taskId, 'cancelled');
      }

      const cleanup = cleanupMap.get(taskId);
      if (cleanup) {
        cleanup();
        cleanupMap.delete(taskId);
      }
      return cancelled;
    },
    []
  );

  /** Get the current status of a task. */
  const getTask = useCallback((taskId: string): InternalTask | undefined => {
    return tasksMap.get(taskId);
  }, []);

  return { startTask, cancelTask, getTask, taskConnection };
}
