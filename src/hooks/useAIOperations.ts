import { useCallback, useRef, useMemo } from 'react';
import { useAIStore, getAllPersonas, BUILT_IN_PERSONAS } from '@/stores/ai-store';
import { useActiveProject } from '@/hooks/useActiveProject';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatStore } from '@/stores/chat-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage } from '@/lib/ai/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Build a context string from discovered goal files.
 * Returns empty string if no goals exist.
 */
function buildGoalsContext(goalFiles: { name: string; content: string }[]): string {
  if (goalFiles.length === 0) return '';

  const sections = goalFiles
    .map((g) => `### ${g.name}\n${g.content}`)
    .join('\n\n');

  return `## Project Goals\n\nThe following goal files exist in this project:\n\n${sections}`;
}

export function useAIOperations() {
  const aiStore = useAIStore();
  const { apiKeys, ollamaUrl } = aiStore;
  const { addMessage, updateMessage, setLoading, setError, setActiveTool } = useChatStore();
  const cleanupRef = useRef<(() => void) | null>(null);

  // Resolve effective provider: active project override > global
  const { projectPath, metadata } = useActiveProject();
  const effectiveProvider = metadata?.ai.provider ?? aiStore.provider;

  // Resolve effective persona: project override > global
  const effectivePersonaId = metadata?.ai.personaId ?? aiStore.activePersonaId;
  const allPersonas = getAllPersonas(aiStore);
  const effectivePersona = allPersonas.find((p) => p.id === effectivePersonaId) || BUILT_IN_PERSONAS[0];

  // Discover goal files for the active project
  const { goalFiles } = useGoalsDiscovery(projectPath);
  const goalsContext = useMemo(() => buildGoalsContext(goalFiles), [goalFiles]);

  // Compose system message: project context + goals + persona system message
  const projectContext = metadata?.ai.projectContext || '';
  const contextParts = [projectContext, goalsContext].filter(Boolean).join('\n\n');
  const composedSystemMessage = contextParts
    ? `${contextParts}\n\n${effectivePersona.systemMessage}`
    : effectivePersona.systemMessage;

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

        const cleanup = () => {
          unlistenChunk();
          unlistenTool();
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
    [effectiveProvider, apiKeys, ollamaUrl, composedSystemMessage, addMessage, updateMessage, setLoading, setError, setActiveTool]
  );

  return { generateText, sendChatMessage };
}
