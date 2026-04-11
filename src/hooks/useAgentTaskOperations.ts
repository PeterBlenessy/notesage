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
import { formatAcpToolName, truncateDetail } from '@/lib/ai/acp-utils';
import type { AcpSessionUpdatePayload, AcpPermissionRequestPayload } from '@/lib/ai/acp-utils';
import { isToolCallAllowed } from '@/lib/ai/path-filter';
import { log } from '@/lib/logger';

// Lazy-resolved home directory for path filtering
let _homeDir: string | null = null;
async function getHomeDir(): Promise<string> {
  if (!_homeDir) {
    _homeDir = await tauriApi.getHomeDir();
  }
  return _homeDir;
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

/** Read `taskAgent` without TS narrowing it to `never` after early-return checks. */
function getTaskAgent(): TaskAgentState | null { return taskAgent; }

/** In-flight spawn promise — prevents concurrent callers from double-spawning. */
let taskSpawnPromise: Promise<string> | null = null;

export function stopTaskAgent(): void {
  if (taskAgent) {
    tauriApi.acpAgentStop(taskAgent.instanceId).catch(() => {}); // Expected: best-effort cleanup, agent may already be stopped
    taskAgent = null;
  }
  taskSpawnPromise = null;
}

/** Maximum recursion depth for ensureTaskAgent to prevent infinite loops. */
const MAX_ENSURE_AGENT_DEPTH = 3;

/** @internal Exported for testing only. */
export async function ensureTaskAgent(connection: Connection, cwd: string, sandboxPaths?: string[], _depth = 0): Promise<string> {
  if (_depth > MAX_ENSURE_AGENT_DEPTH) {
    throw new Error('Task agent spawn failed after multiple retries.');
  }
  // Respawn if connection changed OR project changed (different sandbox scope)
  if (taskAgent && (taskAgent.connectionId !== connection.id || taskAgent.projectRoot !== cwd)) {
    try {
      await tauriApi.acpAgentStop(taskAgent.instanceId);
    } catch {
      // Expected: agent may already be stopped or crashed
    }
    taskAgent = null;
    taskSpawnPromise = null;
  }

  // Verify the backend still has this agent (may be gone after app restart or crash)
  if (taskAgent) {
    const alive = await invoke<boolean>('acp_agent_exists', { instanceId: taskAgent.instanceId });
    if (!alive) {
      log.info('ai', `Task agent ${taskAgent.instanceId} no longer exists in backend, respawning`);
      taskAgent = null;
      taskSpawnPromise = null;
    }
  }

  if (taskAgent) {
    return taskAgent.instanceId;
  }

  // If a spawn is already in progress, await it then verify the result
  if (taskSpawnPromise) {
    const instanceId = await taskSpawnPromise;
    // Re-read module-level state after await (may have changed during suspension)
    const current = getTaskAgent();
    // Verify the spawned agent matches our connection (another caller may have changed it)
    if (current?.instanceId === instanceId && current.connectionId === connection.id && current.projectRoot === cwd) {
      return instanceId;
    }
    // Agent changed or was replaced during await — restart the entire check
    return ensureTaskAgent(connection, cwd, sandboxPaths, _depth + 1);
  }

  // Wrap spawn in a tracked promise so concurrent callers await instead of double-spawning
  taskSpawnPromise = (async () => {
    try {
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
    } finally {
      taskSpawnPromise = null;
    }
  })();

  return taskSpawnPromise;
}

// ---------------------------------------------------------------------------
// Task status tracking (module-level, shared across all hook instances)
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InternalTask {
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
  event: 'tool_call' | 'tool_result' | 'agent_responding' | 'agent_complete' | 'permission_auto_approved' | 'tool_denied';
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

  // Use explicit projectRoot from taskMeta (delegation/chat), fall back to chat selection
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
      // Send desktop notification for agent completion
      import('@/lib/notifications').then(({ notify }) => {
        notify('agent_completion', 'Agent completed', responsePreview);
      }).catch(() => {});
      const c = cleanupMap.get(taskId);
      if (c) { c(); cleanupMap.delete(taskId); }
    }
  });

  // Resolve home dir once for path filtering in this task
  const homeDir = await getHomeDir();

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
    const rawInput = typeof tc?.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc?.rawInput ?? '');

    // Path filtering: deny tool calls targeting paths outside the project
    if (cwd && cwd !== '/tmp') {
      const result = isToolCallAllowed(toolKind, rawInput, cwd, homeDir);
      if (!result.allowed) {
        log.info('ai', `Tool call denied: ${toolLabel} targets ${result.deniedPath} outside project ${cwd}`);
        onActivity?.({ kind: 'denied', label: `Denied: ${toolLabel} — outside project scope`, detail: result.deniedPath, event: 'tool_denied' });
        if (track) {
          useActivityStore.getState().appendActivity(taskId, {
            label: `Denied: ${toolLabel} — outside project scope`,
            detail: result.deniedPath,
            status: 'error',
            timestamp: Date.now(),
          });
        }
        tauriApi.acpPermissionRespond(instanceId, payload.requestId, null).catch(() => {}); // Expected: fire-and-forget permission deny
        return;
      }
    }

    // Auto-approve — sandbox is the enforcement layer
    onActivity?.({ kind: 'permission', label: `Auto-approved: ${toolLabel}`, event: 'permission_auto_approved' });
    tauriApi.acpPermissionRespond(instanceId, payload.requestId, firstOptionId).catch(() => {}); // Expected: fire-and-forget permission approve
  });

  const cleanup = () => { unlisten(); unlistenPermission(); };
  cleanupMap.set(taskId, cleanup);

  tauriApi.acpSessionPrompt(instanceId, session.session_id, prompt)
    .then(() => {
      const t = tasksMap.get(taskId);
      if (t && t.status === 'running') {
        t.status = 'completed';
        const responsePreview = t.output.length > 100
          ? t.output.slice(0, 100) + '\u2026'
          : t.output || '(empty response)';
        onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: responsePreview, event: 'agent_complete' });
        onComplete?.(t.output);
        // Send desktop notification for agent completion
        import('@/lib/notifications').then(({ notify }) => {
          notify('agent_completion', 'Agent completed', responsePreview);
        }).catch(() => {});
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (t) {
        t.status = 'failed';
        t.error = errorMsg;
      }
      onError?.(errorMsg);
      // Send desktop notification for agent error
      import('@/lib/notifications').then(({ notify }) => {
        notify('agent_error', 'Agent failed', errorMsg);
      }).catch(() => {});
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
// Copilot LSP path (agent_managed connections with copilot-language-server)
// ---------------------------------------------------------------------------

async function startCopilotLspTask(
  prompt: string,
  callbacks: TaskCallbacks | undefined,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): Promise<string> {
  const { onComplete, onActivity, onError, onChunk } = callbacks ?? {};
  const { taskId, track } = setupTask(prompt, taskMeta, connection);

  // For Copilot LSP, the model must be a copilot/models ID — NOT the ACP
  // agent model ID stored in connection.config.model (which uses a different
  // naming scheme and is rejected by the LSP with "model is not supported").
  // Use only the routing store's per-use-case model selection.
  const model = useRoutingStore.getState().routing.agent_tasks?.model;

  // Latch onto the conversationId from the first event (we don't know it
  // until events arrive because conversation/create blocks until streaming finishes).
  let eventConvId: string | null = null;
  const isOurEvent = (payload: { conversationId?: string }): boolean => {
    if (!payload.conversationId) return true;
    if (eventConvId === null) {
      eventConvId = payload.conversationId;
      return true;
    }
    return payload.conversationId === eventConvId;
  };

  // Listen for streaming events
  const unlistenChunk = await listen<{ text: string; conversationId?: string }>('copilot-chat-chunk', (event) => {
    if (!isOurEvent(event.payload)) return;
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;
    current.output += event.payload.text;
    onChunk?.(event.payload.text);
    if (track) useActivityStore.getState().appendPartialOutput(taskId, event.payload.text);
  });

  const unlistenThinking = await listen<{ text: string; conversationId?: string }>('copilot-chat-thinking', (event) => {
    if (!isOurEvent(event.payload)) return;
    // Thinking events logged but not appended to output
  });

  const unlistenDone = await listen<{ conversationId: string; error?: unknown }>('copilot-chat-done', async (event) => {
    if (!isOurEvent(event.payload)) return;
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;

    // Destroy the conversation
    if (event.payload.conversationId) {
      tauriApi.copilotLspConversationDestroy(event.payload.conversationId).catch(() => {});
    }

    if (event.payload.error) {
      const errMsg = typeof event.payload.error === 'object' && event.payload.error !== null
        ? (event.payload.error as Record<string, unknown>).message as string ?? 'Unknown error'
        : String(event.payload.error);
      current.status = 'failed';
      onError?.(errMsg);
      if (track) useActivityStore.getState().updateTaskStatus(taskId, 'error');
    } else {
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
    }

    cleanup();
  });

  // Tool call handler — execute tools and respond
  const unlistenToolCall = await listen<{ requestId: string; id: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>('copilot-tool-call', async (event) => {
    if (!isOurEvent(event.payload)) return;
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;

    const { requestId, name, arguments: args } = event.payload;
    onActivity?.({ kind: 'tool_call', label: `Tool: ${name}`, detail: JSON.stringify(args).slice(0, 100), event: 'tool_call' });

    try {
      const { executeToolCall } = await import('@/lib/tool-executor');
      const result = await executeToolCall(event.payload.id, name, args);
      await tauriApi.copilotLspToolResult(requestId, {
        status: 'success',
        content: [{ value: typeof result === 'string' ? result : JSON.stringify(result) }],
      });
      onActivity?.({ kind: 'tool_result', label: `Tool result: ${name}`, event: 'tool_result' });
    } catch (err) {
      await tauriApi.copilotLspToolResult(requestId, {
        status: 'error',
        content: [{ value: String(err) }],
      });
    }
  });

  // Tool confirmation handler — auto-approve for agent tasks
  const unlistenConfirm = await listen<{ requestId: string; name: string; conversationId?: string }>('copilot-tool-confirmation', async (event) => {
    if (!isOurEvent(event.payload)) return;
    const current = tasksMap.get(taskId);
    if (!current || current.status !== 'running') return;
    // Auto-approve tool confirmations for agent tasks (same as ACP path)
    await tauriApi.copilotLspToolConfirmationResponse(event.payload.requestId, true);
    onActivity?.({ kind: 'tool_call', label: `Approved: ${event.payload.name}`, event: 'permission_auto_approved' });
  });

  // Context request handler — provide empty context for headless tasks
  const unlistenContext = await listen<{ requestId: string; conversationId?: string }>('copilot-context-request', async (event) => {
    if (!isOurEvent(event.payload)) return;
    await tauriApi.copilotLspContextResponse(event.payload.requestId, [null, null]);
  });

  const cleanup = () => {
    unlistenChunk();
    unlistenThinking();
    unlistenDone();
    unlistenToolCall();
    unlistenConfirm();
    unlistenContext();
  };
  cleanupMap.set(taskId, cleanup);

  onActivity?.({ kind: 'agent_responding', label: 'Agent responding', event: 'agent_responding' });

  // Create conversation and send the prompt
  try {
    await tauriApi.copilotLspConversationCreate(prompt, model);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const current = tasksMap.get(taskId);
    if (current) {
      current.status = 'failed';
    }
    onError?.(errMsg);
    if (track) useActivityStore.getState().updateTaskStatus(taskId, 'error');
    cleanup();
  }

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
  let ollamaUrl: string | null = null;
  const config = connection.config;
  const connectionId = connection.id;

  if (connection.credentials.type === 'api_key') {
    provider = connection.provider;
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
    connectionId,
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
      if (!taskConnection) {
        throw new Error('No connection configured for agent tasks. Set up routing in Settings.');
      }

      // Route based on auth method
      if (taskConnection.authMethod === 'agent_managed') {
        // Check if this is a Copilot LSP connection (uses conversation/* methods, not ACP)
        const creds = taskConnection.credentials;
        if ('agentBinary' in creds && creds.agentBinary === 'copilot-language-server') {
          return startCopilotLspTask(prompt, callbacks, taskMeta, taskConnection);
        }
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
          // Expected: agent session may have already completed or agent crashed
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
