import { useCallback } from 'react';
import { useAIStore } from '@/stores/ai-store';
import { useChatStore } from '@/stores/chat-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage } from '@/lib/ai/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function useAIOperations() {
  const { provider, apiKeys, ollamaUrl } = useAIStore();
  const { addMessage, updateMessage, setLoading, setError, setActiveTool } = useChatStore();

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      if (!provider) {
        throw new Error('No AI provider selected');
      }

      try {
        const aiProvider = getAIProvider(
          provider,
          provider === 'ollama' ? undefined : apiKeys[provider],
          ollamaUrl
        );
        return await aiProvider.generateText(prompt);
      } catch (error) {
        console.error('AI generation failed:', error);
        throw error;
      }
    },
    [provider, apiKeys, ollamaUrl]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[]) => {
      if (!provider) {
        throw new Error('No AI provider selected');
      }

      setLoading(true);
      setError(null);

      const userMessage: ChatMessage = { role: 'user', content };
      addMessage(userMessage);

      // Add placeholder message for streaming
      const assistantMessageId = Date.now();
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

        // Listen for stream completion
        const unlistenDone = await listen('ai-stream-done', () => {
          unlistenChunk();
          unlistenTool();
          unlistenDone();
          setLoading(false);
          setActiveTool(null);
        });

        // Start streaming
        await invoke('ai_chat_stream', {
          messages: [...messages, userMessage],
          provider,
          apiKey: provider === 'ollama' ? undefined : apiKeys[provider],
          ollamaUrl,
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        setLoading(false);
        setActiveTool(null);
      }
    },
    [provider, apiKeys, ollamaUrl, addMessage, updateMessage, setLoading, setError, setActiveTool]
  );

  return { generateText, sendChatMessage };
}
