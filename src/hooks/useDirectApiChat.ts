import { useCallback, useRef } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage, Citation } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import type { ResolvedCredentials } from '@/lib/ai/credentials';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { friendlyAIError } from '@/lib/ai/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectApiChatParams {
  resolved: ResolvedCredentials | null;
  effectiveConnection: Connection | null;
  buildComposedSystemMessage: (attachedFilePaths?: string[]) => string;
  composedSystemMessage: string;
  localSystemMessage: string;
}

interface SendChatOpts {
  displayContent?: string;
  skillName?: string;
  attachedFilePaths?: string[];
  sandboxPaths?: string[];
}

// ---------------------------------------------------------------------------
// Hook — handles all direct API streaming (Anthropic, OpenAI, Ollama, local)
// ---------------------------------------------------------------------------

export function useDirectApiChat({
  resolved,
  effectiveConnection,
  buildComposedSystemMessage,
  composedSystemMessage,
  localSystemMessage,
}: DirectApiChatParams) {
  const { addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool } = useChatStore();
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled);
  const cleanupRef = useRef<(() => void) | null>(null);

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      try {
        const aiProvider = getAIProvider(
          resolved.provider,
          resolved.connectionId,
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
    [resolved, composedSystemMessage, localSystemMessage]
  );

  const sendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: SendChatOpts) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

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

        const [unlistenChunk, unlistenThinking, unlistenTool, unlistenCitation] = await Promise.all([
          listen<string>('ai-stream-chunk', (event) => {
            streamedContent += event.payload;
            contentDirty = true;
          }),
          listen<string>('ai-stream-thinking-chunk', (event) => {
            if (!streamedThinking) {
              log.debug('ai', 'Thinking content detected');
            }
            streamedThinking += event.payload;
            thinkingDirty = true;
          }),
          listen<{ tool: string; status: string }>('ai-tool-use', (event) => {
            if (event.payload.status === 'start') {
              setActiveTool(event.payload.tool);
            }
          }),
          listen<{ url: string; title: string; cited_text: string }>('ai-citation', (event) => {
            const { url, title, cited_text } = event.payload;
            if (!collectedCitations.some((c) => c.url === url)) {
              collectedCitations.push({ url, title, citedText: cited_text });
            }
          }),
        ]);

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
          content: resolved.provider === 'local_bundled' ? localSystemMessage : buildComposedSystemMessage(opts?.attachedFilePaths),
        };

        const historyLimit = useSettingsStore.getState().chatHistoryLimit;
        const effectiveHistory = historyLimit > 0 ? messages.slice(-historyLimit) : messages;

        await invoke('ai_chat_stream', {
          messages: [systemMessage, ...effectiveHistory, userMessage],
          provider: resolved.provider,
          connectionId: resolved.connectionId,
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
    [resolved, buildComposedSystemMessage, localSystemMessage, webSearchEnabled, addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, effectiveConnection]
  );

  const cancelDirectChat = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { generateText, sendChatMessage, cancelDirectChat };
}
