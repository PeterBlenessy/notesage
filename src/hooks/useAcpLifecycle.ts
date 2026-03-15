import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, selectProjectPaths, selectPendingProjectSwitch } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { setAgentModels } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { friendlyAIError } from '@/lib/ai/errors';
import { useWorkspaceStore } from '@/stores/workspace-store';

/** Get all workspace folder paths (projects + explorer folders) for sandbox scope */
function getAllWorkspacePaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const paths = new Set<string>();
  for (const p of ws.projects) paths.add(p.path);
  for (const f of ws.explorerFolders) paths.add(f.path);
  return [...paths];
}

// ---------------------------------------------------------------------------
// ACP types
// ---------------------------------------------------------------------------

interface AcpSpawnResult {
  instance_id: string;
  agent_name: string | null;
  agent_version: string | null;
  auth_methods: { id: string; name: string; description: string | null }[];
  sandbox_enabled: boolean;
}

interface AcpModelInfo {
  model_id: string;
  name: string;
  description: string | null;
}

interface AcpSessionResult {
  session_id: string;
  current_model: string | null;
  available_models: AcpModelInfo[];
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
  options: unknown[];
}

// ---------------------------------------------------------------------------
// Pure utility functions (shared with useAgentTaskOperations)
// ---------------------------------------------------------------------------

/** Extract tool kind and title from an ACP toolCall payload. */
function extractToolInfo(toolCall: unknown): { kind: string; title: string; input: string } {
  const tc = toolCall as Record<string, unknown> | null;
  return {
    kind: String(tc?.kind ?? tc?.type ?? 'unknown'),
    title: String(tc?.title ?? tc?.name ?? ''),
    input: typeof tc?.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc?.rawInput ?? ''),
  };
}

/** Truncate a tool detail string (e.g. rawInput) for display. */
export function truncateDetail(text: unknown, max = 80): string {
  const str = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  const oneLine = str.replace(/\n/g, ' ').trim();
  // Skip empty or meaningless values
  if (!oneLine || oneLine === '{}' || oneLine === '""' || oneLine === 'null') return '';
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + '…';
}

/** Map ACP tool kind/title to a user-friendly label */
export function formatAcpToolName(kind?: string, title?: string): string {
  switch (kind) {
    case 'fetch':
      return 'Searching the web';
    case 'bash':
    case 'terminal':
      return 'Running command';
    case 'read':
    case 'read_file':
      return 'Reading file';
    case 'write':
    case 'write_file':
    case 'edit':
      return 'Editing file';
    case 'glob':
    case 'list':
      return 'Searching files';
    case 'grep':
      return 'Searching content';
    case 'execute_skill_script':
      return 'Running skill script';
    case 'read_skill_content':
      return 'Loading skill';
    default:
      // Fall back to title if available, otherwise generic label
      if (title) return title;
      if (kind) return kind;
      return 'Working';
  }
}

// ---------------------------------------------------------------------------
// ACP agent state (module-level singleton — survives re-renders)
// ---------------------------------------------------------------------------

interface AcpAgentState {
  instanceId: string;
  connectionId: string;
  chatSessionId: string | null;
}

/** Persistent ACP agent state — survives re-renders, reset on connection change. */
let acpAgent: AcpAgentState | null = null;

/** Stop any running ACP agent and clear state. Called on disconnect. */
export function stopAcpAgent(): void {
  if (acpAgent) {
    invoke('acp_agent_stop', { instanceId: acpAgent.instanceId }).catch(() => {});
    acpAgent = null;
  }
}

/**
 * Ensure an ACP agent is spawned and authenticated for the given connection.
 * Reuses the existing agent if the connection matches. Stops and replaces
 * if the connection changed.
 */
async function ensureAcpAgent(connection: Connection, cwd: string, sandboxPaths?: string[]): Promise<string> {
  if (acpAgent && acpAgent.connectionId !== connection.id) {
    try {
      await invoke('acp_agent_stop', { instanceId: acpAgent.instanceId });
    } catch {
      // Agent may already be stopped
    }
    acpAgent = null;
  }

  if (acpAgent) {
    return acpAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string; agentArgs?: string[] };
  // Inject model flag if the connection has a model configured
  // Different agents use different flag formats:
  //   codex-acp: -c model="<model>"
  //   others:    --model <model>
  const args = [...(creds.agentArgs ?? [])];
  if (connection.config?.model) {
    if (creds.agentBinary === 'codex-acp') {
      args.push('-c', `model="${connection.config.model}"`);
    } else {
      args.push('--model', connection.config.model);
    }
  }
  const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
    agentBinary: creds.agentBinary,
    agentArgs: args.length > 0 ? args : null,
    role: 'interactive',
    workingDirectory: cwd,
    sandboxPaths: sandboxPaths ?? null,
  });
  // Try to authenticate — some agents handle auth internally
  // (e.g. claude-agent-acp uses Claude CLI's stored credentials)
  try {
    await invoke('acp_agent_authenticate', {
      instanceId: result.instance_id,
    });
  } catch (authErr) {
    const msg = String(authErr);
    if (!msg.toLowerCase().includes('not implemented')) {
      throw authErr;
    }
  }

  acpAgent = {
    instanceId: result.instance_id,
    connectionId: connection.id,
    chatSessionId: null,
  };
  return result.instance_id;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface AcpLifecycleParams {
  effectiveConnection: Connection | null;
  acpSystemMessage: string;
}

export function useAcpLifecycle({ effectiveConnection, acpSystemMessage }: AcpLifecycleParams) {
  const { addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Respawn agent when workspace folders change (sandbox paths need updating)
  const workspaceProjects = useWorkspaceStore((s) => s.projects);
  const workspaceExplorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const prevWorkspaceKeyRef = useRef('');
  useEffect(() => {
    const key = [
      ...workspaceProjects.map((p) => p.path),
      ...workspaceExplorerFolders.map((f) => f.path),
    ].sort().join('|');

    if (prevWorkspaceKeyRef.current && prevWorkspaceKeyRef.current !== key && acpAgent) {
      log.info('ai', 'Workspace folders changed — restarting agent for updated sandbox');
      stopAcpAgent();
    }
    prevWorkspaceKeyRef.current = key;
  }, [workspaceProjects, workspaceExplorerFolders]);

  /**
   * Generate text via ACP agent (single-turn, auto-approve permissions).
   * Used for inline actions (Improve, Summarize, Expand).
   */
  const acpGenerateText = useCallback(
    async (prompt: string): Promise<string> => {
      if (!effectiveConnection) throw new Error('No ACP connection');

      const cwd = selectedProjectPaths[0] || '/tmp';
      let instanceId: string;
      try {
        // Inline actions: sandbox to the document's parent folder only
        const inlineSandboxPaths = cwd !== '/tmp' ? [cwd] : [];
        instanceId = await ensureAcpAgent(effectiveConnection, cwd, inlineSandboxPaths);
      } catch (error) {
        stopAcpAgent();
        throw error;
      }

      // Fresh session per inline action (no multi-turn)
      const session = await invoke<AcpSessionResult>('acp_session_new', {
        instanceId,
        workingDirectory: cwd,
      });

      let result = '';
      const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const { update } = event.payload;
        if (
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content?.type === 'text' &&
          update.content.text
        ) {
          result += update.content.text;
        }
      });

      // Auto-approve permission requests for inline actions
      const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const payload = event.payload;
        let firstOptionId: string | null = null;
        if (Array.isArray(payload.options) && payload.options.length > 0) {
          const opt = payload.options[0] as Record<string, unknown>;
          firstOptionId = typeof opt === 'string' ? opt : String(opt?.id ?? '');
        }
        invoke('acp_permission_respond', {
          instanceId,
          requestId: payload.requestId,
          optionId: firstOptionId,
        }).catch(() => {});
      });

      try {
        const fullPrompt = `${acpSystemMessage}\n\n${prompt}`;
        await invoke('acp_session_prompt', {
          instanceId,
          sessionId: session.session_id,
          content: fullPrompt,
        });
        return result;
      } catch (error) {
        stopAcpAgent();
        throw error;
      } finally {
        unlisten();
        unlistenPermission();
      }
    },
    [effectiveConnection, acpSystemMessage, selectedProjectPaths]
  );

  /**
   * Send a chat message via ACP agent (multi-turn with permission handling).
   */
  const acpSendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string }) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (!effectiveConnection) throw new Error('No ACP connection');

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp, displayContent: opts?.displayContent, skillName: opts?.skillName };
      addMessage(userMessage);
      const assistantMessageId = userTimestamp + 1;
      addMessage({
        role: 'assistant',
        content: '',
        timestamp: assistantMessageId,
        connectionId: effectiveConnection.id,
        connectionLabel: effectiveConnection.label,
        connectionProvider: effectiveConnection.provider,
      });

      try {
        const cwd = selectedProjectPaths[0] || '/tmp';
        // Chat: sandbox covers all workspace folders for instant project switching
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, getAllWorkspacePaths());

        // Block sending if a project switch is pending user decision
        const pendingSwitch = selectPendingProjectSwitch(useChatStore.getState());
        if (pendingSwitch) {
          throw new Error('Please resolve the project context change before sending a message.');
        }

        // Use segment-based session tracking for context isolation
        const segment = useChatStore.getState().getActiveSegment();
        let isNewSession = false;

        // New conversation or new segment → need a fresh ACP session
        if (messages.length === 0 && acpAgent) {
          acpAgent.chatSessionId = null;
        }
        // Segment has no session yet (new segment from project switch)
        if (segment && !segment.sessionId) {
          acpAgent!.chatSessionId = null;
        }

        if (!acpAgent!.chatSessionId) {
          const session = await invoke<AcpSessionResult>('acp_session_new', {
            instanceId,
            workingDirectory: cwd,
          });
          acpAgent!.chatSessionId = session.session_id;
          isNewSession = true;

          // Track session in the segment
          useChatStore.getState().setSegmentSessionId(session.session_id);

          // Cache available models from the agent for the config dialog
          if (session.available_models.length > 0 && effectiveConnection) {
            setAgentModels(
              effectiveConnection.id,
              session.available_models.map((m) => ({
                modelId: m.model_id,
                name: m.name,
                description: m.description,
              })),
              session.current_model,
            );
          }
        }

        let streamedContent = '';
        let chunkCount = 0;

        const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;

          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content?.type === 'text' &&
            update.content.text
          ) {
            chunkCount++;
            streamedContent += update.content.text;
            updateMessage(assistantMessageId, streamedContent);
          } else if (update.sessionUpdate === 'tool_call') {
            const kind = (update as Record<string, unknown>).kind as string | undefined;
            const title = (update as Record<string, unknown>).title as string | undefined;
            const rawInput = (update as Record<string, unknown>).rawInput as string | undefined;
            const toolLabel = formatAcpToolName(kind, title);
            setActiveTool(toolLabel);
            addActivity(assistantMessageId, {
              kind: kind || 'unknown',
              label: toolLabel,
              detail: rawInput ? truncateDetail(rawInput) : undefined,
              status: 'running',
              timestamp: Date.now(),
            });
          } else if (update.sessionUpdate === 'tool_call_update') {
            const kind = (update as Record<string, unknown>).kind as string | undefined;
            const title = (update as Record<string, unknown>).title as string | undefined;
            const toolLabel = formatAcpToolName(kind, title);
            setActiveTool(toolLabel);
          } else if (update.sessionUpdate === 'tool_result') {
            setActiveTool(null);
            completeLastActivity(assistantMessageId);
          } else if (update.sessionUpdate === 'agent_turn_complete') {
            setActiveTool(null);
            completeAllActivities(assistantMessageId);
          }
        });

        // Handle permission requests: auto-approve read-only tools,
        // show inline permission card for write tools (user must Allow/Deny).
        const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const payload = event.payload;

          // Clear the active tool spinner — the previous tool finished,
          // now the agent is asking permission for the next action.
          setActiveTool(null);

          const toolInfo = extractToolInfo(payload.toolCall);
          const rawOptions = payload.options as unknown[];
          let firstOptionId: string | null = null;
          if (Array.isArray(rawOptions) && rawOptions.length > 0) {
            const opt = rawOptions[0] as Record<string, unknown>;
            firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
          }

          if (usePermissionStore.getState().isAutoAllowed(toolInfo.kind)) {
            // Tool kinds in session or always allow-lists: auto-approve silently
            invoke('acp_permission_respond', {
              instanceId,
              requestId: payload.requestId,
              optionId: firstOptionId,
            }).catch(() => {});
          } else {
            // Write tools: add to permission store, let PermissionCard UI handle response
            const options = Array.isArray(rawOptions)
              ? rawOptions.map((o) => {
                  const opt = o as Record<string, unknown>;
                  return {
                    optionId: String(opt?.optionId ?? opt?.id ?? ''),
                    kind: String(opt?.kind ?? ''),
                    name: String(opt?.name ?? ''),
                  };
                })
              : [];

            usePermissionStore.getState().addRequest({
              id: `${payload.requestId}-${Date.now()}`,
              instanceId,
              sessionId: payload.sessionId,
              requestId: payload.requestId,
              toolKind: toolInfo.kind,
              toolTitle: toolInfo.title,
              toolInput: truncateDetail(toolInfo.input, 200),
              options,
              timestamp: Date.now(),
            });
          }
        });

        cleanupRef.current = () => {
          unlisten();
          unlistenPermission();
          // Deny any pending permission requests for this agent and clear from store
          const pendingRequests = usePermissionStore.getState().requests.filter(
            (r) => r.instanceId === instanceId
          );
          for (const req of pendingRequests) {
            invoke('acp_permission_respond', {
              instanceId,
              requestId: req.requestId,
              optionId: null,
            }).catch(() => {});
          }
          usePermissionStore.getState().clearRequestsForInstance(instanceId);
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        try {
          // Prepend system prompt on the first message of a new session
          const promptContent = isNewSession
            ? `${acpSystemMessage}\n\n${content}`
            : content;
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: acpAgent!.chatSessionId,
            content: promptContent,
          });
        } finally {
          if (cleanupRef.current) {
            cleanupRef.current();
          }
        }
      } catch (error) {
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        stopAcpAgent();
        log.error('ai', 'ACP chat error', error);
        setMessageError(assistantMessageId, friendlyAIError(error, effectiveConnection?.label || effectiveConnection?.provider));
        setLoading(false);
        setActiveTool(null);
      }
    },
    [effectiveConnection, acpSystemMessage, selectedProjectPaths, addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities]
  );

  /**
   * Cancel an active ACP chat session.
   */
  const acpCancelChat = useCallback(() => {
    // Clean up listeners and reset loading state
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    // Cancel ACP session if active
    if (acpAgent?.chatSessionId && acpAgent?.instanceId) {
      // Deny any pending permission requests before cancelling
      const pendingRequests = usePermissionStore.getState().requests.filter(
        (r) => r.instanceId === acpAgent!.instanceId
      );
      for (const req of pendingRequests) {
        invoke('acp_permission_respond', {
          instanceId: acpAgent!.instanceId,
          requestId: req.requestId,
          optionId: null,
        }).catch(() => {});
      }
      usePermissionStore.getState().clearRequestsForInstance(acpAgent!.instanceId);

      invoke('acp_session_cancel', {
        instanceId: acpAgent.instanceId,
        sessionId: acpAgent.chatSessionId,
      }).catch(() => {});
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { acpGenerateText, acpSendChatMessage, acpCancelChat };
}
