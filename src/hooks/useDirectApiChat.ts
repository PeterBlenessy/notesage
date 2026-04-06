import { useCallback, useRef } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore, type ToolCallDecision } from '@/stores/tool-permission-store';
import { useSkillStore } from '@/stores/skill-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage, Citation, ToolDefinition, ToolCallSegment, ImageAttachment } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import type { ResolvedCredentials } from '@/lib/ai/credentials';
import { executeToolCall } from '@/lib/tool-executor';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { friendlyAIError } from '@/lib/ai/errors';
import { formatToolLabel } from '@/lib/ai/acp-utils';

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
  parentId?: string | null;
  attachments?: ImageAttachment[];
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Maximum tool calls allowed per user turn to prevent runaway loops. */
const MAX_TOOL_CALLS_PER_TURN = 20;

/** Map ChatMessage attachments to the Rust `images` field format for ai_chat_stream. */
function mapMessagesForRust(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map(m => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCalls) msg.tool_calls = m.toolCalls;
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.attachments && m.attachments.length > 0) {
      msg.images = m.attachments.map(a => ({ data: a.data, mime_type: a.mimeType }));
    }
    return msg;
  });
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
  const { addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, addActivity, appendTextSegment, pushSegment, updateSegment, finalizeSegments } = useChatStore();
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
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp, displayContent: opts?.displayContent, skillName: opts?.skillName, attachments: opts?.attachments, ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}) };
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

        // Tool call state — scoped to this streaming session
        const pendingToolCalls: PendingToolCall[] = [];
        let toolCallCount = 0;

        // Segment tracking for thinking blocks
        let thinkingSegmentIndex = -1;
        let thinkingSegmentContent = '';

        // Tracks messages accumulated during multi-turn tool call loops.
        // Starts with the initial history + user message, then grows with
        // assistant tool_call messages and tool result messages.
        const systemMessage: ChatMessage = {
          role: 'system',
          content: resolved.provider === 'local_bundled' ? localSystemMessage : buildComposedSystemMessage(opts?.attachedFilePaths),
        };
        const historyLimit = useSettingsStore.getState().chatHistoryLimit;
        const rawHistory = historyLimit > 0 ? messages.slice(-historyLimit) : messages;
        // Filter out system-status messages (reconnection UI) — never sent to AI providers
        const effectiveHistory = rawHistory.filter((m) => m.role !== 'system-status');
        const conversationMessages: ChatMessage[] = [
          systemMessage,
          ...effectiveHistory,
          userMessage,
        ];

        // -------------------------------------------------------------------
        // Tool call execution — called when all tool calls for a turn arrive
        // -------------------------------------------------------------------
        const handleToolCalls = async () => {
          if (pendingToolCalls.length === 0) return;

          // Snapshot the tool calls and clear the pending list for the next turn
          const calls = [...pendingToolCalls];
          pendingToolCalls.length = 0;

          // Record the assistant message with tool_calls in the conversation
          conversationMessages.push({
            role: 'assistant',
            content: streamedContent,
            toolCalls: calls.map((c) => ({
              id: c.id,
              name: c.name,
              arguments: c.arguments,
            })),
          });

          const toolResultMessages: ChatMessage[] = [];

          for (const call of calls) {
            toolCallCount++;

            // Enforce limit
            if (toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
              addActivity(assistantMessageId, {
                kind: 'tool_call',
                label: call.name,
                detail: 'Tool call limit reached',
                status: 'done',
                timestamp: Date.now(),
              });
              pushSegment(assistantMessageId, {
                type: 'tool_call',
                kind: call.name,
                label: formatToolLabel(call.name, call.arguments),
                detail: 'Tool call limit reached',
                status: 'error',
                timestamp: Date.now(),
              } as ToolCallSegment);
              toolResultMessages.push({
                role: 'tool' as const,
                content: 'Tool call limit reached (20 per turn). Please respond with text.',
                toolCallId: call.id,
              });
              continue;
            }

            // Check permission
            const tier = usePermissionStore.getState().isToolAllowed(call.name);

            if (tier === 'none') {
              // Show permission card and wait for user decision
              log.info('ai', `Requesting permission for tool: ${call.name}`);
              const decision = await new Promise<ToolCallDecision>((resolve) => {
                useToolPermissionStore.getState().setPending({
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  resolve,
                });
              });
              useToolPermissionStore.getState().setPending(null);

              if (decision === 'deny') {
                log.info('ai', `Tool call denied by user: ${call.name}`);
                addActivity(assistantMessageId, {
                  kind: 'tool_call',
                  label: call.name,
                  detail: 'Permission denied',
                  status: 'done',
                  timestamp: Date.now(),
                });
                pushSegment(assistantMessageId, {
                  type: 'tool_call',
                  kind: call.name,
                  label: formatToolLabel(call.name, call.arguments),
                  detail: 'Permission denied',
                  status: 'error',
                  timestamp: Date.now(),
                } as ToolCallSegment);
                toolResultMessages.push({
                  role: 'tool' as const,
                  content: `Permission denied for tool: ${call.name}`,
                  toolCallId: call.id,
                });
                continue;
              }

              // Update permissions based on decision
              if (decision === 'session') {
                usePermissionStore.getState().allowToolSession(call.name);
              } else if (decision === 'always') {
                usePermissionStore.getState().allowToolAlways(call.name);
              }
              // 'allow' = once, no persistence
            }

            // Execute the tool
            addActivity(assistantMessageId, {
              kind: 'tool_call',
              label: call.name,
              detail: 'running',
              status: 'running',
              timestamp: Date.now(),
            });

            // Push tool call segment (running)
            const toolLabel = formatToolLabel(call.name, call.arguments);
            const toolDetail = Object.keys(call.arguments).length > 0
              ? JSON.stringify(call.arguments, null, 2) : undefined;
            const convForIdx = useChatStore.getState().conversations
              .find(c => c.id === useChatStore.getState().activeConversationId);
            const msgForIdx = convForIdx?.messages.find(m => m.timestamp === assistantMessageId);
            const toolSegIdx = msgForIdx?.segments?.length ?? 0;
            pushSegment(assistantMessageId, {
              type: 'tool_call',
              kind: call.name,
              label: toolLabel,
              detail: toolDetail,
              status: 'running',
              timestamp: Date.now(),
            } as ToolCallSegment);

            const result = await executeToolCall(call.id, call.name, call.arguments);

            // Update activity to done
            addActivity(assistantMessageId, {
              kind: 'tool_call',
              label: call.name,
              detail: result.is_error ? result.content : 'completed',
              status: 'done',
              timestamp: Date.now(),
            });

            // Update tool call segment to done and push tool result segment
            updateSegment(assistantMessageId, toolSegIdx, { status: result.is_error ? 'error' : 'done' });
            pushSegment(assistantMessageId, {
              type: 'tool_result',
              toolCallId: call.id,
              result: result.is_error ? undefined : result.content,
              error: result.is_error ? result.content : undefined,
              collapsed: true,
              timestamp: Date.now(),
            });

            toolResultMessages.push({
              role: 'tool' as const,
              content: result.content,
              toolCallId: call.id,
            });
          }

          // Add tool results to conversation
          conversationMessages.push(...toolResultMessages);

          // Reset streamed content for the continuation turn
          streamedContent = '';
          contentDirty = false;
          // Reset thinking tracking for the continuation turn
          thinkingSegmentIndex = -1;
          thinkingSegmentContent = '';

          // Re-invoke ai_chat_stream with full history including tool results
          await invoke('ai_chat_stream', {
            messages: mapMessagesForRust(conversationMessages),
            provider: resolved.provider,
            connectionId: resolved.connectionId,
            ollamaUrl: resolved.ollamaUrl,
            webSearchEnabled: false, // Don't re-search on continuation
            tools: tools ?? null,
            model: resolved.config?.model ?? null,
            temperature: resolved.config?.temperature ?? null,
            maxTokens: resolved.config?.maxTokens ?? null,
            baseUrl: resolved.config?.baseUrl ?? null,
          });
        };

        // -------------------------------------------------------------------
        // Event listeners
        // -------------------------------------------------------------------

        // Track whether this streaming session has been cleaned up (cancel or done)
        let cancelled = false;

        const [
          unlistenChunk,
          unlistenThinking,
          unlistenImage,
          unlistenTool,
          unlistenCitation,
          unlistenToolCall,
          unlistenToolCallsDone,
          unlistenDone,
        ] = await Promise.all([
          listen<string>('ai-stream-chunk', (event) => {
            if (cancelled) return;
            streamedContent += event.payload;
            contentDirty = true;
            appendTextSegment(assistantMessageId, event.payload);
          }),
          listen<string>('ai-stream-thinking-chunk', (event) => {
            if (cancelled) return;
            if (!streamedThinking) {
              log.debug('ai', 'Thinking content detected');
            }
            streamedThinking += event.payload;
            thinkingDirty = true;
            // Segment: accumulate thinking content
            thinkingSegmentContent += event.payload;
            if (thinkingSegmentIndex === -1) {
              const conv = useChatStore.getState().conversations
                .find(c => c.id === useChatStore.getState().activeConversationId);
              const msg = conv?.messages.find(m => m.timestamp === assistantMessageId);
              thinkingSegmentIndex = msg?.segments?.length ?? 0;
              pushSegment(assistantMessageId, {
                type: 'thinking',
                content: thinkingSegmentContent,
                collapsed: false,
                timestamp: Date.now(),
              });
            } else {
              updateSegment(assistantMessageId, thinkingSegmentIndex, {
                content: thinkingSegmentContent,
              });
            }
          }),
          listen<{ data: string; mimeType: string }>('ai-stream-image', (event) => {
            if (cancelled) return;
            pushSegment(assistantMessageId, {
              type: 'image',
              data: event.payload.data,
              mimeType: event.payload.mimeType,
              timestamp: Date.now(),
            });
          }),
          listen<{ tool: string; status: string }>('ai-tool-use', (event) => {
            if (cancelled) return;
            if (event.payload.status === 'start') {
              setActiveTool(event.payload.tool);
            }
          }),
          listen<{ url: string; title: string; cited_text: string }>('ai-citation', (event) => {
            if (cancelled) return;
            const { url, title, cited_text } = event.payload;
            if (!collectedCitations.some((c) => c.url === url)) {
              collectedCitations.push({ url, title, citedText: cited_text });
            }
          }),
          listen<PendingToolCall>('ai-tool-call', (event) => {
            if (cancelled) return;
            log.debug('ai', `Tool call received: ${event.payload.name}`);
            pendingToolCalls.push(event.payload);
          }),
          listen('ai-tool-calls-done', () => {
            if (cancelled) return;
            // All tool calls for this turn have been emitted — execute and continue
            log.debug('ai', `Processing ${pendingToolCalls.length} tool calls`);
            handleToolCalls().catch((err) => {
              log.error('ai', 'Tool call execution failed', err);
              // On error, finalize the message with whatever content we have
              if (streamedContent) {
                updateMessage(assistantMessageId, streamedContent);
              }
              setMessageError(
                assistantMessageId,
                friendlyAIError(err, effectiveConnection?.label || resolved?.provider, effectiveConnection?.id)
              );
              setLoading(false);
              setActiveTool(null);
            });
          }),
          listen('ai-stream-done', () => {
            if (cancelled) return;
            cleanup();
          }),
        ]);

        const cleanup = () => {
          if (cancelled) return;
          cancelled = true;
          clearInterval(flushInterval);
          unlistenChunk();
          unlistenThinking();
          unlistenImage();
          unlistenTool();
          unlistenCitation();
          unlistenToolCall();
          unlistenToolCallsDone();
          unlistenDone();
          if (streamedThinking) {
            updateMessageThinking(assistantMessageId, streamedThinking);
          }
          if (collectedCitations.length > 0 || streamedContent) {
            updateMessage(assistantMessageId, streamedContent, collectedCitations.length > 0 ? collectedCitations : undefined);
          }
          finalizeSegments(assistantMessageId);
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        cleanupRef.current = cleanup;

        // Build tools array if tool calling is enabled
        let tools: ToolDefinition[] | undefined;
        const toolCallingEnabled = useSettingsStore.getState().toolCallingEnabled;
        if (toolCallingEnabled) {
          const activeAgent = useSkillStore.getState().getActiveAgent();
          const allowedTools = activeAgent?.allowed_tools ?? undefined;
          tools = useSkillStore.getState().getToolDefinitions(allowedTools);
          if (tools.length === 0) tools = undefined;
        }

        await invoke('ai_chat_stream', {
          messages: mapMessagesForRust(conversationMessages),
          provider: resolved.provider,
          connectionId: resolved.connectionId,
          ollamaUrl: resolved.ollamaUrl,
          webSearchEnabled: false, // Web search is now a client-side tool
          tools: tools ?? null,
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
    [resolved, buildComposedSystemMessage, localSystemMessage, webSearchEnabled, addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, addActivity, appendTextSegment, pushSegment, updateSegment, finalizeSegments, effectiveConnection]
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
