import { useCallback } from 'react';
import { useAIStore } from '@/stores/ai-store';
import { useChatStore } from '@/stores/chat-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage } from '@/lib/ai/types';

export function useAIOperations() {
  const { provider, apiKeys, ollamaUrl } = useAIStore();
  const { addMessage, setLoading, setError } = useChatStore();

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

      try {
        const aiProvider = getAIProvider(
          provider,
          provider === 'ollama' ? undefined : apiKeys[provider],
          ollamaUrl
        );
        const response = await aiProvider.chat([...messages, userMessage]);

        addMessage({ role: 'assistant', content: response });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [provider, apiKeys, ollamaUrl, addMessage, setLoading, setError]
  );

  return { generateText, sendChatMessage };
}
