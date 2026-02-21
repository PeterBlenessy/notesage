import { useCallback, useRef, useMemo } from 'react';
import { useAIStore, getAllPersonas, BUILT_IN_PERSONAS } from '@/stores/ai-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatStore } from '@/stores/chat-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';
import { getAIProvider } from '@/lib/ai';
import type { AIProviderType, ChatMessage, Citation } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Build a context string from discovered goal files.
 */
function buildGoalsContext(goalFiles: { name: string; content: string }[]): string {
  if (goalFiles.length === 0) return '';

  const sections = goalFiles
    .map((g) => `### ${g.name}\n${g.content}`)
    .join('\n\n');

  return `## Project Goals\n\nThe following goal files exist in this project:\n\n${sections}`;
}

/**
 * Build a context block for a single project (name, description, custom context).
 */
function buildProjectHeader(metadata: ProjectMetadata): string {
  const lines: string[] = [];
  if (metadata.name) lines.push(`Project: ${metadata.name}`);
  if (metadata.description) lines.push(`Description: ${metadata.description}`);
  if (metadata.ai.projectContext) lines.push(`Project context: ${metadata.ai.projectContext}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ACP types and lazy agent management (module-level)
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

/** Map ACP tool kind/title to a user-friendly label */
function formatAcpToolName(kind?: string, title?: string): string {
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
    default:
      // Fall back to title if available, otherwise generic label
      if (title) return title;
      if (kind) return kind;
      return 'Working';
  }
}

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
async function ensureAcpAgent(connection: Connection, cwd: string): Promise<string> {
  if (acpAgent && acpAgent.connectionId !== connection.id) {
    console.log('[acp] Connection changed, stopping old agent');
    try {
      await invoke('acp_agent_stop', { instanceId: acpAgent.instanceId });
    } catch {
      // Agent may already be stopped
    }
    acpAgent = null;
  }

  if (acpAgent) {
    console.log('[acp] Reusing existing agent', acpAgent.instanceId);
    return acpAgent.instanceId;
  }

  const creds = connection.credentials as { type: 'agent_managed'; agentBinary: string };
  console.log('[acp] Spawning agent:', creds.agentBinary, 'cwd:', cwd);
  const result = await invoke<AcpSpawnResult>('acp_agent_spawn', {
    agentBinary: creds.agentBinary,
    role: 'interactive',
    workingDirectory: cwd,
  });
  console.log('[acp] Agent spawned:', result.instance_id, result.agent_name, result.agent_version);

  // Try to authenticate — some agents handle auth internally
  // (e.g. claude-agent-acp uses Claude CLI's stored credentials)
  try {
    await invoke('acp_agent_authenticate', {
      instanceId: result.instance_id,
    });
    console.log('[acp] Authenticated');
  } catch (authErr) {
    const msg = String(authErr);
    if (!msg.toLowerCase().includes('not implemented')) {
      throw authErr;
    }
    console.log('[acp] Auth not implemented, skipping (agent handles auth internally)');
  }

  acpAgent = {
    instanceId: result.instance_id,
    connectionId: connection.id,
    chatSessionId: null,
  };
  console.log('[acp] Agent ready:', acpAgent.instanceId);

  return result.instance_id;
}

// ---------------------------------------------------------------------------

/**
 * Resolve provider type, API key, and Ollama URL from a Connection.
 * Returns null for agent_managed connections (handled via ACP in callbacks).
 */
function resolveConnectionCredentials(connection: Connection): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
} | null {
  if (connection.authMethod === 'agent_managed') {
    // ACP connections are routed separately in generateText / sendChatMessage
    return null;
  }

  const provider = connection.provider as AIProviderType;

  if (connection.credentials.type === 'api_key') {
    return { provider, apiKey: connection.credentials.key, ollamaUrl: undefined };
  }

  if (connection.credentials.type === 'local') {
    return { provider, apiKey: undefined, ollamaUrl: connection.credentials.url };
  }

  return null;
}

export function useAIOperations() {
  const aiStore = useAIStore();
  const { apiKeys, ollamaUrl } = aiStore;
  const { addMessage, updateMessage, setLoading, setError, setActiveTool, selectedProjectPaths, webSearchEnabled } = useChatStore();
  const cleanupRef = useRef<(() => void) | null>(null);

  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Resolve interactive connection from routing store
  const interactiveConnection = useRoutingStore((s) => {
    const id = s.routing.interactive;
    if (!id) return null;
    return s.getConnectionForUseCase('interactive');
  });

  // Provider/persona overrides only apply when exactly one project is selected
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  // Resolve effective provider + credentials:
  // 1. Project override (v1 compat) → uses old ai-store apiKeys
  // 2. Routing store connection → uses connection credentials
  // 3. Fall back to ai-store (v1 behavior)
  const resolved = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;

    // If project overrides the provider, use old v1 resolution
    if (projectProviderOverride) {
      return {
        provider: projectProviderOverride,
        apiKey: projectProviderOverride === 'ollama' ? undefined : apiKeys[projectProviderOverride],
        ollamaUrl,
      };
    }

    // Try routing store
    if (interactiveConnection) {
      const fromConnection = resolveConnectionCredentials(interactiveConnection);
      if (fromConnection) return fromConnection;
      // agent_managed → handled via ACP in callbacks, fall through to ai-store
    }

    // Fall back to ai-store
    if (aiStore.provider) {
      return {
        provider: aiStore.provider,
        apiKey: aiStore.provider === 'ollama' ? undefined : apiKeys[aiStore.provider],
        ollamaUrl,
      };
    }

    return null;
  }, [singleMetadata, interactiveConnection, aiStore.provider, apiKeys, ollamaUrl]);

  const effectivePersonaId = singleMetadata?.ai.personaId ?? aiStore.activePersonaId;
  const allPersonas = getAllPersonas(aiStore);
  const effectivePersona = allPersonas.find((p) => p.id === effectivePersonaId) || BUILT_IN_PERSONAS[0];

  // Discover goal files (only when exactly one project is selected)
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const goalsContext = useMemo(() => buildGoalsContext(goalFiles), [goalFiles]);

  // Compose system message based on selected projects
  const composedSystemMessage = useMemo(() => {
    const parts: string[] = [];

    if (selectedProjectPaths.length === 1) {
      // Single project — full context + goals
      if (singleMetadata) {
        const header = buildProjectHeader(singleMetadata);
        if (header) parts.push(header);
      }
      if (goalsContext) parts.push(goalsContext);
    } else if (selectedProjectPaths.length > 1) {
      // Multiple projects — include each project's summary
      const summaries: string[] = [];
      for (const path of selectedProjectPaths) {
        const meta = metadataMap[path];
        if (meta) {
          summaries.push(buildProjectHeader(meta));
        } else {
          const name = path.split('/').pop() || path;
          summaries.push(`Project: ${name}`);
        }
      }
      parts.push(`The user has the following projects selected:\n\n${summaries.join('\n\n')}`);
    }
    // selectedProjectPaths.length === 0 → no project context

    if (parts.length > 0) {
      return `${parts.join('\n\n')}\n\n${effectivePersona.systemMessage}`;
    }

    return effectivePersona.systemMessage;
  }, [selectedProjectPaths, singleMetadata, goalsContext, metadataMap, effectivePersona.systemMessage]);

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      // ACP path: route through agent for agent_managed connections
      if (interactiveConnection?.authMethod === 'agent_managed') {
        const cwd = selectedProjectPaths[0] || '/tmp';
        let instanceId: string;
        try {
          instanceId = await ensureAcpAgent(interactiveConnection, cwd);
        } catch (error) {
          acpAgent = null;
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
          const rawOptions = payload.options as unknown[];
          let firstOptionId: string | null = null;
          if (Array.isArray(rawOptions) && rawOptions.length > 0) {
            const opt = rawOptions[0] as Record<string, unknown>;
            firstOptionId = typeof opt === 'string' ? opt : String(opt?.id ?? '');
          }
          console.log('[acp] Auto-approving permission (inline):', payload.requestId, 'option:', firstOptionId);
          invoke('acp_permission_respond', {
            instanceId,
            requestId: payload.requestId,
            optionId: firstOptionId,
          }).catch(() => {});
        });

        try {
          const fullPrompt = `${composedSystemMessage}\n\n${prompt}`;
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: session.session_id,
            content: fullPrompt,
          });
          return result;
        } catch (error) {
          acpAgent = null;
          throw error;
        } finally {
          unlisten();
          unlistenPermission();
        }
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      try {
        const aiProvider = getAIProvider(
          resolved.provider,
          resolved.apiKey,
          resolved.ollamaUrl
        );

        const fullPrompt = `${composedSystemMessage}\n\n${prompt}`;
        return await aiProvider.generateText(fullPrompt);
      } catch (error) {
        console.error('AI generation failed:', error);
        throw error;
      }
    },
    [resolved, composedSystemMessage, interactiveConnection, selectedProjectPaths]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[]) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      console.log('[acp] interactiveConnection:', interactiveConnection?.id, interactiveConnection?.authMethod, '| resolved:', resolved?.provider);

      // ACP path: route through agent for agent_managed connections
      if (interactiveConnection?.authMethod === 'agent_managed') {
        console.log('[acp] sendChatMessage via ACP');
        setLoading(true);
        setError(null);

        const userTimestamp = Date.now();
        const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp };
        addMessage(userMessage);
        const assistantMessageId = userTimestamp + 1;
        addMessage({ role: 'assistant', content: '', timestamp: assistantMessageId });

        try {
          const cwd = selectedProjectPaths[0] || '/tmp';
          const instanceId = await ensureAcpAgent(interactiveConnection, cwd);

          // New conversation (no prior messages) → create a fresh session
          let isNewSession = false;
          if (messages.length === 0 && acpAgent) {
            acpAgent.chatSessionId = null;
          }

          if (!acpAgent!.chatSessionId) {
            const session = await invoke<AcpSessionResult>('acp_session_new', {
              instanceId,
              workingDirectory: cwd,
            });
            acpAgent!.chatSessionId = session.session_id;
            isNewSession = true;
            console.log('[acp] New session:', session.session_id);
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
              if (chunkCount === 1) console.log('[acp] Receiving streamed response...');
            } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
              const kind = (update as Record<string, unknown>).kind as string | undefined;
              const title = (update as Record<string, unknown>).title as string | undefined;
              const toolLabel = formatAcpToolName(kind, title);
              setActiveTool(toolLabel);
            } else if (update.sessionUpdate === 'agent_turn_complete') {
              setActiveTool(null);
            } else {
              // Log full payload for all other update types so we can see what's available
              console.log('[acp] Session update:', update.sessionUpdate, JSON.stringify(update, null, 2));
            }
          });

          // Auto-approve permission requests (proper permission UI is Phase 6.5)
          const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
            if (event.payload.instanceId !== instanceId) return;
            const payload = event.payload;
            console.log('[acp] Permission request:', JSON.stringify(payload, null, 2));
            // Extract first option ID — handle both { id: "..." } and plain string formats
            const rawOptions = payload.options as unknown[];
            let firstOptionId: string | null = null;
            if (Array.isArray(rawOptions) && rawOptions.length > 0) {
              const opt = rawOptions[0] as Record<string, unknown>;
              firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
            }
            console.log('[acp] Auto-approving permission:', payload.requestId, 'option:', firstOptionId);
            invoke('acp_permission_respond', {
              instanceId,
              requestId: payload.requestId,
              optionId: firstOptionId,
            }).catch((err) => console.error('[acp] Permission respond failed:', err));
          });

          cleanupRef.current = () => {
            unlisten();
            unlistenPermission();
            setLoading(false);
            setActiveTool(null);
            cleanupRef.current = null;
          };

          try {
            // Prepend system prompt on the first message of a new session
            const promptContent = isNewSession
              ? `${composedSystemMessage}\n\n${content}`
              : content;
            console.log('[acp] Sending prompt to session:', acpAgent!.chatSessionId, isNewSession ? '(with system prompt)' : '(follow-up)');
            await invoke('acp_session_prompt', {
              instanceId,
              sessionId: acpAgent!.chatSessionId,
              content: promptContent,
            });
            console.log('[acp] Prompt completed, chunks received:', chunkCount);
          } finally {
            if (cleanupRef.current) {
              cleanupRef.current();
            }
          }
        } catch (error) {
          if (cleanupRef.current) {
            cleanupRef.current();
          }
          acpAgent = null;
          console.error('[acp] Error:', error);
          setError(error instanceof Error ? error.message : 'ACP agent error');
          setLoading(false);
          setActiveTool(null);
        }

        return;
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp };
      addMessage(userMessage);

      // Add placeholder message for streaming - ensure unique timestamp
      const assistantMessageId = userTimestamp + 1;
      addMessage({ role: 'assistant', content: '', timestamp: assistantMessageId });

      try {
        let streamedContent = '';
        const collectedCitations: Citation[] = [];

        // Listen for stream chunks
        const unlistenChunk = await listen<string>('ai-stream-chunk', (event) => {
          streamedContent += event.payload;
          updateMessage(assistantMessageId, streamedContent);
        });

        // Listen for tool use events
        const unlistenTool = await listen<{ tool: string; status: string }>('ai-tool-use', (event) => {
          if (event.payload.status === 'start') {
            setActiveTool(event.payload.tool);
          }
        });

        // Listen for citation events from web search
        const unlistenCitation = await listen<{ url: string; title: string; cited_text: string }>('ai-citation', (event) => {
          const { url, title, cited_text } = event.payload;
          if (!collectedCitations.some((c) => c.url === url)) {
            collectedCitations.push({ url, title, citedText: cited_text });
          }
        });

        const cleanup = () => {
          unlistenChunk();
          unlistenTool();
          unlistenCitation();
          // Attach collected citations to the final message
          if (collectedCitations.length > 0) {
            updateMessage(assistantMessageId, streamedContent, collectedCitations);
          }
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        // Store cleanup so it can be called if a new message is sent before this finishes
        cleanupRef.current = cleanup;

        // Listen for stream completion
        const unlistenDone = await listen('ai-stream-done', () => {
          unlistenDone();
          cleanup();
        });

        // System message with composed content (project context + goals + persona)
        const systemMessage: ChatMessage = {
          role: 'system',
          content: composedSystemMessage,
        };

        // Start streaming
        await invoke('ai_chat_stream', {
          messages: [systemMessage, ...messages, userMessage],
          provider: resolved.provider,
          apiKey: resolved.apiKey,
          ollamaUrl: resolved.ollamaUrl,
          webSearchEnabled: webSearchEnabled && resolved.provider !== 'ollama',
        });
      } catch (error) {
        // Clean up listeners on error
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        setError(error instanceof Error ? error.message : 'Unknown error');
        setLoading(false);
        setActiveTool(null);
      }
    },
    [resolved, composedSystemMessage, webSearchEnabled, addMessage, updateMessage, setLoading, setError, setActiveTool, interactiveConnection, selectedProjectPaths]
  );

  const cancelChat = useCallback(() => {
    // Clean up listeners and reset loading state
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    // Cancel ACP session if active
    if (acpAgent?.chatSessionId && acpAgent?.instanceId) {
      console.log('[acp] Cancelling session:', acpAgent.chatSessionId);
      invoke('acp_session_cancel', {
        instanceId: acpAgent.instanceId,
        sessionId: acpAgent.chatSessionId,
      }).catch((err) => console.error('[acp] Cancel failed:', err));
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { generateText, sendChatMessage, cancelChat };
}
