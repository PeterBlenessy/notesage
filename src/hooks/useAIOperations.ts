import { useCallback, useRef, useMemo } from 'react';
import { useAIStore, getAllPersonas, BUILT_IN_PERSONAS } from '@/stores/ai-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatStore } from '@/stores/chat-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage, Citation } from '@/lib/ai/types';
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

export function useAIOperations() {
  const aiStore = useAIStore();
  const { apiKeys, ollamaUrl } = aiStore;
  const { addMessage, updateMessage, setLoading, setError, setActiveTool, selectedProjectPaths, webSearchEnabled } = useChatStore();
  const cleanupRef = useRef<(() => void) | null>(null);

  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Provider/persona overrides only apply when exactly one project is selected
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  const effectiveProvider = singleMetadata?.ai.provider ?? aiStore.provider;
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
      if (!effectiveProvider) {
        throw new Error('No AI provider selected');
      }

      try {
        const aiProvider = getAIProvider(
          effectiveProvider,
          effectiveProvider === 'ollama' ? undefined : apiKeys[effectiveProvider],
          ollamaUrl
        );

        const fullPrompt = `${composedSystemMessage}\n\n${prompt}`;
        return await aiProvider.generateText(fullPrompt);
      } catch (error) {
        console.error('AI generation failed:', error);
        throw error;
      }
    },
    [effectiveProvider, apiKeys, ollamaUrl, composedSystemMessage]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[]) => {
      if (!effectiveProvider) {
        throw new Error('No AI provider selected');
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
          provider: effectiveProvider,
          apiKey: effectiveProvider === 'ollama' ? undefined : apiKeys[effectiveProvider],
          ollamaUrl,
          webSearchEnabled: webSearchEnabled && effectiveProvider !== 'ollama',
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
    [effectiveProvider, apiKeys, ollamaUrl, composedSystemMessage, webSearchEnabled, addMessage, updateMessage, setLoading, setError, setActiveTool]
  );

  return { generateText, sendChatMessage };
}
