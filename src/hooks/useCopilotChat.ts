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
import {
  useToolPermissionStore,
  selectPendingForConversation,
  type ToolCallDecision,
} from '@/stores/tool-permission-store';
import { executeToolCall } from '@/lib/tool-executor';
import { isMcpToolName } from '@/lib/mcp/tool-naming';
import { resolveMcpTool, mcpPermissionKey } from '@/lib/mcp/chat-tools';
import { formatToolLabel } from '@/lib/ai/acp-utils';
import {
  mapCopilotProgressStatus,
  stringifyProgressValue,
  type CopilotStepPayload,
  type CopilotToolUpdatePayload,
} from '@/lib/ai/copilot-progress';
import { friendlyAIError } from '@/lib/ai/errors';
import { runStarted, runIdle, runError } from '@/lib/ai/session-run';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';
import {
  openCopilotStream,
  closeCopilotStream,
  ownsCopilotProgress,
  ownsCopilotRequest,
  type CopilotStream,
} from '@/lib/ai/copilot-correlation';
import { log } from '@/lib/logger';
import { toast } from 'sonner';
import type { ChatMessage, ImageAttachment, ToolCallSegment, ToolResultSegment, ToolDefinition } from '@/lib/ai/types';
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
  /**
   * Append to THIS conversation rather than the active one (#468). Set when the
   * concurrency cap deferred the send, so it lands where it was typed even if
   * the user has navigated away in the meantime.
   */
  conversationId?: string;
}

/** What every `$/progress`-derived event carries (see copilot-correlation.ts). */
interface CopilotProgressKey {
  token?: string;
  conversationId?: string;
}

/** Maximum tool calls allowed per user turn to prevent runaway loops. */
const MAX_TOOL_CALLS_PER_TURN = 20;

/** Registry key for a send with no resolved Notesage conversation. */
const NO_CONVERSATION_KEY = '__none__';

/** Sentinel in `copilotConversationsRef` while `conversation/create` is in flight. */
const PENDING = 'pending';

// ---------------------------------------------------------------------------
// Hook — handles Copilot LSP conversation-based chat
// ---------------------------------------------------------------------------

export function useCopilotChat({
  effectiveConnection,
  buildComposedSystemMessage: _buildComposedSystemMessage,
  composedSystemMessage: _composedSystemMessage,
}: CopilotChatParams) {
  // Actions are read WITHOUT subscribing. Store actions have stable identity,
  // so `getState()` yields the same functions a subscription would — but a
  // bare `useChatStore()` subscribes the calling component to EVERY chat-store
  // write, and the store is written once per streamed chunk. That re-rendered
  // every `useAIOperations` caller (Editor, the command bar, both bubble
  // menus) once per token (audit 2026-11-22 §3). State that is genuinely
  // rendered or used as a dependency stays a selector below.
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
  } = useChatStore.getState();

  // Both registries are keyed by NOTESAGE conversation id (the same shape as
  // `streamsRef` in `useDirectApiChat`). They used to be one ref each for the
  // whole hook, so after chatting in conversation A, a message typed in B was
  // sent as a turn on A's Copilot conversation — B's answer saw A's history,
  // possibly from another project — and B's send tore down A's still-streaming
  // listeners (audit 2026-11-22 §2).
  /** Notesage conversation → its Copilot LSP conversation id (or `PENDING`). */
  const copilotConversationsRef = useRef<Map<string, string>>(new Map());
  /** Notesage conversation → listener cleanup of its in-flight turn. */
  const cleanupRefs = useRef<Map<string, () => void>>(new Map());
  /** Correlation handles of this hook's in-flight turns (closed on unmount). */
  const streamsRef = useRef<Set<CopilotStream>>(new Set());

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

  // Destroy every live Copilot conversation and reset the registry on unmount.
  // This prevents an entry from being left as "pending" if the component
  // unmounts during conversation creation, and frees server-side resources.
  useEffect(() => {
    const copilotConversations = copilotConversationsRef.current;
    const streams = streamsRef.current;
    return () => {
      // A stream left registered would count as "another Copilot stream" for
      // every later one and keep it from claiming its own tool calls.
      for (const stream of streams) closeCopilotStream(stream);
      streams.clear();
      for (const copilotId of copilotConversations.values()) {
        if (copilotId !== PENDING) {
          tauriApi.copilotLspConversationDestroy(copilotId).catch(() => {});
        }
      }
      copilotConversations.clear();
    };
  }, []);

  // -------------------------------------------------------------------------
  // generateText — one-shot text generation via a temporary conversation
  // -------------------------------------------------------------------------

  const generateText = useCallback(
    async (prompt: string): Promise<string> => {
      let tempConversationId: string | null = null;
      let tempCleanup: (() => void) | null = null;
      // Correlation: this stream's events carry its token. A chat turn or a
      // background task streaming at the same time has a different one, so
      // this never resolves with their text (see copilot-correlation.ts).
      const stream = openCopilotStream();

      try {
        const model = useRoutingStore.getState().routing.interactive?.model ?? effectiveConnection?.config?.model;

        return await new Promise<string>((resolve, reject) => {
          let accumulated = '';
          let settled = false;

          const setup = async () => {
            // Listeners must be registered BEFORE calling create because the
            // JSON-RPC response blocks until after all $/progress notifications
            // are delivered.
            const [unlistenBegin, unlistenChunk, unlistenDone] = await Promise.all([
              // Binds the stream to its conversation id as early as possible.
              listen<CopilotProgressKey>('copilot-chat-begin', (event) => {
                ownsCopilotProgress(stream, event.payload);
              }),
              listen<CopilotProgressKey & { text: string }>('copilot-chat-chunk', (event) => {
                if (!ownsCopilotProgress(stream, event.payload)) return;
                accumulated += event.payload.text;
              }),
              listen<CopilotProgressKey & { error?: { message?: string } }>('copilot-chat-done', (event) => {
                if (!ownsCopilotProgress(stream, event.payload)) return;
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
              unlistenBegin();
              unlistenChunk();
              unlistenDone();
              closeCopilotStream(stream);
            };
            tempCleanup = cleanup;

            const result = await tauriApi.copilotLspConversationCreate(
              prompt, model, undefined, undefined, undefined, stream.token,
            );
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
        closeCopilotStream(stream);
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
      // Conversation that owns this turn — so tool-call segments/activities land
      // on the right conversation even if the user switched away mid-stream
      // (matches the direct-API + ACP paths; task #3 gap for Copilot).
      conversationId: string | null,
      // Has this turn been cleaned up (Stop pressed, turn ended, re-send)?
      // Checked after every await: once it has, the assistant message is
      // finalized and the Copilot conversation may be gone.
      isCancelled: () => boolean,
      // MCP routing for this turn: the conversation's project scope (the one
      // the tool list was built with), the connection approvals are scoped
      // to, and a signal aborted when the turn is cleaned up.
      mcp: { scopePaths: string[]; connectionId: string | null; signal: AbortSignal },
    ) => {
      /** Answer the LSP's pending request so it is not left waiting, without
       *  touching the finalized message. Best effort: the conversation may
       *  already have been destroyed. */
      const answerCancelled = () => {
        tauriApi.copilotLspToolResult(requestId, {
          content: `Tool call cancelled: ${name}`,
          is_error: true,
        }).catch(() => {});
      };

      // Check permission. MCP tools are approved per server + tool (never by
      // the built-in auto-allow list, never on the server's own annotations),
      // scoped to this connection and, for a project server, its project;
      // "confirm every tool call" applies to them.
      const isMcpTool = isMcpToolName(name);
      const mcpTarget = isMcpTool ? resolveMcpTool(name, mcp.scopePaths) : null;
      const mcpKey = mcpTarget ? mcpPermissionKey(mcpTarget) : null;
      const tier = mcpTarget && mcpKey
        ? (useSettingsStore.getState().requireAllToolConfirmations
            ? 'none'
            : usePermissionStore.getState().isToolAllowed(mcpKey, mcp.connectionId, mcpTarget.projectRoot))
        : usePermissionStore.getState().isToolAllowed(name, null, null);
      // An `mcp__…` name that resolves to no server has nothing to approve:
      // no card, and execution reports the error to the model.
      const mcpUnresolved = isMcpTool && !mcpTarget;

      if (tier === 'none' && !mcpUnresolved) {
        const decision = await new Promise<ToolCallDecision>((resolve) => {
          useToolPermissionStore.getState().setPending({
            id: toolCallId,
            name,
            arguments: args,
            resolve,
            conversationId,
            ...(mcpTarget
              ? { mcp: { serverName: mcpTarget.serverName, toolName: mcpTarget.toolName } }
              : {}),
          });
        });
        // Stop pressed while the card was up: `cleanup` cleared the pending
        // entry and resolved this promise ('deny') after finalizing the
        // message. Bail before any further write, and before running the tool.
        if (isCancelled()) {
          answerCancelled();
          return;
        }
        useToolPermissionStore.getState().setPending(null, conversationId);

        if (decision === 'deny') {
          log.info('ai', `Tool call denied by user: ${name}`);
          useChatStore.getState().pushSegment(assistantMessageId, {
            type: 'tool_call',
            kind: name,
            label: formatToolLabel(name, args),
            detail: 'Permission denied',
            status: 'error',
            timestamp: Date.now(),
          } as ToolCallSegment, conversationId);
          await tauriApi.copilotLspToolResult(requestId, {
            content: `Permission denied for tool: ${name}`,
            is_error: true,
          });
          return;
        }

        if (mcpTarget && mcpKey) {
          if (decision === 'session') {
            usePermissionStore.getState().allowToolSession(mcpKey);
          } else if (decision === 'always') {
            usePermissionStore.getState().allowToolAlways(mcpKey, mcp.connectionId, mcpTarget.projectRoot);
          }
        } else if (decision === 'session') {
          usePermissionStore.getState().allowToolSession(name);
        } else if (decision === 'always') {
          usePermissionStore.getState().allowToolAlways(name, null, null);
        }
      }

      // Push running tool call segment
      const toolLabel = mcpTarget
        ? `${mcpTarget.serverName}: ${mcpTarget.toolName}`
        : formatToolLabel(name, args);
      const toolDetail =
        Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;

      useChatStore.getState().addActivity(assistantMessageId, {
        kind: 'tool_call',
        label: name,
        detail: 'running',
        status: 'running',
        timestamp: Date.now(),
      }, conversationId);

      useChatStore.getState().pushSegment(assistantMessageId, {
        type: 'tool_call',
        kind: name,
        label: toolLabel,
        detail: toolDetail,
        status: 'running',
        timestamp: Date.now(),
      } as ToolCallSegment, conversationId);

      // Read the segment index AFTER pushing — from THIS turn's conversation
      // (not whatever is foregrounded), safe under concurrent tool calls because
      // each push appends and we read the latest state immediately after.
      const updatedConv = useChatStore.getState().conversations.find(
        (c) => c.id === (conversationId ?? useChatStore.getState().activeConversationId),
      );
      const updatedMsg = updatedConv?.messages.find((m) => m.timestamp === assistantMessageId);
      const toolSegIdx = (updatedMsg?.segments?.length ?? 1) - 1;

      // Execute the tool
      // The scope argument stays undefined (filesystem tools keep their
      // existing gate); the MCP scope travels in the options. Stop aborts the
      // signal so a slow MCP call is not waited for.
      const result = await executeToolCall(toolCallId, name, args, undefined, {
        mcpProjectPaths: mcp.scopePaths,
        signal: mcp.signal,
      });

      // Cancelled while the tool ran: the message is finalized, so write
      // nothing more to it.
      if (isCancelled()) {
        answerCancelled();
        return;
      }

      // Update activity to done
      useChatStore.getState().addActivity(assistantMessageId, {
        kind: 'tool_call',
        label: name,
        detail: result.is_error ? result.content : 'completed',
        status: 'done',
        timestamp: Date.now(),
      }, conversationId);

      // Update tool call segment to done and push tool result segment
      useChatStore.getState().updateSegment(assistantMessageId, toolSegIdx, {
        status: result.is_error ? 'error' : 'done',
      }, conversationId);
      useChatStore.getState().pushSegment(assistantMessageId, {
        type: 'tool_result',
        toolCallId,
        result: result.is_error ? undefined : result.content,
        error: result.is_error ? result.content : undefined,
        collapsed: true,
        timestamp: Date.now(),
      }, conversationId);

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
      // Clean up stale listeners from a previous streaming call in THIS
      // conversation only (a re-send in the same chat). Other conversations'
      // in-flight turns are left running. A fresh chat has no conversation
      // yet, and so nothing stale to tear down.
      cleanupRefs.current.get(
        opts?.conversationId ?? useChatStore.getState().activeConversationId ?? NO_CONVERSATION_KEY,
      )?.();

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
      addMessage(userMessage, opts?.conversationId);

      // The conversation this send owns: named explicitly when the cap deferred
      // it (#468), else the active one — read after `addMessage`, which creates
      // and activates the conversation for a fresh chat.
      const runConvId =
        opts?.conversationId ?? useChatStore.getState().activeConversationId ?? null;
      // Key of this conversation in the Copilot-conversation and cleanup registries.
      const convKey = runConvId ?? NO_CONVERSATION_KEY;

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
      }, runConvId);

      // Record this conversation's run so per-conversation foreground loading
      // works for Copilot LSP chats too (task #4).
      runStarted(runConvId, 'copilot_lsp');

      let flushInterval: ReturnType<typeof setInterval> | undefined;
      // This turn's correlation handle; closed by `cleanup`, or by the catch
      // below when the turn fails before `cleanup` exists.
      let stream: CopilotStream | null = null;

      try {
        let streamedContent = '';
        let contentDirty = false;

        flushInterval = setInterval(() => {
          if (contentDirty) {
            updateMessage(assistantMessageId, streamedContent, undefined, runConvId);
            contentDirty = false;
          }
        }, 50);

        // Track whether this streaming session has been cleaned up
        let cancelled = false;
        let toolCallCount = 0;
        // Aborted by `cleanup`, so a tool loop waiting on an MCP call (which
        // the backend cannot cancel) is released when the turn ends.
        const toolAbort = new AbortController();
        // Project scope of this conversation, fixed for the turn: the MCP
        // tools offered and the tools a call resolves to come from one set.
        const mcpScopePaths = opts?.sandboxPaths ?? selectProjectPaths({
          conversations: useChatStore.getState().conversations,
          // The conversation that owns this send, which is not always the
          // one in the foreground (a cap-deferred or background send).
          activeConversationId: runConvId ?? useChatStore.getState().activeConversationId,
        });
        const mcpContext = {
          scopePaths: mcpScopePaths,
          connectionId: effectiveConnection?.id ?? null,
          signal: toolAbort.signal,
        };

        // Segment tracking for thinking blocks
        let thinkingSegmentIndex = -1;
        let thinkingSegmentContent = '';

        // ---------------------------------------------------------------
        // Intermediate-progress tracking ($/progress steps + server-side
        // agent-round tool calls). The LSP re-emits the full steps /
        // toolCalls arrays on every report, so we key each entry by its id
        // and only push a segment on first sighting / patch it on change.
        // ---------------------------------------------------------------
        /** stepId → { segment index, last rendered snapshot } */
        const stepSegments = new Map<string, { index: number; label: string; status: ToolCallSegment['status'] }>();
        /** toolCallId → { segment index, last rendered snapshot } */
        const toolUpdateSegments = new Map<string, { index: number; label: string; detail?: string; status: ToolCallSegment['status'] }>();
        /** toolCallIds that already produced a tool_result segment */
        const resultedToolIds = new Set<string>();
        /** toolCallIds handled by the CLIENT tool path (`copilot-tool-call` →
         *  handleToolCall). Those already render their own segments incl.
         *  permission handling; the round toolCalls in $/progress can mirror
         *  the same ids, and rendering both would duplicate. */
        const clientToolIds = new Set<string>();

        /** Segment count for THIS turn's assistant message, read live so
         *  indices captured at push time stay authoritative. */
        const segmentCount = (): number => {
          const state = useChatStore.getState();
          const conv = state.conversations.find(
            (c) => c.id === (runConvId ?? state.activeConversationId),
          );
          const msg = conv?.messages.find((m) => m.timestamp === assistantMessageId);
          return msg?.segments?.length ?? 0;
        };

        // Correlation for this turn. Progress events are matched on the token
        // we generate here and send as the request's workDoneToken; server
        // requests (tool call, confirmation, context) on the conversation id,
        // which a follow-up turn already has and a create learns from its own
        // first progress event. An event naming neither is not ours unless
        // this is the only Copilot stream running (see copilot-correlation.ts).
        const knownCopilotId = copilotConversationsRef.current.get(convKey);
        const turnConvId = knownCopilotId && knownCopilotId !== PENDING ? knownCopilotId : null;
        const turnStream = openCopilotStream(turnConvId);
        stream = turnStream;
        streamsRef.current.add(turnStream);
        const isOurProgress = (payload: CopilotProgressKey): boolean =>
          ownsCopilotProgress(turnStream, payload);
        const isOurRequest = (payload: { conversationId?: string }): boolean =>
          ownsCopilotRequest(turnStream, payload);

        // Build tools array if tool calling is enabled
        let tools: ToolDefinition[] | undefined;
        const toolCallingEnabled = useSettingsStore.getState().toolCallingEnabled;
        if (toolCallingEnabled) {
          // Built-in and skill tools, plus the tools of enabled, running MCP
          // servers in this conversation's project scope. The LSP takes the
          // tool list at `conversation/create` only, so a server started
          // later is picked up by the next new conversation.
          tools = useSkillStore.getState().getToolDefinitions(undefined, { mcpProjectPaths: mcpScopePaths });
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
          unlistenBegin,
          unlistenChunk,
          unlistenThinking,
          unlistenDone,
          unlistenToolCall,
          unlistenToolConfirmation,
          unlistenContextRequest,
          unlistenStep,
          unlistenToolUpdate,
        ] = await Promise.all([
          // Binds the stream to its conversation id before the first tool
          // call, which can arrive ahead of any text.
          listen<CopilotProgressKey>('copilot-chat-begin', (event) => {
            if (cancelled) return;
            isOurProgress(event.payload);
          }),
          listen<CopilotProgressKey & { text: string }>('copilot-chat-chunk', (event) => {
            if (cancelled || !isOurProgress(event.payload)) return;
            streamedContent += event.payload.text;
            contentDirty = true;
            appendTextSegment(assistantMessageId, event.payload.text, runConvId);
          }),
          listen<CopilotProgressKey & { text: string }>('copilot-chat-thinking', (event) => {
            if (cancelled || !isOurProgress(event.payload)) return;
            thinkingSegmentContent += event.payload.text;
            if (thinkingSegmentIndex === -1) {
              const conv = useChatStore.getState().conversations.find(
                (c) => c.id === (runConvId ?? useChatStore.getState().activeConversationId),
              );
              const msg = conv?.messages.find((m) => m.timestamp === assistantMessageId);
              thinkingSegmentIndex = msg?.segments?.length ?? 0;
              pushSegment(assistantMessageId, {
                type: 'thinking',
                content: thinkingSegmentContent,
                collapsed: false,
                timestamp: Date.now(),
              }, runConvId);
            } else {
              updateSegment(assistantMessageId, thinkingSegmentIndex, {
                content: thinkingSegmentContent,
              }, runConvId);
            }
          }),
          listen<CopilotProgressKey & { error?: { message?: string; reason?: string; modelName?: string; code?: number } }>('copilot-chat-done', (event) => {
            if (cancelled || !isOurProgress(event.payload)) return;
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
              setMessageError(assistantMessageId, errorMsg, runConvId);
            }
            cleanup();
            // cleanup() cleared the run; if the turn ended in error, override it.
            if (event.payload.error) runError(runConvId);
          }),
          listen<{ requestId: string; id: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>(
            'copilot-tool-call',
            (event) => {
              if (cancelled || !isOurRequest(event.payload)) return;
              const { requestId, id, name, arguments: args } = event.payload;
              log.debug('ai', `Copilot tool call received: ${name}`);

              // The $/progress round toolCalls can mirror this same call —
              // mark it as client-handled so `copilot-chat-tool-update`
              // doesn't render a duplicate segment for it.
              clientToolIds.add(id);

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
                } as ToolCallSegment, runConvId);
                return;
              }

              // Handle tool call asynchronously
              handleToolCall(requestId, id, name, args, assistantMessageId, runConvId, () => cancelled, mcpContext).catch((err) => {
                log.error('ai', 'Tool call execution failed', err);
              });
            },
          ),
          listen<{ requestId: string; name: string; arguments: Record<string, unknown>; conversationId?: string }>(
            'copilot-tool-confirmation',
            (event) => {
              if (cancelled || !isOurRequest(event.payload)) return;
              const { requestId, name, arguments: args } = event.payload;
              log.debug('ai', `Copilot tool confirmation request: ${name}`);

              // An MCP tool is shown, and its approval stored, per server +
              // tool (see `handleToolCall`).
              const mcpTarget = isMcpToolName(name) ? resolveMcpTool(name, mcpScopePaths) : null;
              const mcpKey = mcpTarget ? mcpPermissionKey(mcpTarget) : null;

              // Show permission card and wait for user decision
              const decision$ = new Promise<ToolCallDecision>((resolve) => {
                useToolPermissionStore.getState().setPending({
                  id: requestId,
                  name,
                  arguments: args,
                  resolve,
                  conversationId: runConvId,
                  ...(mcpTarget
                    ? { mcp: { serverName: mcpTarget.serverName, toolName: mcpTarget.toolName } }
                    : {}),
                });
              });

              decision$.then((decision) => {
                // Stop pressed while the card was up: `cleanup` cleared the
                // pending entry and resolved this as 'deny'. Tell the LSP so
                // (best effort, the conversation may be gone) and record
                // nothing.
                if (cancelled) {
                  tauriApi.copilotLspToolConfirmationResponse(requestId, false).catch(() => {});
                  return;
                }
                useToolPermissionStore.getState().setPending(null, runConvId);
                const accepted = decision !== 'deny';

                if (mcpTarget && mcpKey) {
                  if (decision === 'session') {
                    usePermissionStore.getState().allowToolSession(mcpKey);
                  } else if (decision === 'always') {
                    usePermissionStore.getState().allowToolAlways(mcpKey, mcpContext.connectionId, mcpTarget.projectRoot);
                  }
                } else if (decision === 'session') {
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
            if (cancelled || !isOurRequest(event.payload)) return;
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
          // Progress steps (skill resolution, searching, …) → compact
          // tool_call segments with kind 'step', patched in place as the
          // step's status advances. Mirrors the ACP plan/thought treatment:
          // intermediate progress becomes visible instead of dead air.
          listen<CopilotStepPayload & CopilotProgressKey>('copilot-chat-step', (event) => {
            if (cancelled || !isOurProgress(event.payload)) return;
            const { stepId, title, status } = event.payload;
            const key = stepId ?? title ?? '';
            if (!key) return;
            const mappedStatus = mapCopilotProgressStatus(status);
            const label = (title ?? '').trim() || 'Working…';
            const existing = stepSegments.get(key);
            if (!existing) {
              stepSegments.set(key, { index: segmentCount(), label, status: mappedStatus });
              pushSegment(assistantMessageId, {
                type: 'tool_call',
                kind: 'step',
                label,
                status: mappedStatus,
                timestamp: Date.now(),
              } as ToolCallSegment, runConvId);
            } else if (existing.status !== mappedStatus || existing.label !== label) {
              existing.status = mappedStatus;
              existing.label = label;
              updateSegment(assistantMessageId, existing.index, {
                status: mappedStatus,
                label,
              }, runConvId);
            }
          }),
          // Server-side agent-round tool calls (editAgentRounds[].toolCalls)
          // → tool_call segments keyed by toolCallId, patched on status
          // change; a terminal status with a result/error additionally pushes
          // one tool_result segment (mirrors the ACP tool_call_update flow).
          listen<CopilotToolUpdatePayload & CopilotProgressKey>('copilot-chat-tool-update', (event) => {
            if (cancelled || !isOurProgress(event.payload)) return;
            const p = event.payload;
            const id = p.toolCallId ?? null;
            if (!id || clientToolIds.has(id)) return;

            const name = (p.name ?? '').trim() || 'tool';
            const args = p.input && typeof p.input === 'object'
              ? (p.input as Record<string, unknown>)
              : undefined;
            const status: ToolCallSegment['status'] =
              p.error != null ? 'error' : mapCopilotProgressStatus(p.status);
            const label = formatToolLabel(name, args);
            const detail =
              (typeof p.progressMessage === 'string' && p.progressMessage.trim())
                ? p.progressMessage
                : args && Object.keys(args).length > 0
                  ? JSON.stringify(args, null, 2)
                  : undefined;

            const existing = toolUpdateSegments.get(id);
            if (!existing) {
              toolUpdateSegments.set(id, { index: segmentCount(), label, detail, status });
              pushSegment(assistantMessageId, {
                type: 'tool_call',
                kind: name,
                label,
                detail,
                status,
                timestamp: Date.now(),
              } as ToolCallSegment, runConvId);
            } else if (
              existing.status !== status ||
              existing.label !== label ||
              existing.detail !== detail
            ) {
              existing.status = status;
              existing.label = label;
              existing.detail = detail;
              updateSegment(assistantMessageId, existing.index, {
                status,
                label,
                detail,
              }, runConvId);
            }

            // Terminal → one tool_result segment per toolCallId.
            if (
              (status === 'done' || status === 'error') &&
              !resultedToolIds.has(id) &&
              (p.result != null || p.error != null)
            ) {
              resultedToolIds.add(id);
              pushSegment(assistantMessageId, {
                type: 'tool_result',
                toolCallId: id,
                result: status === 'done' ? stringifyProgressValue(p.result) : undefined,
                error: status === 'error'
                  ? stringifyProgressValue(p.error ?? p.result)
                  : undefined,
                collapsed: true,
                timestamp: Date.now(),
              } as ToolResultSegment, runConvId);
            }
          }),
        ]);

        const cleanup = () => {
          if (cancelled) return;
          cancelled = true;
          clearInterval(flushInterval);
          toolAbort.abort();
          unlistenBegin();
          unlistenChunk();
          unlistenThinking();
          unlistenDone();
          unlistenToolCall();
          unlistenToolConfirmation();
          unlistenContextRequest();
          unlistenStep();
          unlistenToolUpdate();
          closeCopilotStream(turnStream);
          streamsRef.current.delete(turnStream);
          // Unblock a tool-permission decision this turn may be awaiting (Stop
          // pressed, or the turn ended, while the card was visible). Clearing
          // the pending entry removes the card so a later click cannot run a
          // tool for a finalized turn; resolving lets the awaiting code settle,
          // and the `cancelled` flag set above bails it out before it writes
          // anything (mirrors `useDirectApiChat`).
          const pendingPerm = selectPendingForConversation(runConvId)(useToolPermissionStore.getState());
          if (pendingPerm) {
            useToolPermissionStore.getState().setPending(null, runConvId);
            pendingPerm.resolve('deny');
          }
          if (streamedContent) {
            updateMessage(assistantMessageId, streamedContent, undefined, runConvId);
          }
          finalizeSegments(assistantMessageId, runConvId);
          setLoading(false);
          setActiveTool(null);
          runIdle(runConvId);
          // Drop this conversation's cleanup from the registry (only if it is
          // still the one we registered — a re-send may have replaced it).
          if (cleanupRefs.current.get(convKey) === cleanup) {
            cleanupRefs.current.delete(convKey);
          }
        };

        cleanupRefs.current.set(convKey, cleanup);

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
        // are delivered, so events arrive DURING this await, matched on the
        // token passed here.
        // The Copilot conversation is looked up for THIS Notesage conversation:
        // each one gets its own, so no turn ever rides on another chat's history.
        const copilotConversations = copilotConversationsRef.current;
        const copilotId = copilotConversations.get(convKey);
        if (!copilotId) {
          // Set sentinel to prevent a concurrent sendChatMessage in the same
          // conversation from creating a second one before the first resolves.
          copilotConversations.set(convKey, PENDING);
          try {
            const result = await tauriApi.copilotLspConversationCreate(
              content, model, lspTools, docUri, docLang, turnStream.token,
            );
            if (copilotConversations.get(convKey) === PENDING) {
              copilotConversations.set(convKey, result.conversationId);
            } else {
              // Cancelled (or the hook unmounted) while the create was in
              // flight: nobody owns this conversation any more.
              tauriApi.copilotLspConversationDestroy(result.conversationId).catch(() => {});
            }
          } catch (e) {
            if (copilotConversations.get(convKey) === PENDING) copilotConversations.delete(convKey);
            throw e;
          }
        } else if (copilotId === PENDING) {
          throw new Error('A conversation is already being created. Please wait.');
        } else {
          await tauriApi.copilotLspConversationTurn(copilotId, content, model, docUri, docLang, turnStream.token);
        }
      } catch (error) {
        clearInterval(flushInterval);
        cleanupRefs.current.get(convKey)?.();
        if (stream) {
          closeCopilotStream(stream);
          streamsRef.current.delete(stream);
        }
        log.error('ai', 'Copilot chat stream error', error);

        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('method not found') || errorMsg.includes('Method not found') || errorMsg.includes('-32601')) {
          toast.error('Chat not supported by this Copilot LSP version. Update copilot-language-server: npm update -g @github/copilot-language-server');
        }

        setMessageError(
          assistantMessageId,
          friendlyAIError(error, effectiveConnection?.label || 'Copilot', effectiveConnection?.id),
          runConvId,
        );
        setLoading(false);
        setActiveTool(null);
        runError(runConvId);
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

  const cancelChat = useCallback((convId?: string | null) => {
    // Cancel ONE conversation's Copilot turn, defaulting to the foreground one
    // (the user pressing Stop cancels what they are watching). Other
    // conversations keep their listeners and their Copilot conversation.
    const targetKey = (convId ?? useChatStore.getState().activeConversationId) ?? NO_CONVERSATION_KEY;
    cleanupRefs.current.get(targetKey)?.();
    // Destroying the Copilot conversation is what stops the LSP generating.
    // The next message in this chat starts a new one.
    const copilotId = copilotConversationsRef.current.get(targetKey);
    if (copilotId) {
      if (copilotId !== PENDING) {
        tauriApi.copilotLspConversationDestroy(copilotId).catch(() => {});
      }
      copilotConversationsRef.current.delete(targetKey);
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
