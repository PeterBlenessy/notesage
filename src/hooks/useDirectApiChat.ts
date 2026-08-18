import { useCallback, useRef } from 'react';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore, selectPendingForConversation, type ToolCallDecision } from '@/stores/tool-permission-store';
import { useSkillStore } from '@/stores/skill-store';
import { getAIProvider } from '@/lib/ai';
import type { ChatMessage, Citation, ToolDefinition, ToolCallSegment, ImageAttachment } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import type { ResolvedCredentials } from '@/lib/ai/credentials';
import { executeToolCall } from '@/lib/tool-executor';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log, PERF } from '@/lib/logger';
import { friendlyAIError } from '@/lib/ai/errors';
import { formatToolLabel, buildAttachmentActivities } from '@/lib/ai/acp-utils';
import { ToolCallHistory, buildToolResultContent } from '@/lib/ai/tool-feedback';
import { trimMessagesToBudget, localBundledTrimBudget } from '@/lib/ai/context-trim';
import { budgetToolDefinitions, toolBudgetForContext } from '@/lib/ai/tool-budget';
import {
  planCompaction,
  buildCompactionPrompt,
  applyCompaction,
  isCompactionWorthwhile,
} from '@/lib/ai/compaction';
import { track } from '@/lib/telemetry';

/**
 * Ceiling for the compaction summary itself. Generous enough to preserve paths
 * and error text, small enough that the note cannot recreate the overflow it
 * exists to prevent.
 */
const COMPACTION_MAX_TOKENS = 700;
import { streamEvent, newStreamId } from '@/lib/ai/stream-events';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { runStarted, runRunning, runAwaitingPermission, runIdle, runError } from '@/lib/ai/session-run';

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
  /**
   * Append to THIS conversation rather than the active one (#468). Set when the
   * concurrency cap deferred the send, so it lands where it was typed even if
   * the user has navigated away in the meantime.
   */
  conversationId?: string;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Maximum tool calls allowed per user turn to prevent runaway loops. */
const MAX_TOOL_CALLS_PER_TURN = 20;

/** Stream-registry key for a send with no active conversation id (defensive). */
const NO_CONVERSATION_KEY = '__no_conversation__';

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
  // In-flight direct-API streams keyed by conversation id, so multiple
  // conversations can stream concurrently without tearing each other down
  // (PRD `2026-06-14-command-bar-session-multitasking`, task #3). Each handle
  // carries its backend `streamId` (so `cancelDirectChat` aborts the right
  // backend stream via `ai_chat_stream_cancel`) and its listener `cleanup`.
  const streamsRef = useRef<Map<string, { streamId: string; cleanup: () => void }>>(new Map());

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
      if (!resolved) {
        throw new Error('No AI provider configured. Set up a provider in Settings.');
      }

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      // Stamp the target connection on the user message so later resend/edit
      // actions in `FloatingCommandBar` can detect provider mismatch and
      // open ResendProviderDialog (project-data-isolation task #10).
      // Without this the dialog never fires because the resend handler
      // skips when `message.connectionId` is absent.
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: userTimestamp,
        displayContent: opts?.displayContent,
        skillName: opts?.skillName,
        attachments: opts?.attachments,
        ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}),
        ...(effectiveConnection ? { connectionId: effectiveConnection.id } : {}),
      };
      addMessage(userMessage, opts?.conversationId);

      // The conversation this send belongs to — read AFTER `addMessage`, which
      // CREATES (and activates) a conversation when there was none. Captured once
      // so every message/segment/activity write targets the OWNING conversation
      // even after the user switches away mid-stream (task #3). Also the
      // stream-registry key.
      // A cap-deferred send names its own conversation (#468); everything else
      // targets the active one, read after `addMessage` so a brand-new chat has
      // been created by then.
      const conversationId =
        opts?.conversationId ?? useChatStore.getState().activeConversationId ?? null;
      const convKey = conversationId ?? NO_CONVERSATION_KEY;

      // Tear down only THIS conversation's stale stream (a re-send in the same
      // chat). Other conversations' in-flight streams are left running.
      streamsRef.current.get(convKey)?.cleanup();

      // Task #30 — log every file-path attachment on the user message so the
      // user has a visible trail of what was shipped to the provider. Image
      // byte attachments are visible as thumbnails already (intentionally not
      // logged here).
      for (const activity of buildAttachmentActivities(opts?.attachedFilePaths, userTimestamp)) {
        addActivity(userTimestamp, activity, conversationId);
      }

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
      }, conversationId);

      let flushInterval: ReturnType<typeof setInterval> | undefined;

      try {
        let streamedContent = '';
        let streamedThinking = '';
        const collectedCitations: Citation[] = [];
        // Unique correlation id for this turn (reused across tool-continuation
        // re-invokes). Events are listened on `<event>:<streamId>` so a
        // concurrent structured/agent stream can't bleed into this message —
        // and stale chunks from a cancelled turn land on a dead channel.
        const streamId = newStreamId();
        // Record this conversation's run in the session-run-store so the orb,
        // history badges, and per-conversation foreground loading can read it
        // independently of the command-bar view (task #4).
        runStarted(conversationId, 'direct', { streamId });

        let contentDirty = false;
        let thinkingDirty = false;
        flushInterval = setInterval(() => {
          if (thinkingDirty) {
            updateMessageThinking(assistantMessageId, streamedThinking, conversationId);
            thinkingDirty = false;
          }
          if (contentDirty) {
            updateMessage(assistantMessageId, streamedContent, undefined, conversationId);
            contentDirty = false;
          }
        }, 50);

        // Tool call state — scoped to this streaming session
        const pendingToolCalls: PendingToolCall[] = [];
        let toolCallCount = 0;
        // Per-session self-correction history. Tracks which (tool, args) have
        // already failed so the next attempt with the same shape gets an
        // anti-loop directive instead of just the wrapped error.
        const toolCallHistory = new ToolCallHistory();

        // Sliding-window trim for the local_bundled provider. 4K-32K context
        // windows fill quickly during multi-turn tool loops; without trimming
        // the server returns a truncation error or silently drops the oldest
        // content in a way that breaks the tool_calls/tool_result pairing.
        // Returns the (possibly trimmed) message list ready for ai_chat_stream.
        const trimForProvider = (msgs: ChatMessage[]): ChatMessage[] => {
          if (resolved?.provider !== 'local_bundled') return msgs;
          const ctxLen = useLocalAIStore.getState().contextLength;
          const budget = localBundledTrimBudget(ctxLen);
          const result = trimMessagesToBudget(msgs, budget);
          if (result.dropped > 0) {
            log.info(PERF.context, 'trim', {
              dropped: result.dropped,
              kept: result.messages.length,
              budgetTokens: budget,
              estimatedTokens: result.estimatedTokens,
            });
          }
          return result.messages;
        };

        /**
         * Compaction-aware variant of `trimForProvider`, used ONLY at the start
         * of a user turn.
         *
         * Trimming deletes the oldest rounds; compaction summarizes them first,
         * so the agent keeps the narrative — which files it touched, what it
         * ruled out, which error it already diagnosed — instead of rediscovering
         * it. That costs one generation call, which is why it is deliberately
         * NOT used inside the tool loop: a continuation is mid-task, and
         * compacting there both stalls the loop and lands exactly when the
         * model's context is most fragile. The turn boundary is the closest
         * thing this path has to the "compact at a task boundary" rule; the
         * tool loop keeps the cheap synchronous trim.
         *
         * Any failure degrades to that same trim — a summarizer that errors or
         * returns nothing must never cost the user their turn.
         */
        const compactForProvider = async (msgs: ChatMessage[]): Promise<ChatMessage[]> => {
          if (resolved?.provider !== 'local_bundled') return msgs;
          const ctxLen = useLocalAIStore.getState().contextLength;
          const budget = localBundledTrimBudget(ctxLen);
          const plan = planCompaction(msgs, budget);
          if (!isCompactionWorthwhile(plan)) return trimForProvider(msgs);

          try {
            const summary = await invoke<string>('ai_chat', {
              messages: [
                { role: 'user', content: buildCompactionPrompt(plan.toCompact) },
              ],
              provider: 'local_bundled',
              apiKey: null,
              ollamaUrl: null,
              model: null,
              temperature: 0.2, // summarizing, not composing
              maxTokens: COMPACTION_MAX_TOKENS,
              baseUrl: null,
            });
            const compacted = applyCompaction(plan, summary);
            log.info(PERF.context, 'compact', {
              summarized: plan.toCompact.length,
              kept: plan.toKeep.length,
              budgetTokens: budget,
            });
            // Counts how often a local model outgrows its window in the field.
            // Fired only on a compaction that actually happened — not on the
            // fallback path below, which would conflate it with failure.
            track('feature_used', { feature: 'context_compaction' });
            return compacted;
          } catch (error) {
            log.warn('ai', 'Context compaction failed, falling back to trim', error);
            return trimForProvider(msgs);
          }
        };

        // Segment tracking for thinking blocks
        let thinkingSegmentIndex = -1;
        let thinkingSegmentContent = '';

        // Track whether this streaming session has been cleaned up (cancel or
        // done). Declared before `handleToolCalls` so the tool loop can check
        // it after every await and bail instead of re-invoking `ai_chat_stream`
        // — a continuation after Stop would spawn a fresh provider stream whose
        // events land on torn-down channels (invisible, but billed).
        let cancelled = false;

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
          if (pendingToolCalls.length === 0 || cancelled) return;

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
              }, conversationId);
              pushSegment(assistantMessageId, {
                type: 'tool_call',
                kind: call.name,
                label: formatToolLabel(call.name, call.arguments),
                detail: 'Tool call limit reached',
                status: 'error',
                timestamp: Date.now(),
              } as ToolCallSegment, conversationId);
              toolResultMessages.push({
                role: 'tool' as const,
                content: 'Tool call limit reached (20 per turn). Please respond with text.',
                toolCallId: call.id,
              });
              continue;
            }

            // Check permission. `requireAllToolConfirmations` globally overrides
            // auto-allow so even read-only/built-in tools prompt every time.
            const requireAll = useSettingsStore.getState().requireAllToolConfirmations;
            const rawTier = usePermissionStore.getState().isToolAllowed(call.name, null, null);
            const tier = requireAll ? 'none' : rawTier;
            // Tracks how this specific call was authorized — recorded on the activity.
            let approvalMode: import('@/lib/ai/types').ActivityApprovalMode = 'auto';

            if (tier === 'none') {
              // Show permission card and wait for user decision
              log.info('ai', `Requesting permission for tool: ${call.name}`);
              runAwaitingPermission(conversationId, call.id);
              const decision = await new Promise<ToolCallDecision>((resolve) => {
                useToolPermissionStore.getState().setPending({
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  resolve,
                  conversationId,
                });
              });
              useToolPermissionStore.getState().setPending(null, conversationId);
              // Stop pressed while the card was up — `cleanup` resolved this
              // promise ('deny') and already finalized the message. Bail before
              // any further writes or the continuation re-invoke.
              if (cancelled) return;
              // Decision in (allow or deny) — the turn resumes streaming either way.
              runRunning(conversationId);

              if (decision === 'deny') {
                log.info('ai', `Tool call denied by user: ${call.name}`);
                addActivity(assistantMessageId, {
                  kind: 'tool_call',
                  label: call.name,
                  detail: 'Permission denied',
                  status: 'done',
                  timestamp: Date.now(),
                  approvalMode: 'denied',
                }, conversationId);
                pushSegment(assistantMessageId, {
                  type: 'tool_call',
                  kind: call.name,
                  label: formatToolLabel(call.name, call.arguments),
                  detail: 'Permission denied',
                  status: 'error',
                  timestamp: Date.now(),
                } as ToolCallSegment, conversationId);
                toolResultMessages.push({
                  role: 'tool' as const,
                  content: buildToolResultContent({
                    toolName: call.name,
                    args: call.arguments,
                    rawContent: `Permission denied for tool: ${call.name}`,
                    isError: true,
                    history: toolCallHistory,
                  }),
                  toolCallId: call.id,
                });
                continue;
              }

              // User approved.
              approvalMode = 'user';

              // Update permissions based on decision. Under `requireAllToolConfirmations`
              // we honour session/always so the user isn't drowned in prompts on every
              // turn — but the global flag still means each *new* tool kind prompts.
              if (decision === 'session') {
                usePermissionStore.getState().allowToolSession(call.name);
              } else if (decision === 'always') {
                usePermissionStore.getState().allowToolAlways(call.name, null, null);
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
              approvalMode,
            }, conversationId);

            // Push tool call segment (running). Read the segment count from THIS
            // send's own conversation (not the foreground one) so the index is
            // correct when a background stream is mid-flight (task #3).
            const toolLabel = formatToolLabel(call.name, call.arguments);
            const toolDetail = Object.keys(call.arguments).length > 0
              ? JSON.stringify(call.arguments, null, 2) : undefined;
            const convForIdx = useChatStore.getState().conversations
              .find(c => c.id === (conversationId ?? useChatStore.getState().activeConversationId));
            const msgForIdx = convForIdx?.messages.find(m => m.timestamp === assistantMessageId);
            const toolSegIdx = msgForIdx?.segments?.length ?? 0;
            pushSegment(assistantMessageId, {
              type: 'tool_call',
              kind: call.name,
              label: toolLabel,
              detail: toolDetail,
              status: 'running',
              timestamp: Date.now(),
            } as ToolCallSegment, conversationId);

            const scopeRoots = opts?.sandboxPaths ?? selectProjectPaths(useChatStore.getState());
            const scopeHomeDir = useSettingsStore.getState().homeDir ?? '';
            const result = await executeToolCall(call.id, call.name, call.arguments, {
              projectRoots: scopeRoots,
              homeDir: scopeHomeDir,
            });

            // Stop pressed while the tool executed — `cleanup` already tore
            // down the listeners and finalized the message's segments. Bail
            // before writing post-cancel state or re-invoking the stream.
            if (cancelled) return;

            // Update activity to done
            addActivity(assistantMessageId, {
              kind: 'tool_call',
              label: call.name,
              detail: result.is_error ? result.content : 'completed',
              status: 'done',
              timestamp: Date.now(),
              approvalMode,
            }, conversationId);

            // Update tool call segment to done and push tool result segment
            updateSegment(assistantMessageId, toolSegIdx, { status: result.is_error ? 'error' : 'done' }, conversationId);
            pushSegment(assistantMessageId, {
              type: 'tool_result',
              toolCallId: call.id,
              result: result.is_error ? undefined : result.content,
              error: result.is_error ? result.content : undefined,
              collapsed: true,
              timestamp: Date.now(),
            }, conversationId);

            toolResultMessages.push({
              role: 'tool' as const,
              content: buildToolResultContent({
                toolName: call.name,
                args: call.arguments,
                rawContent: result.content,
                isError: result.is_error,
                history: toolCallHistory,
              }),
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

          // Bail before the continuation if this turn was cancelled mid-loop —
          // re-invoking would spawn a zombie backend stream on a dead channel.
          if (cancelled) return;

          // Re-invoke ai_chat_stream with full history including tool results
          await invoke('ai_chat_stream', {
            messages: mapMessagesForRust(trimForProvider(conversationMessages)),
            provider: resolved.provider,
            connectionId: resolved.connectionId,
            ollamaUrl: resolved.ollamaUrl,
            webSearchEnabled: false, // Don't re-search on continuation
            tools: tools ?? null,
            model: resolved.config?.model ?? null,
            temperature: resolved.config?.temperature ?? null,
            maxTokens: resolved.config?.maxTokens ?? null,
            baseUrl: resolved.config?.baseUrl ?? null,
            responseFormat: null,
            streamId,
          });
        };

        // -------------------------------------------------------------------
        // Event listeners
        // -------------------------------------------------------------------

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
          listen<string>(streamEvent('ai-stream-chunk', streamId), (event) => {
            if (cancelled) return;
            streamedContent += event.payload;
            contentDirty = true;
            appendTextSegment(assistantMessageId, event.payload, conversationId);
          }),
          listen<string>(streamEvent('ai-stream-thinking-chunk', streamId), (event) => {
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
                .find(c => c.id === (conversationId ?? useChatStore.getState().activeConversationId));
              const msg = conv?.messages.find(m => m.timestamp === assistantMessageId);
              thinkingSegmentIndex = msg?.segments?.length ?? 0;
              pushSegment(assistantMessageId, {
                type: 'thinking',
                content: thinkingSegmentContent,
                collapsed: false,
                timestamp: Date.now(),
              }, conversationId);
            } else {
              updateSegment(assistantMessageId, thinkingSegmentIndex, {
                content: thinkingSegmentContent,
              }, conversationId);
            }
          }),
          listen<{ data: string; mimeType: string }>(streamEvent('ai-stream-image', streamId), (event) => {
            if (cancelled) return;
            pushSegment(assistantMessageId, {
              type: 'image',
              data: event.payload.data,
              mimeType: event.payload.mimeType,
              timestamp: Date.now(),
            }, conversationId);
          }),
          listen<{ tool: string; status: string }>(streamEvent('ai-tool-use', streamId), (event) => {
            if (cancelled) return;
            if (event.payload.status === 'start') {
              setActiveTool(event.payload.tool);
            }
          }),
          listen<{ url: string; title: string; cited_text: string }>(streamEvent('ai-citation', streamId), (event) => {
            if (cancelled) return;
            const { url, title, cited_text } = event.payload;
            if (!collectedCitations.some((c) => c.url === url)) {
              collectedCitations.push({ url, title, citedText: cited_text });
            }
          }),
          listen<PendingToolCall>(streamEvent('ai-tool-call', streamId), (event) => {
            if (cancelled) return;
            log.debug('ai', `Tool call received: ${event.payload.name}`);
            pendingToolCalls.push(event.payload);
          }),
          listen(streamEvent('ai-tool-calls-done', streamId), () => {
            if (cancelled) return;
            // All tool calls for this turn have been emitted — execute and continue
            log.debug('ai', `Processing ${pendingToolCalls.length} tool calls`);
            handleToolCalls().catch((err) => {
              log.error('ai', 'Tool call execution failed', err);
              // On error, finalize the message with whatever content we have
              if (streamedContent) {
                updateMessage(assistantMessageId, streamedContent, undefined, conversationId);
              }
              setMessageError(
                assistantMessageId,
                friendlyAIError(err, effectiveConnection?.label || resolved?.provider, effectiveConnection?.id),
                conversationId,
              );
              setLoading(false);
              setActiveTool(null);
              runError(conversationId);
            });
          }),
          listen(streamEvent('ai-stream-done', streamId), () => {
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
          // Unblock a tool-permission decision this turn may be awaiting (Stop
          // pressed while the card was visible). Resolving lets the orphaned
          // promise in `handleToolCalls` settle — the `cancelled` flag set above
          // then bails it out before any continuation re-invoke — and clearing
          // the pending entry removes the card so a later click can't spawn a
          // zombie backend stream.
          const pendingPerm = selectPendingForConversation(conversationId)(useToolPermissionStore.getState());
          if (pendingPerm) {
            useToolPermissionStore.getState().setPending(null, conversationId);
            pendingPerm.resolve('deny');
          }
          if (streamedThinking) {
            updateMessageThinking(assistantMessageId, streamedThinking, conversationId);
          }
          if (collectedCitations.length > 0 || streamedContent) {
            updateMessage(assistantMessageId, streamedContent, collectedCitations.length > 0 ? collectedCitations : undefined, conversationId);
          }
          finalizeSegments(assistantMessageId, conversationId);
          setLoading(false);
          setActiveTool(null);
          // Run reached a clean end (completed or cancelled) — clear its run state.
          runIdle(conversationId);
          // Drop this conversation's stream from the registry (only if it's still
          // the one we registered — a re-send may have replaced it).
          if (streamsRef.current.get(convKey)?.streamId === streamId) {
            streamsRef.current.delete(convKey);
          }
        };

        streamsRef.current.set(convKey, { streamId, cleanup });

        // Build tools array if tool calling is enabled
        let tools: ToolDefinition[] | undefined;
        const toolCallingEnabled = useSettingsStore.getState().toolCallingEnabled;
        if (toolCallingEnabled) {
          // All tools available to all agents — user controls access via permission system
          tools = useSkillStore.getState().getToolDefinitions();
          // Cap the schemas against a local model's window. JSON Schema is
          // verbose and this overhead is paid on every turn, so an unbounded
          // tool list can eat a large share of a 32K context before the user's
          // message is even considered. Cloud windows are big enough that the
          // cap would only ever remove capability, so it applies to the bundled
          // server alone.
          if (tools.length > 0 && resolved.provider === 'local_bundled') {
            const contextLength = useLocalAIStore.getState().contextLength;
            const { tools: fitted, dropped, estimatedTokens } = budgetToolDefinitions(
              tools,
              toolBudgetForContext(contextLength),
            );
            if (dropped.length > 0) {
              // Never a silent cap — a truncated tool list otherwise looks
              // identical to a model that simply chose not to use them.
              log.warn('ai', 'Tool schemas exceeded the local context budget', {
                kept: fitted.length,
                dropped,
                estimatedTokens,
                contextLength,
              });
            }
            tools = fitted;
          }
          if (tools.length === 0) tools = undefined;
        }

        // Turn boundary — the one place compaction is appropriate. Inside the
        // tool loop below, the cheap synchronous trim is used instead.
        const outboundMessages = await compactForProvider(conversationMessages);

        await invoke('ai_chat_stream', {
          messages: mapMessagesForRust(outboundMessages),
          provider: resolved.provider,
          connectionId: resolved.connectionId,
          ollamaUrl: resolved.ollamaUrl,
          webSearchEnabled: false, // Web search is now a client-side tool
          tools: tools ?? null,
          model: resolved.config?.model ?? null,
          temperature: resolved.config?.temperature ?? null,
          maxTokens: resolved.config?.maxTokens ?? null,
          baseUrl: resolved.config?.baseUrl ?? null,
          responseFormat: null,
          streamId,
        });
      } catch (error) {
        clearInterval(flushInterval);
        // Tear down this conversation's stream (the cleanup defined above, if it
        // was registered before the throw).
        streamsRef.current.get(convKey)?.cleanup();
        log.error('ai', 'Stream error', error);
        setMessageError(assistantMessageId, friendlyAIError(error, effectiveConnection?.label || resolved?.provider, effectiveConnection?.id), conversationId);
        setLoading(false);
        setActiveTool(null);
        runError(conversationId);
      }
    },
    [resolved, buildComposedSystemMessage, localSystemMessage, webSearchEnabled, addMessage, updateMessage, updateMessageThinking, setMessageError, setLoading, setError, setActiveTool, addActivity, appendTextSegment, pushSegment, updateSegment, finalizeSegments, effectiveConnection]
  );

  const cancelDirectChat = useCallback((convId?: string | null) => {
    // Cancel the stream for a specific conversation, defaulting to the foreground
    // one (the user pressing Stop cancels what they're watching). Other
    // conversations' streams keep running.
    const targetKey = (convId ?? useChatStore.getState().activeConversationId) ?? NO_CONVERSATION_KEY;
    const handle = streamsRef.current.get(targetKey);
    if (handle) {
      // Abort the backend stream so the provider stops generating (and billing) —
      // best-effort, before we tear down local listeners.
      invoke('ai_chat_stream_cancel', { streamId: handle.streamId }).catch(() => {
        // Best-effort: the stream may have already finished server-side.
      });
      handle.cleanup();
    }
    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { generateText, sendChatMessage, cancelDirectChat };
}
