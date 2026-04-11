import { useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore, type ToolCallDecision } from '@/stores/tool-permission-store';
import { executeToolCall } from '@/lib/tool-executor';
import { formatToolLabel } from '@/lib/ai/acp-utils';
import { friendlyAIError } from '@/lib/ai/errors';
import { log } from '@/lib/logger';
import { toast } from 'sonner';
import type { ChatMessage, ImageAttachment, ToolCallSegment, ToolDefinition } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CopilotChatParams {
  effectiveConnection: Connection | null;
  buildComposedSystemMessage: (attachedFilePaths?: string[]) => string;
  composedSystemMessage: string;
}

interface SendChatOpts {
  displayContent?: string;
  skillName?: string;
  attachedFilePaths?: string[];
  sandboxPaths?: string[];
  parentId?: string | null;
  attachments?: ImageAttachment[];
}

/** Maximum tool calls allowed per user turn to prevent runaway loops. */
const MAX_TOOL_CALLS_PER_TURN = 20;

// ---------------------------------------------------------------------------
// Hook — handles Copilot LSP conversation-based chat
// ---------------------------------------------------------------------------

export function useCopilotChat({
  effectiveConnection,
  buildComposedSystemMessage: _buildComposedSystemMessage,
  composedSystemMessage: _composedSystemMessage,
}: CopilotChatParams) {
  const {
    addMessage,
    updateMessage,
    setMessageError,
    setLoading,
    setError,
    setActiveTool,
    addActivity,
    appendTextSegment,
    pushSegment,
    updateSegment,
    finalizeSegments,
  } = useChatStore();

  const conversationIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // -------------------------------------------------------------------------
  // generateText — one-shot text generation via a temporary conversation
  // -------------------------------------------------------------------------

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      let tempConversationId: string | null = null;
      let tempCleanup: (() => void) | null = null;

      try {
        const model = useRoutingStore.getState().routing.interactive?.model;

        return await new Promise<string>((resolve, reject) => {
          let accumulated = '';
          let settled = false;

          const setup = async () => {
            // Listeners must be registered BEFORE calling create/turn because the
            // JSON-RPC response blocks until after all $/progress notifications
            // are delivered. We cannot filter by conversationId here since it's
            // only known after the response. This is safe for generateText because
            // it's a one-shot call — no other conversation runs concurrently.
            const [unlistenChunk, unlistenDone] = await Promise.all([
              listen<{ text: string }>('copilot-chat-chunk', (event) => {
                accumulated += event.payload.text;
              }),
              listen<{ error?: { message?: string } }>('copilot-chat-done', (event) => {
                if (!settled) {
                  settled = true;
                  cleanup();
                  if (event.payload.error?.message) {
                    reject(new Error(event.payload.error.message));
                  } else {
                    resolve(accumulated);
                  }
                }
              }),
            ]);

            const cleanup = () => {
              unlistenChunk();
              unlistenDone();
            };
            tempCleanup = cleanup;

            const result = await tauriApi.copilotLspConversationCreate(prompt, model);
            tempConversationId = result.conversationId;
          };

          setup().catch((err) => {
            if (!settled) {
              settled = true;
              tempCleanup?.();
              reject(err);
            }
          });
        });
      } finally {
        if (tempConversationId) {
          tauriApi.copilotLspConversationDestroy(tempConversationId).catch(() => {});
        }
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // sendChatMessage — streaming chat with tool calling
  // -------------------------------------------------------------------------

  const sendChatMessage = useCallback(
    async (content: string, _messages: ChatMessage[], opts?: SendChatOpts) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: userTimestamp,
        displayContent: opts?.displayContent,
        skillName: opts?.skillName,
        attachments: opts?.attachments,
        ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}),
      };
      addMessage(userMessage);

      const assistantMessageId = userTimestamp + 1;
      addMessage({
        role: 'assistant',
        content: '',
        timestamp: assistantMessageId,
        ...(effectiveConnection
          ? {
              connectionId: effectiveConnection.id,
              connectionLabel: effectiveConnection.label,
              connectionProvider: effectiveConnection.provider,
            }
          : {}),
      });

      let flushInterval: ReturnType<typeof setInterval> | undefined;

      try {
        let streamedContent = '';
        let contentDirty = false;

        flushInterval = setInterval(() => {
          if (contentDirty) {
            updateMessage(assistantMessageId, streamedContent);
            contentDirty = false;
          }
        }, 50);

        // Track whether this streaming session has been cleaned up
        let cancelled = false;
        let toolCallCount = 0;

        // Segment tracking for thinking blocks
        let thinkingSegmentIndex = -1;
        let thinkingSegmentContent = '';

        // Track the conversationId for this turn. For create calls, we learn
        // the ID from the first $/progress event (which arrives before the
        // invoke resolves). For turn calls, we already have it.
        const turnConvId = conversationIdRef.current;
        let eventConvId: string | null = turnConvId;

        /** Filter: accept events for this conversation. On the first create,
         *  we latch onto the first conversationId we see. */
        const isOurEvent = (payload: { conversationId?: string }): boolean => {
          if (!payload.conversationId) return true; // no ID = accept (safety)
          if (eventConvId === null) {
            // First create — latch onto this conversation
            eventConvId = payload.conversationId;
            return true;
          }
          return payload.conversationId === eventConvId;
        };

        // Build tools array if tool calling is enabled
        let tools: ToolDefinition[] | undefined;
        const toolCallingEnabled = useSettingsStore.getState().toolCallingEnabled;
        if (toolCallingEnabled) {
          tools = useSkillStore.getState().getToolDefinitions();
          if (tools.length === 0) tools = undefined;
        }

        const model = useRoutingStore.getState().routing.interactive?.model;

        // Map tools to the format expected by the LSP
        const lspTools = tools?.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.input_schema as unknown,
        }));

        // -------------------------------------------------------------------
        // Event listeners
        // -------------------------------------------------------------------

        const [
          unlistenChunk,
          unlistenThinking,
          unlistenDone,
          unlistenToolCall,
          unlistenToolConfirmation,
          unlistenContextRequest,
        ] = await Promise.all([
          listen<{ text: string; conversationId?: string }>('copilot-chat-chunk', (event) => {
            if (cancelled || !isOurEvent(event.payload)) return;
            streamedContent += event.payload.text;
            contentDirty = true;
            appendTextSegment(assistantMessageId, event.payload.text);
          }),
          listen<{ text: string; conversationId?: string }>('copilot-chat-thinking', (event) => {
            if (cancelled || !isOurEvent(event.payload)) return;
            thinkingSegmentContent += event.payload.text;
            if (thinkingSegmentIndex === -1) {
              const conv = useChatStore.getState().conversations.find(
                (c) => c.id === useChatStore.getState().activeConversationId,
              );
              const msg = conv?.messages.find((m) => m.timestamp === assistantMessageId);
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
          listen<{ conversationId?: string; error?: { message?: string; reason?: string; modelName?: string; code?: number } }>('copilot-chat-done', (event) => {
            if (cancelled || !isOurEvent(event.payload)) return;
            if (event.payload.error) {
              const err = event.payload.error;
              const errorMsg = err.message || 'Unknown error from Copilot';
              log.error('ai', 'Copilot conversation error', err);
              if (err.reason === 'model_not_supported') {
                toast.error(`Model "${err.modelName || 'unknown'}" is not available on your Copilot plan. Try a different model in Settings > Advanced Routing.`);
              } else {
                toast.error(errorMsg);
              }
              setMessageError(assistantMessageId, errorMsg);
            }
            cleanup();
          }),
          listen<{ requestId: string; id: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>(
            'copilot-tool-call',
            (event) => {
              if (cancelled || !isOurEvent(event.payload)) return;
              const { requestId, id, name, arguments: args } = event.payload;
              log.debug('ai', `Copilot tool call received: ${name}`);

              toolCallCount++;
              if (toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
                tauriApi.copilotLspToolResult(requestId, {
                  content: 'Tool call limit reached (20 per turn). Please respond with text.',
                  is_error: true,
                }).catch((err) => log.error('ai', 'Failed to send tool result', err));
                pushSegment(assistantMessageId, {
                  type: 'tool_call',
                  kind: name,
                  label: formatToolLabel(name, args),
                  detail: 'Tool call limit reached',
                  status: 'error',
                  timestamp: Date.now(),
                } as ToolCallSegment);
                return;
              }

              // Handle tool call asynchronously
              handleToolCall(requestId, id, name, args, assistantMessageId).catch((err) => {
                log.error('ai', 'Tool call execution failed', err);
              });
            },
          ),
          listen<{ requestId: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>(
            'copilot-tool-confirmation',
            (event) => {
              if (cancelled || !isOurEvent(event.payload)) return;
              const { requestId, name, arguments: args } = event.payload;
              log.debug('ai', `Copilot tool confirmation request: ${name}`);

              // Show permission card and wait for user decision
              const decision$ = new Promise<ToolCallDecision>((resolve) => {
                useToolPermissionStore.getState().setPending({
                  id: requestId,
                  name,
                  arguments: args,
                  resolve,
                });
              });

              decision$.then((decision) => {
                useToolPermissionStore.getState().setPending(null);
                const accepted = decision !== 'deny';

                if (decision === 'session') {
                  usePermissionStore.getState().allowToolSession(name);
                } else if (decision === 'always') {
                  usePermissionStore.getState().allowToolAlways(name);
                }

                tauriApi.copilotLspToolConfirmationResponse(requestId, accepted).catch((err) =>
                  log.error('ai', 'Failed to send tool confirmation response', err),
                );
              });
            },
          ),
          listen<{ requestId: string; conversationId?: string }>('copilot-context-request', (event) => {
            if (cancelled || !isOurEvent(event.payload)) return;
            const { requestId } = event.payload;
            log.debug('ai', 'Copilot context request received');

            // Collect editor state for context
            const editorState = useEditorStore.getState();
            const activeTab = editorState.activeTabId
              ? editorState.tabs.find((t) => t.id === editorState.activeTabId)
              : null;

            const context = activeTab
              ? {
                  uri: `file://${activeTab.filePath}`,
                  content: activeTab.content,
                  languageId: getLanguageId(activeTab.filePath),
                }
              : null;

            tauriApi.copilotLspContextResponse(requestId, context).catch((err) =>
              log.error('ai', 'Failed to send context response', err),
            );
          }),
        ]);

        const cleanup = () => {
          if (cancelled) return;
          cancelled = true;
          clearInterval(flushInterval);
          unlistenChunk();
          unlistenThinking();
          unlistenDone();
          unlistenToolCall();
          unlistenToolConfirmation();
          unlistenContextRequest();
          if (streamedContent) {
            updateMessage(assistantMessageId, streamedContent);
          }
          finalizeSegments(assistantMessageId);
          setLoading(false);
          setActiveTool(null);
          cleanupRef.current = null;
        };

        cleanupRef.current = cleanup;

        // Start the conversation or send a follow-up turn.
        // Note: create/turn block until after all $/progress notifications
        // are delivered, so events arrive DURING this await. The isOurEvent
        // filter latches onto the conversationId from the first event.
        if (!conversationIdRef.current) {
          const result = await tauriApi.copilotLspConversationCreate(content, model, lspTools);
          conversationIdRef.current = result.conversationId;
        } else {
          await tauriApi.copilotLspConversationTurn(conversationIdRef.current, content, model);
        }
      } catch (error) {
        clearInterval(flushInterval);
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        log.error('ai', 'Copilot chat stream error', error);

        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('method not found') || errorMsg.includes('Method not found') || errorMsg.includes('-32601')) {
          toast.error('Chat not supported by this Copilot LSP version. Update copilot-language-server: npm update -g @github/copilot-language-server');
        }

        setMessageError(
          assistantMessageId,
          friendlyAIError(error, effectiveConnection?.label || 'Copilot', effectiveConnection?.id),
        );
        setLoading(false);
        setActiveTool(null);
      }
    },
    [
      effectiveConnection,
      addMessage,
      updateMessage,
      setMessageError,
      setLoading,
      setError,
      setActiveTool,
      addActivity,
      appendTextSegment,
      pushSegment,
      updateSegment,
      finalizeSegments,
    ],
  );

  // -------------------------------------------------------------------------
  // handleToolCall — execute a single tool call and send result back to LSP
  // -------------------------------------------------------------------------

  async function handleToolCall(
    requestId: string,
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    assistantMessageId: number,
  ) {
    // Check permission
    const tier = usePermissionStore.getState().isToolAllowed(name);

    if (tier === 'none') {
      const decision = await new Promise<ToolCallDecision>((resolve) => {
        useToolPermissionStore.getState().setPending({
          id: toolCallId,
          name,
          arguments: args,
          resolve,
        });
      });
      useToolPermissionStore.getState().setPending(null);

      if (decision === 'deny') {
        log.info('ai', `Tool call denied by user: ${name}`);
        pushSegment(assistantMessageId, {
          type: 'tool_call',
          kind: name,
          label: formatToolLabel(name, args),
          detail: 'Permission denied',
          status: 'error',
          timestamp: Date.now(),
        } as ToolCallSegment);
        await tauriApi.copilotLspToolResult(requestId, {
          content: `Permission denied for tool: ${name}`,
          is_error: true,
        });
        return;
      }

      if (decision === 'session') {
        usePermissionStore.getState().allowToolSession(name);
      } else if (decision === 'always') {
        usePermissionStore.getState().allowToolAlways(name);
      }
    }

    // Push running tool call segment
    const toolLabel = formatToolLabel(name, args);
    const toolDetail =
      Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;

    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === useChatStore.getState().activeConversationId);
    const msg = conv?.messages.find((m) => m.timestamp === assistantMessageId);
    const toolSegIdx = msg?.segments?.length ?? 0;

    addActivity(assistantMessageId, {
      kind: 'tool_call',
      label: name,
      detail: 'running',
      status: 'running',
      timestamp: Date.now(),
    });

    pushSegment(assistantMessageId, {
      type: 'tool_call',
      kind: name,
      label: toolLabel,
      detail: toolDetail,
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);

    // Execute the tool
    const result = await executeToolCall(toolCallId, name, args);

    // Update activity to done
    addActivity(assistantMessageId, {
      kind: 'tool_call',
      label: name,
      detail: result.is_error ? result.content : 'completed',
      status: 'done',
      timestamp: Date.now(),
    });

    // Update tool call segment to done and push tool result segment
    updateSegment(assistantMessageId, toolSegIdx, {
      status: result.is_error ? 'error' : 'done',
    });
    pushSegment(assistantMessageId, {
      type: 'tool_result',
      toolCallId,
      result: result.is_error ? undefined : result.content,
      error: result.is_error ? result.content : undefined,
      collapsed: true,
      timestamp: Date.now(),
    });

    // Send result back to the LSP
    await tauriApi.copilotLspToolResult(requestId, {
      content: result.content,
      is_error: result.is_error,
    });
  }

  // -------------------------------------------------------------------------
  // cancelChat — destroy conversation and clean up listeners
  // -------------------------------------------------------------------------

  const cancelChat = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    if (conversationIdRef.current) {
      tauriApi.copilotLspConversationDestroy(conversationIdRef.current).catch(() => {});
      conversationIdRef.current = null;
    }
    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return {
    copilotGenerateText: generateText,
    copilotSendChatMessage: sendChatMessage,
    cancelCopilotChat: cancelChat,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a language ID from a file path extension for LSP context. */
function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    md: 'markdown',
    rs: 'rust',
    py: 'python',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'shellscript',
    bash: 'shellscript',
    sql: 'sql',
    xml: 'xml',
    swift: 'swift',
    kt: 'kotlin',
    rb: 'ruby',
    php: 'php',
  };
  return map[ext] ?? 'plaintext';
}
