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

/**
 * Resolve provider type, API key, and Ollama URL from a Connection.
 * Returns null if the connection uses agent_managed auth (ACP not yet implemented).
 */
function resolveConnectionCredentials(connection: Connection): {
  provider: AIProviderType;
  apiKey: string | undefined;
  ollamaUrl: string | undefined;
} | null {
  if (connection.authMethod === 'agent_managed') {
    // ACP routing will be added in Phase 6b (task #17)
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
      // agent_managed → not yet supported, fall through to ai-store
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
    [resolved, composedSystemMessage]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[]) => {
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
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
    [resolved, composedSystemMessage, webSearchEnabled, addMessage, updateMessage, setLoading, setError, setActiveTool]
  );

  return { generateText, sendChatMessage };
}
