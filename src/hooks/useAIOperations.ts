import { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { useAIStore } from '@/stores/ai-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { getAIProvider } from '@/lib/ai';
import type { AIProviderType, ChatMessage, Citation } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { useConnectionsStore } from '@/stores/connections-store';
import { useSkillStore } from '@/stores/skill-store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { friendlyAIError } from '@/lib/ai/errors';
import { buildGoalsContext, buildProjectHeader, buildFileTreeContext } from '@/lib/ai/context';
import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';

// Re-export ACP utilities for external consumers
export { stopAcpAgent, truncateDetail, formatAcpToolName } from '@/hooks/useAcpLifecycle';

// ---------------------------------------------------------------------------
// Credential resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve provider type, API key, Ollama URL, and config from a Connection.
 * Returns null for agent_managed connections (handled via ACP in callbacks).
 */
function resolveConnectionCredentials(connection: Connection, useCaseModelOverride?: string): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
  config: import('@/lib/ai/connections').ConnectionConfig | undefined;
} | null {
  if (connection.authMethod === 'agent_managed') {
    return null;
  }

  const provider = connection.provider as AIProviderType;

  const config = connection.config
    ? { ...connection.config }
    : undefined;
  if (useCaseModelOverride) {
    if (config) {
      config.model = useCaseModelOverride;
    } else {
      return resolveWithConfig(provider, connection, { model: useCaseModelOverride });
    }
  }

  if (connection.credentials.type === 'api_key') {
    return { provider, apiKey: connection.credentials.key, ollamaUrl: undefined, config };
  }

  if (connection.credentials.type === 'local') {
    return { provider, apiKey: undefined, ollamaUrl: connection.credentials.url, config };
  }

  if (connection.credentials.type === 'local_bundled') {
    return { provider: 'local_bundled' as AIProviderType, apiKey: undefined, ollamaUrl: undefined, config };
  }

  return null;
}

function resolveWithConfig(
  provider: AIProviderType,
  connection: Connection,
  configOverride: import('@/lib/ai/connections').ConnectionConfig
): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
  config: import('@/lib/ai/connections').ConnectionConfig | undefined;
} | null {
  const config = { ...connection.config, ...configOverride };
  if (connection.credentials.type === 'api_key') {
    return { provider, apiKey: connection.credentials.key, ollamaUrl: undefined, config };
  }
  if (connection.credentials.type === 'local') {
    return { provider, apiKey: undefined, ollamaUrl: connection.credentials.url, config };
  }
  if (connection.credentials.type === 'local_bundled') {
    return { provider: 'local_bundled' as AIProviderType, apiKey: undefined, ollamaUrl: undefined, config };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAIOperations() {
  const aiStore = useAIStore();
  const { apiKeys, ollamaUrl } = aiStore;
  const { addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, webSearchEnabled } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Resolve interactive connection from routing store
  const interactiveConnection = useRoutingStore((s) => {
    const slot = s.routing.interactive;
    if (!slot?.connectionId) return null;
    return s.getConnectionForUseCase('interactive');
  });

  // Resolve use-case model override from routing store
  const useCaseModel = useRoutingStore((s) => s.routing.interactive?.model);

  // Provider/persona overrides only apply when exactly one project is selected
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  // All connections (for reactivity when a connection referenced by project override is added/removed)
  const connections = useConnectionsStore((s) => s.connections);

  // Resolve the effective connection: project override takes priority over global routing.
  const effectiveConnection = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;
    if (projectProviderOverride) {
      const conn = connections.find((c) => c.id === projectProviderOverride);
      if (conn) return conn;
    }
    return interactiveConnection;
  }, [singleMetadata, interactiveConnection, connections]);

  // Resolve effective provider + credentials
  const resolved = useMemo(() => {
    const projectProviderOverride = singleMetadata?.ai.provider ?? null;

    if (projectProviderOverride) {
      const conn = useConnectionsStore.getState().getConnection(projectProviderOverride);
      if (conn) {
        const fromConn = resolveConnectionCredentials(conn, useCaseModel);
        if (fromConn) return fromConn;
      }

      const legacyProvider = projectProviderOverride as AIProviderType;
      if (['anthropic', 'openai', 'ollama', 'google'].includes(legacyProvider)) {
        return {
          provider: legacyProvider,
          apiKey: legacyProvider === 'ollama' ? undefined : apiKeys[legacyProvider],
          ollamaUrl,
          config: undefined,
        };
      }
    }

    if (interactiveConnection) {
      const fromConnection = resolveConnectionCredentials(interactiveConnection, useCaseModel);
      if (fromConnection) return fromConnection;
    }

    if (aiStore.provider) {
      return {
        provider: aiStore.provider,
        apiKey: aiStore.provider === 'ollama' ? undefined : apiKeys[aiStore.provider],
        ollamaUrl,
        config: undefined,
      };
    }

    return null;
  }, [singleMetadata, interactiveConnection, aiStore.provider, apiKeys, ollamaUrl, useCaseModel]);

  // Active agent body — loaded and stored in state so changes trigger re-render
  const activeAgent = useSkillStore((s) => s.getActiveAgent());
  interface AgentBodyState { name: string; body: string }
  const [agentBody, setAgentBody] = useState<AgentBodyState>({ name: '', body: '' });

  useEffect(() => {
    const agentName = activeAgent?.name ?? '';
    if (!activeAgent || !agentName) {
      setAgentBody({ name: '', body: '' });
      return;
    }
    if (agentBody.name === agentName) return;

    let cancelled = false;
    invoke<{ name: string; body: string; path: string }>('read_agent_content', { agentPath: activeAgent.path })
      .then((content) => { if (!cancelled) setAgentBody({ name: agentName, body: content.body }); })
      .catch(() => { if (!cancelled) setAgentBody({ name: agentName, body: '' }); });
    return () => { cancelled = true; };
  }, [activeAgent?.name, activeAgent?.path, agentBody.name]);

  const agentSystemMessage = agentBody.body || 'You are a helpful writing assistant.';

  // Discover goal files (only when exactly one project is selected)
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const goalsContext = useMemo(() => buildGoalsContext(goalFiles), [goalFiles]);

  // Project file tree for single-project context
  const singleProject = useWorkspaceStore((s) =>
    singleProjectPath ? s.projects.find((p) => p.path === singleProjectPath) : undefined
  );

  // Active file for file awareness
  const activeTab = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });

  // Skill context for AI prompts — filtered by active agent's allowed-tools
  const agentAllowedTools = activeAgent?.allowed_tools;
  const skillDescriptions = useSkillStore((s) => {
    const desc = s.getSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    const active = s.getActiveSkills().filter((sk) => agentAllowedTools.includes(sk.name));
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nAvailable skills:\n${lines.join('\n')}`;
  });
  const notesageSkillDescriptions = useSkillStore((s) => {
    const desc = s.getNotesageSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    const active = s.getActiveSkills().filter(
      (sk) => agentAllowedTools.includes(sk.name) &&
        (sk.source === 'notesage-project' || sk.source === 'notesage-global')
    );
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nNotesage skills:\n${lines.join('\n')}`;
  });
  const agentInstructions = useSkillStore((s) => s.getMergedAgentInstructions());
  const notesageAgentInstructions = useSkillStore((s) => s.getNotesageAgentInstructions());

  // Shared project/goals/file-tree/active-file context builder
  const buildProjectContext = useCallback((): string[] => {
    const parts: string[] = [];

    if (selectedProjectPaths.length === 1) {
      if (singleMetadata) {
        const header = buildProjectHeader(singleMetadata, singleProjectPath!);
        if (header) parts.push(header);
      } else if (singleProjectPath) {
        parts.push(`Project root: ${singleProjectPath}`);
      }
      if (goalsContext) parts.push(goalsContext);
      if (singleProject?.fileTree) {
        const treeContext = buildFileTreeContext(singleProject.fileTree, singleProjectPath!);
        if (treeContext) parts.push(treeContext);
      }
    } else if (selectedProjectPaths.length > 1) {
      const summaries: string[] = [];
      for (const path of selectedProjectPaths) {
        const meta = metadataMap[path];
        if (meta) {
          summaries.push(buildProjectHeader(meta, path));
        } else {
          const name = path.split('/').pop() || path;
          summaries.push(`Project: ${name}\nProject root: ${path}`);
        }
      }
      parts.push(`The user has the following projects selected:\n\n${summaries.join('\n\n')}`);
    }

    if (activeTab) {
      let fileContext = `Currently editing: ${activeTab.filePath}`;
      if (activeTab.fileType === 'markdown' && activeTab.content) {
        const snippet = activeTab.content.slice(0, 500);
        const truncated = activeTab.content.length > 500 ? '...' : '';
        fileContext += `\n\nFile content preview:\n${snippet}${truncated}`;
      }
      parts.push(fileContext);
    }

    return parts;
  }, [selectedProjectPaths, singleProjectPath, singleMetadata, goalsContext, singleProject, activeTab, metadataMap]);

  // Compose system message based on selected projects
  const composedSystemMessage = useMemo(() => {
    const parts = buildProjectContext();
    if (agentInstructions) parts.push(agentInstructions);
    if (agentSystemMessage) parts.unshift(agentSystemMessage);
    if (skillDescriptions) parts.push(skillDescriptions);
    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, agentInstructions, skillDescriptions]);

  // Lightweight system message for local models
  const localSystemMessage = useMemo(() => {
    if (agentSystemMessage) return agentSystemMessage;
    return 'You are a helpful writing assistant. Be concise and focused.';
  }, [agentSystemMessage]);

  // ACP-specific system message: only Notesage-specific skills and instructions
  const acpSystemMessage = useMemo(() => {
    const parts = buildProjectContext();
    if (notesageAgentInstructions) parts.push(notesageAgentInstructions);
    if (agentSystemMessage) {
      parts.push(`<role-instructions>\nYou MUST adopt the following role for all responses in this conversation. This is your primary identity and overrides your default behavior:\n\n${agentSystemMessage}\n</role-instructions>`);
    }
    if (notesageSkillDescriptions) parts.push(notesageSkillDescriptions);
    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, notesageAgentInstructions, notesageSkillDescriptions]);

  // Delegate ACP interactions to the dedicated hook
  const { acpGenerateText, acpSendChatMessage, acpCancelChat } = useAcpLifecycle({
    effectiveConnection,
    acpSystemMessage,
  });

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      // ACP path
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return acpGenerateText(prompt);
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      try {
        const aiProvider = getAIProvider(
          resolved.provider,
          resolved.apiKey,
          resolved.ollamaUrl,
          resolved.config
        );

        const systemPrompt = resolved.provider === 'local_bundled' ? localSystemMessage : composedSystemMessage;
        const fullPrompt = `${systemPrompt}\n\n${prompt}`;
        return await aiProvider.generateText(fullPrompt);
      } catch (error) {
        log.error('ai', 'AI generation failed', error);
        throw error;
      }
    },
    [resolved, composedSystemMessage, localSystemMessage, effectiveConnection, acpGenerateText]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string }) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      // ACP path
      if (effectiveConnection?.authMethod === 'agent_managed') {
        return acpSendChatMessage(content, messages, opts);
      }

      // Direct API path
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

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
        ...(effectiveConnection ? {
          connectionId: effectiveConnection.id,
          connectionLabel: effectiveConnection.label,
          connectionProvider: effectiveConnection.provider,
        } : resolved ? {
          connectionProvider: resolved.provider,
        } : {}),
      });

      let flushInterval: ReturnType<typeof setInterval> | undefined;

      try {
        let streamedContent = '';
        let streamedThinking = '';
        const collectedCitations: Citation[] = [];

        let contentDirty = false;
        let thinkingDirty = false;
        flushInterval = setInterval(() => {
          if (thinkingDirty) {
            updateMessageThinking(assistantMessageId, streamedThinking);
            thinkingDirty = false;
          }
          if (contentDirty) {
            updateMessage(assistantMessageId, streamedContent);
            contentDirty = false;
          }
        }, 50);

        const unlistenChunk = await listen<string>('ai-stream-chunk', (event) => {
          streamedContent += event.payload;
          contentDirty = true;
        });

        const unlistenThinking = await listen<string>('ai-stream-thinking-chunk', (event) => {
          if (import.meta.env.DEV && !streamedThinking) {
            console.log('[AI] Thinking content detected');
          }
          streamedThinking += event.payload;
          thinkingDirty = true;
        });

        const unlistenTool = await listen<{ tool: string; status: string }>('ai-tool-use', (event) => {
          if (event.payload.status === 'start') {
            setActiveTool(event.payload.tool);
          }
        });

        const unlistenCitation = await listen<{ url: string; title: string; cited_text: string }>('ai-citation', (event) => {
          const { url, title, cited_text } = event.payload;
          if (!collectedCitations.some((c) => c.url === url)) {
            collectedCitations.push({ url, title, citedText: cited_text });
          }
        });

        const cleanup = () => {
          clearInterval(flushInterval);
          unlistenChunk();
          unlistenThinking();
          unlistenTool();
          unlistenCitation();
          if (streamedThinking) {
            updateMessageThinking(assistantMessageId, streamedThinking);
          }
          if (collectedCitations.length > 0 || streamedContent) {
            updateMessage(assistantMessageId, streamedContent, collectedCitations.length > 0 ? collectedCitations : undefined);
          }
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        cleanupRef.current = cleanup;

        const unlistenDone = await listen('ai-stream-done', () => {
          unlistenDone();
          cleanup();
        });

        const systemMessage: ChatMessage = {
          role: 'system',
          content: resolved.provider === 'local_bundled' ? localSystemMessage : composedSystemMessage,
        };

        const historyLimit = useSettingsStore.getState().chatHistoryLimit;
        const effectiveHistory = historyLimit > 0 ? messages.slice(-historyLimit) : messages;

        await invoke('ai_chat_stream', {
          messages: [systemMessage, ...effectiveHistory, userMessage],
          provider: resolved.provider,
          apiKey: resolved.apiKey,
          ollamaUrl: resolved.ollamaUrl,
          webSearchEnabled: webSearchEnabled && resolved.provider !== 'ollama',
          model: resolved.config?.model ?? null,
          temperature: resolved.config?.temperature ?? null,
          maxTokens: resolved.config?.maxTokens ?? null,
          baseUrl: resolved.config?.baseUrl ?? null,
        });
      } catch (error) {
        clearInterval(flushInterval);
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        log.error('ai', 'Stream error', error);
        setMessageError(assistantMessageId, friendlyAIError(error, effectiveConnection?.label || resolved?.provider, effectiveConnection?.id));
        setLoading(false);
        setActiveTool(null);
      }
    },
    [resolved, composedSystemMessage, localSystemMessage, webSearchEnabled, addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, effectiveConnection, acpSendChatMessage]
  );

  const cancelChat = useCallback(() => {
    // Clean up direct API listeners
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    // Delegate ACP cancellation
    if (effectiveConnection?.authMethod === 'agent_managed') {
      acpCancelChat();
      return;
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool, effectiveConnection, acpCancelChat]);

  return { generateText, sendChatMessage, cancelChat };
}
