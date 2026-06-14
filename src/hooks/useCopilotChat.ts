import { useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore, type ToolCallDecision } from '@/stores/tool-permission-store';
import { executeToolCall } from '@/lib/tool-executor';
import { formatToolLabel } from '@/lib/ai/acp-utils';
import { friendlyAIError } from '@/lib/ai/errors';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';
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
    appendTextSegment,
    pushSegment,
    updateSegment,
    finalizeSegments,
  } = useChatStore();

  const conversationIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Determine if the effective connection is a Copilot LSP
  const isCopilotLsp = effectiveConnection?.credentials != null
    && 'agentBinary' in effectiveConnection.credentials
    && effectiveConnection.credentials.agentBinary === 'copilot-language-server';

  const projects = useWorkspaceStore((s) => s.projects);
  // Working directory for the Copilot LSP must reflect the command bar's
  // project selection (Track 1 isolation — task #15). The first workspace
  // folder is only a fallback for when no chat is active yet, so the LSP
  // can still come up before the user opens a conversation.
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const workingDir = selectedProjectPaths[0] ?? projects[0]?.path ?? null;

  // Ensure the Copilot LSP process is running when this connection is active.
  // copilot_lsp_start is safe to call when already running — it reuses the
  // existing process and emits `workspace/didChangeWorkspaceFolders` when
  // the directory differs from the last one seen by the backend.
  useEffect(() => {
    if (!isCopilotLsp || !workingDir) return;
    tauriApi.copilotLspStart(workingDir).catch((err) => {
      log.error('copilot', 'Failed to ensure LSP is running for chat', err);
    });
  }, [isCopilotLsp, workingDir]);

  // Clean up the conversation and reset the ref on unmount. This prevents
  // conversationIdRef from being left as "pending" if the component unmounts
  // during conversation creation, and destroys any live conversation to free
  // server-side resources.
  useEffect(() => {
    return () => {
      if (conversationIdRef.current && conversationIdRef.current !== 'pending') {
        tauriApi.copilotLspConversationDestroy(conversationIdRef.current).catch(() => {});
      }
      conversationIdRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------------------
  // generateText — one-shot text generation via a temporary conversation
  // -------------------------------------------------------------------------

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      let tempConversationId: string | null = null;
      let tempCleanup: (() => void) | null = null;

      try {
        const model = useRoutingStore.getState().routing.interactive?.model ?? effectiveConnection?.config?.model;

        return await new Promise<string>((resolve, reject) => {
          let accumulated = '';
          let settled = false;
          let eventConvId: string | null = null;

          /** Filter: latch onto the first conversationId seen in events, then
           *  only accept events for that conversation. This prevents cross-talk
           *  if generateText is called concurrently with sendChatMessage. */
          const isOurEvent = (payload: { conversationId?: string }): boolean => {
            if (!payload.conversationId) return true; // no ID = accept (safety)
            if (eventConvId === null) {
              eventConvId = payload.conversationId;
              return true;
            }
            return payload.conversationId === eventConvId;
          };

          const setup = async () => {
            // Listeners must be registered BEFORE calling create because the
            // JSON-RPC response blocks until after all $/progress notifications
            // are delivered. The isOurEvent filter latches onto the first
            // conversationId from the first event, preventing cross-talk.
            const [unlistenChunk, unlistenDone] = await Promise.all([
              listen<{ text: string; conversationId?: string }>('copilot-chat-chunk', (event) => {
                if (!isOurEvent(event.payload)) return;
                accumulated += event.payload.text;
              }),
              listen<{ error?: { message?: string }; conversationId?: string }>('copilot-chat-done', (event) => {
                if (!isOurEvent(event.payload)) return;
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
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes('method not found') || errMsg.includes('Method not found') || errMsg.includes('-32601')) {
                toast.error('Chat not supported by this Copilot LSP version. Update copilot-language-server: npm update -g @github/copilot-language-server');
              }
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
  // handleToolCall — execute a single tool call and send result back to LSP
  // -------------------------------------------------------------------------
  // Uses useChatStore.getState() directly to avoid stale closure captures —
  // this async function runs outside React render and may be called
  // concurrently by multiple tool call events.

  const handleToolCall = useCallback(
    async (
      requestId: string,
      toolCallId: string,
      name: string,
      args: Record<string, unknown>,
      assistantMessageId: number,
    ) => {
      // Check permission
      const tier = usePermissionStore.getState().isToolAllowed(name, null, null);

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
          useChatStore.getState().pushSegment(assistantMessageId, {
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
          usePermissionStore.getState().allowToolAlways(name, null, null);
        }
      }

      // Push running tool call segment
      const toolLabel = formatToolLabel(name, args);
      const toolDetail =
        Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;

      useChatStore.getState().addActivity(assistantMessageId, {
        kind: 'tool_call',
        label: name,
        detail: 'running',
        status: 'running',
        timestamp: Date.now(),
      });

      useChatStore.getState().pushSegment(assistantMessageId, {
        type: 'tool_call',
        kind: name,
        label: toolLabel,
        detail: toolDetail,
        status: 'running',
        timestamp: Date.now(),
      } as ToolCallSegment);

      // Read the segment index AFTER pushing — this is safe even under
      // concurrent tool calls because each push appends and we read the
      // latest state immediately after our own push.
      const updatedConv = useChatStore.getState().conversations.find(
        (c) => c.id === useChatStore.getState().activeConversationId,
      );
      const updatedMsg = updatedConv?.messages.find((m) => m.timestamp === assistantMessageId);
      const toolSegIdx = (updatedMsg?.segments?.length ?? 1) - 1;

      // Execute the tool
      const result = await executeToolCall(toolCallId, name, args);

      // Update activity to done
      useChatStore.getState().addActivity(assistantMessageId, {
        kind: 'tool_call',
        label: name,
        detail: result.is_error ? result.content : 'completed',
        status: 'done',
        timestamp: Date.now(),
      });

      // Update tool call segment to done and push tool result segment
      useChatStore.getState().updateSegment(assistantMessageId, toolSegIdx, {
        status: result.is_error ? 'error' : 'done',
      });
      useChatStore.getState().pushSegment(assistantMessageId, {
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

        const model = useRoutingStore.getState().routing.interactive?.model ?? effectiveConnection?.config?.model;

        // Map tools to the format expected by the LSP.
        // The LSP requires inputSchema.required to be an array (even if empty).
        const lspTools = tools?.map((t) => {
          const schema = t.input_schema as Record<string, unknown> | undefined;
          const sanitized: Record<string, unknown> = schema ? { ...schema } : { type: 'object', properties: {} };
          if (!Array.isArray(sanitized.required)) {
            sanitized.required = [];
          }
          return {
            name: t.name,
            description: t.description,
            inputSchema: sanitized,
          };
        });

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
              } else if (errorMsg.includes("'max_tokens' is not supported")) {
                toast.error('The auto-selected Copilot model has a compatibility issue. Try selecting a specific model in Settings > Advanced Routing.');
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
                  usePermissionStore.getState().allowToolAlways(name, null, null);
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
              ? editorState.openDocuments.find((t) => t.id === editorState.activeTabId)
              : null;

            // Task #16 — context-request scope gate. The LSP asks for the
            // "currently editing" document; if the active tab is outside
            // `selectedProjectPaths` (+ notes root), we must return an empty
            // context. Returning null would signal "no active tab" — same
            // observable behaviour, no content leaks out.
            const contextScope = buildContextScope();
            const inScope = activeTab ? isUriInScope(activeTab.filePath, contextScope) : false;

            const context = activeTab && inScope
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

        // Collect active document context for the LSP
        const editorState = useEditorStore.getState();
        const activeTab = editorState.activeTabId
          ? editorState.openDocuments.find((t) => t.id === editorState.activeTabId)
          : null;

        // Task #16 — scope gate for the "active document" context that
        // piggybacks on conversation/create and conversation/turn. If the
        // active tab lives outside the selected projects (+ notes root),
        // we must NOT push it to the LSP, even implicitly through docUri/
        // docLang on the conversation call.
        const sendScope = buildContextScope();
        const activeInScope = activeTab ? isUriInScope(activeTab.filePath, sendScope) : false;
        const docUri = activeTab?.filePath && activeInScope ? `file://${activeTab.filePath}` : undefined;
        const docLang = activeTab?.filePath && activeInScope ? getLanguageId(activeTab.filePath) : undefined;

        // Ensure the LSP knows about the active document (textDocument/didOpen)
        // so conversation/context and doc references can resolve the file.
        // Out-of-scope tabs are skipped — we do not want that content in the
        // LSP's document store.
        if (activeTab?.filePath && activeTab?.content != null && activeInScope) {
          tauriApi.copilotLspDidOpen(activeTab.filePath, activeTab.content, 1)
            .catch(() => {}); // fire-and-forget, may already be open
        }

        // Start the conversation or send a follow-up turn.
        // Note: create/turn block until after all $/progress notifications
        // are delivered, so events arrive DURING this await. The isOurEvent
        // filter latches onto the conversationId from the first event.
        if (!conversationIdRef.current) {
          // Set sentinel to prevent a concurrent sendChatMessage from creating
          // a second conversation before the first resolves.
          conversationIdRef.current = 'pending';
          try {
            const result = await tauriApi.copilotLspConversationCreate(content, model, lspTools, docUri, docLang);
            conversationIdRef.current = result.conversationId;
          } catch (e) {
            conversationIdRef.current = null;
            throw e;
          }
        } else if (conversationIdRef.current === 'pending') {
          throw new Error('A conversation is already being created. Please wait.');
        } else {
          await tauriApi.copilotLspConversationTurn(conversationIdRef.current, content, model, docUri, docLang);
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
      appendTextSegment,
      pushSegment,
      updateSegment,
      finalizeSegments,
      handleToolCall,
    ],
  );

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

/**
 * Build the URI scope used to gate context-request and active-document push.
 * Reads directly from stores (not from closures) because it's called inside
 * async event handlers where the captured hook-state may be stale.
 *
 * Scope = selected project paths (from the command bar) ∪ `~/Notesage`
 * resolved to an absolute path. Empty `selectedProjectPaths` does NOT
 * fall back to "allow everything" — matches task #8's semantics.
 */
function buildContextScope(): UriScope {
  const chatState = useChatStore.getState();
  const projectRoots = selectProjectPaths(chatState);
  const settings = useSettingsStore.getState();
  const raw = settings.notesRootPath;
  let notesRootPath: string | null = null;
  if (raw) {
    if (raw.startsWith('~')) {
      notesRootPath = settings.homeDir ? raw.replace('~', settings.homeDir) : null;
    } else {
      notesRootPath = raw;
    }
  }
  return { projectRoots, notesRootPath };
}

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
