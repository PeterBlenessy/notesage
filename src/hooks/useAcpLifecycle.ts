// ---------------------------------------------------------------------------
// ACP chat lifecycle orchestrator.
//
// Composes the extracted ACP runtime modules (`src/hooks/acp/*`) into the
// chat-facing operations: prompt send, crash retry with session restore, and
// cancel. The per-conversation stream-cleanup map is owned here (one per
// mounted hook); module-level runtime state lives in its own owners:
//   - unresponsive timer + recovery callbacks → `acp/unresponsive-monitor`
//   - eager session creation + promise lock   → `acp/useEagerAcpSession`
//   - workspace respawn / agent-exit guards   → `acp/useAcpAgentGuards`
//   - inline single-turn generation           → `acp/inline-generate`
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, selectProjectPaths, selectPendingProjectSwitch, getSessionIdForLeaf, sliceThreadBySegment } from '@/stores/chat-store';
import { getThreadResilient } from '@/lib/chat-tree';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage, ImageAttachment } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { isAcpConnectionError, friendlyAcpError } from '@/lib/ai/errors';
import { formatStopReasonNotice, toTelemetryStopReason } from '@/lib/ai/stop-reason';
import { track, providerKind } from '@/lib/telemetry';
import { isAuthError, canReauthenticate, reauthenticateAgent } from '@/lib/ai/reauth';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { AcpSessionResult, AcpSessionUpdatePayload, AcpSpawnResult } from '@/lib/ai/acp-utils';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import { buildAttachmentActivities, getChatSandboxScope, hasLoadSessionCapability } from '@/lib/ai/acp-utils';
import { getAcpAgent, stopAcpAgent, ensureAcpAgent, updateAcpAgentInstanceId, type AcpAgentState } from '@/lib/ai/acp-agent-state';
import { getHomeDir } from '@/hooks/agent-task/home-dir';
import {
  acpUnresponsiveMonitor,
  startUnresponsiveTimer,
  clearUnresponsiveTimer,
  UNRESPONSIVE_TIMEOUT_MS,
} from '@/hooks/acp/unresponsive-monitor';
import { cleanupKeyFor, runConvCleanup, runAllConvCleanups, registerConvCleanup, type CleanupMap } from '@/hooks/acp/conv-cleanup';
import { cacheAgentModels, applyFreshSessionConfig } from '@/hooks/acp/session-config';
import { useEagerAcpSession } from '@/hooks/acp/useEagerAcpSession';
import { useAcpWorkspaceRespawn, useAcpAgentExitWatcher } from '@/hooks/acp/useAcpAgentGuards';
import { acpGenerateTextOnce } from '@/hooks/acp/inline-generate';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { runStarted, runAttachInstance, runError, runIdle } from '@/lib/ai/session-run';

/**
 * The ACP agent bound to the foreground (active) conversation, if any.
 *
 * After the singleton → per-conversation registry migration (PRD
 * `2026-06-14-command-bar-session-multitasking`, task #2), "the current agent"
 * is the registry entry keyed by the active conversation. Module-level concerns
 * that operate on whatever the user is watching (the unresponsive check, cancel)
 * resolve through this; concurrent background agents are reached via their own
 * conversation ids.
 */
function foregroundAgent() {
  return getAcpAgent(useChatStore.getState().activeConversationId ?? undefined);
}

/**
 * Total size ceiling for the injected conversation history, in characters.
 *
 * ~24k chars is roughly 6k tokens at the usual chars/token heuristic — enough
 * for a meaningful recap, small enough to leave a 32K local window mostly free
 * for the actual work. Cloud agents have far more room and are unaffected in
 * practice; the bound exists because the unbounded version broke the smallest
 * window, and an unbounded prompt is not defensible on any of them.
 */
export const ACP_HISTORY_BUDGET_CHARS = 24_000;

/**
 * Build the `<conversation-history>` preamble injected when a NEW ACP session
 * starts mid-conversation — the first message of a fresh session, OR a
 * crash-retry that fell back to a fresh session (session/load unsupported or
 * failed). Without it, the new session gives the agent zero prior context and
 * the conversation appears "broken" / the agent can't continue.
 *
 * Reads the active conversation's RESILIENT thread (so an orphaned activeLeafId
 * can't collapse it to a single message), slices it to the active segment for
 * provider context isolation, and excludes the message pair currently being
 * (re)sent (passed as `excludeTimestamps`).
 *
 * BOUNDED by total size, not just per message. Each message was already capped
 * at 2000 chars, but the message COUNT was not, so a long conversation produced
 * a single prompt of tens of thousands of tokens. On a local agent that is
 * unconditionally too large, and self-perpetuating: the turn stops at
 * `max_tokens` and every retry rebuilds the same oversized block. The newest
 * messages are kept — "continue from where you left off" depends on the recent
 * end — and anything dropped is stated in the block rather than silently
 * omitted, so the agent knows its view is partial.
 */
export function buildAcpHistoryBlock(
  excludeTimestamps: number[],
  budgetChars: number = ACP_HISTORY_BUDGET_CHARS,
  convId?: string | null,
): string {
  const store = useChatStore.getState();
  // `convId` names the conversation this history belongs to. A send deferred by
  // the concurrency cap runs while the user may be reading a DIFFERENT chat
  // (#468), and reading the active one here would splice that chat's history
  // into this session's prompt — a cross-conversation (and potentially
  // cross-project) leak. Falling back to the active conversation keeps the
  // ordinary path unchanged.
  const targetId = convId ?? store.activeConversationId;
  const conv = store.conversations.find((c) => c.id === targetId);
  const segment = conv?.segments[conv.activeSegmentIndex];
  const baseThread: ChatMessage[] = conv
    ? getThreadResilient(conv.messages, conv.activeLeafId).thread
    : [];
  const allMessages = sliceThreadBySegment(baseThread, segment, conv?.messages ?? []);
  const exclude = new Set(excludeTimestamps);
  const priorMessages = allMessages.filter(
    (m) => (m.timestamp === undefined || !exclude.has(m.timestamp)) && m.role !== 'system-status' && m.content,
  );
  if (priorMessages.length === 0) return '';
  const render = (m: ChatMessage) => {
    const prefix = m.role === 'user' ? 'User' : 'Assistant';
    const truncated = m.content.length > 2000 ? m.content.slice(0, 2000) + '\n... (truncated)' : m.content;
    const suffix = m.interrupted ? ' [interrupted]' : '';
    return `${prefix}${suffix}: ${truncated}`;
  };

  // Walk backwards from the newest so the recent end always survives, then
  // restore chronological order.
  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const line = render(priorMessages[i]);
    // Always keep at least one message: a block that says only "N omitted"
    // carries no context at all.
    if (kept.length > 0 && used + line.length > budgetChars) {
      omitted = i + 1;
      break;
    }
    kept.unshift(line);
    used += line.length;
  }

  const elision =
    omitted > 0
      ? `\n\n[${omitted} earlier message${omitted === 1 ? '' : 's'} omitted to fit the context window.]`
      : '';
  return `\n\n<conversation-history>\nThe following is the prior conversation in this session. The user may ask you to continue from where you left off.${elision}\n\n${kept.join('\n\n')}\n</conversation-history>`;
}

/**
 * Resolve the ACP session ID to use for the next prompt on the active conversation.
 *
 * Prefers a branch-specific session (attached after `session/fork` on a leaf-branch)
 * by walking the active leaf's ancestor chain; falls back to the conversation-level
 * session and finally to the agent's current chatSessionId.
 */
function resolveActiveSessionId(fallback: string | null, convId?: string | null): string | null {
  const state = useChatStore.getState();
  // See `buildAcpHistoryBlock` — a cap-deferred send must resolve ITS OWN
  // conversation's branch session, not the one being viewed, or the prompt
  // goes to another conversation's agent session (#468).
  const targetId = convId ?? state.activeConversationId;
  const conv = state.conversations.find((c) => c.id === targetId);
  if (!conv) return fallback;
  return getSessionIdForLeaf(conv, conv.activeLeafId) ?? fallback;
}

// Re-export for backward compatibility
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';
export { reapplySessionMode, applyConnectionModelOption } from '@/hooks/acp/session-config';
export {
  startUnresponsiveTimer,
  resetUnresponsiveTimer,
  clearUnresponsiveTimer,
  getRetryCallback,
  getKeepWaitingCallback,
} from '@/hooks/acp/unresponsive-monitor';
export {
  cleanupKeyFor,
  runConvCleanup,
  runAllConvCleanups,
  registerConvCleanup,
  type CleanupMap,
} from '@/hooks/acp/conv-cleanup';
import { t } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Turn helpers shared by the prompt-send and retry paths
// ---------------------------------------------------------------------------

/**
 * Create a fresh chat session on the agent, attach it to the registry entry,
 * record it on the active segment, and cache the agent-reported models.
 */
async function startFreshChatSession(
  instanceId: string,
  cwd: string,
  agent: AcpAgentState,
  connection: Connection | null,
  projectPaths: string[],
  convId?: string | null,
): Promise<AcpSessionResult> {
  const session = await invoke<AcpSessionResult>('acp_session_new', {
    instanceId,
    workingDirectory: cwd,
    mcpServers: buildAcpMcpServerInputs(agent.capabilities, projectPaths),
  });
  agent.chatSessionId = session.session_id;
  // Track session in the segment
  useChatStore.getState().setSegmentSessionId(session.session_id, convId);
  // Cache available models from the agent for the config dialog
  cacheAgentModels(connection, session);
  return session;
}

type ChatListenerDeps = Parameters<typeof setupAcpChatListeners>[0];

interface AttachTurnListenersArgs {
  cleanupMap: CleanupMap;
  instanceId: string;
  /**
   * Session this turn prompts on — the listeners gate on it so a session swap
   * on the shared agent instance (or an overlapping send) can't bleed another
   * session's chunks into this message (finding #4a).
   */
  sessionId: string | null;
  assistantMessageId: number;
  conversationId: string | undefined;
  listenerDeps: Omit<ChatListenerDeps, 'instanceId' | 'sessionId'>;
  /** Run key re-asserted when a stale cleanup ran — resolved lazily at re-assert time. */
  resolveRunKey: () => string | null | undefined;
  setLoading: (loading: boolean) => void;
  setActiveTool: (tool: string | null) => void;
  finalizeSegments: ChatListenerDeps['finalizeSegments'];
  setMessageInterrupted: (messageId: number, convId?: string | null) => void;
}

/**
 * Set up the full chat listeners for a turn and register their cleanup in the
 * per-conversation map. If a stale cleanup for the same conversation ran as a
 * side effect of registration (it clears the loading flag and the run entry),
 * re-assert what THIS turn established.
 */
async function attachTurnListeners(args: AttachTurnListenersArgs): Promise<void> {
  const { cleanupMap, instanceId, sessionId, assistantMessageId, conversationId } = args;
  const listeners = await setupAcpChatListeners({ ...args.listenerDeps, instanceId, sessionId });
  const hadStale = registerConvCleanup(
    cleanupMap,
    conversationId,
    buildAcpChatCleanup(
      listeners,
      instanceId,
      assistantMessageId,
      () => cleanupMap.delete(cleanupKeyFor(conversationId)),
      args.setLoading,
      args.setActiveTool,
      args.finalizeSegments,
      args.setMessageInterrupted,
      conversationId ?? null,
    ),
  );
  if (hadStale) {
    // The stale cleanup cleared the loading flag and this conversation's
    // run entry as side effects — re-assert what THIS turn established.
    args.setLoading(true);
    runStarted(args.resolveRunKey(), 'acp', { instanceId });
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface AcpLifecycleParams {
  effectiveConnection: Connection | null;
  acpSystemMessage: string;
  buildAcpSystemMessage?: (attachedFilePaths?: string[]) => string;
}

export function useAcpLifecycle({ effectiveConnection, acpSystemMessage, buildAcpSystemMessage }: AcpLifecycleParams) {
  const { addMessage, updateMessage, setMessageError, setMessageInterrupted, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, setLastActivityApprovalMode, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, updateOrPushPlanSegment, finalizeSegments, resetAssistantMessage } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  // Per-conversation stream cleanups (review #3) — one entry per in-flight ACP
  // turn, keyed by `cleanupKeyFor(conversationId)`. Replaces the single
  // `cleanupRef` that corrupted under concurrent sessions.
  const cleanupRefs = useRef<CleanupMap>(new Map());

  /**
   * Append an end-of-turn notice (e.g. "the agent ran out of tokens") to an
   * assistant message.
   *
   * Dual-writes exactly as the streaming path in `useAcpSessionListeners` does:
   * `segments` drive rendering, while `content` stays the canonical flat text
   * that search reads. Writing only the segment would render the notice but
   * leave it unsearchable. The streamed text lives in the listener's closure,
   * not here, so `content` is read back from the store and extended.
   */
  /**
   * Report how a turn finished, coerced to the closed telemetry enum.
   *
   * Defined once because both the initial send and the crash-retry path end a
   * turn, and a retry that quietly went unreported would bias the very
   * statistic this exists to measure.
   */
  const trackTurnEnded = useCallback(
    (stopReason: string | null | undefined) => {
      track('ai_turn_ended', {
        path: 'acp',
        provider_kind: providerKind(
          effectiveConnection?.provider ?? '',
          effectiveConnection?.authMethod ?? '',
        ),
        stop_reason: toTelemetryStopReason(stopReason),
      });
    },
    [effectiveConnection],
  );

  const appendTurnNotice = useCallback(
    // `convId` mirrors the store's own `convId?: string | null` — an absent id
    // means "the active conversation", which is how every other call here works.
    (messageId: number, notice: string, convId?: string | null) => {
      const state = useChatStore.getState();
      const targetId = convId ?? state.activeConversationId;
      const conv = state.conversations.find((c) => c.id === targetId);
      const existing = conv?.messages.find((m) => m.timestamp === messageId)?.content ?? '';
      updateMessage(messageId, existing + notice, undefined, convId);
      appendTextSegment(messageId, notice, convId);
    },
    [updateMessage, appendTextSegment],
  );

  // Tear down every in-flight stream on unmount so concurrent sessions don't
  // leak listeners when the hook is destroyed (the old single `cleanupRef` had
  // no unmount teardown at all). Ref-only, so this runs exactly once.
  useEffect(() => {
    const map = cleanupRefs.current;
    return () => { runAllConvCleanups(map); };
  }, []);

  // ---------------------------------------------------------------------------
  // Unresponsive agent detection — check if alive, then show banner
  // ---------------------------------------------------------------------------

  const checkAgentAndNotify = useCallback(async () => {
    const agent = foregroundAgent();
    if (!agent) return;

    // Clean up listeners from the stuck prompt (the foreground conversation —
    // the unresponsive timer tracks the active turn).
    clearUnresponsiveTimer();
    runConvCleanup(cleanupRefs.current, useChatStore.getState().activeConversationId);

    try {
      const alive = await invoke<boolean>('acp_is_agent_alive', {
        instanceId: agent.instanceId,
      });

      if (alive) {
        // Agent is still running — let user decide
        useAgentStatusStore.getState().setStatus('unresponsive');
        log.warn('ai', 'ACP agent unresponsive — showing banner (process alive)');
      } else {
        // Agent is dead
        useAgentStatusStore.getState().setStatus('exited');
        log.warn('ai', 'ACP agent unresponsive — process is dead');
      }
    } catch {
      // Can't determine status — assume exited
      useAgentStatusStore.getState().setStatus('exited');
    }
  }, []);

  // Recovery callback ref for the unresponsive timer
  const recoveryCallbackRef = useRef<(() => void) | null>(null);
  recoveryCallbackRef.current = checkAgentAndNotify;

  // Register the unresponsive callback so the timer can trigger recovery
  useEffect(() => {
    acpUnresponsiveMonitor.setOnUnresponsive(() => {
      log.warn('ai', `ACP agent unresponsive for ${UNRESPONSIVE_TIMEOUT_MS / 1000}s, checking status`);
      recoveryCallbackRef.current?.();
    });
    return () => {
      acpUnresponsiveMonitor.setOnUnresponsive(null);
      clearUnresponsiveTimer();
    };
  }, []);

  // Stop button escalation timer: 5s after cancel, if no response → SIGKILL + recovery
  const cancelEscalationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelEscalationListenerRef = useRef<(() => void) | null>(null);

  // Clean up cancel escalation timer and listener on unmount (Bug #2)
  useEffect(() => {
    return () => {
      if (cancelEscalationRef.current) {
        clearTimeout(cancelEscalationRef.current);
        cancelEscalationRef.current = null;
      }
      cancelEscalationListenerRef.current?.();
      cancelEscalationListenerRef.current = null;
    };
  }, []);

  // Respawn every live agent when the workspace folders change (the Seatbelt
  // sandbox scope is derived from the workspace); listen for agent process
  // death events.
  useAcpWorkspaceRespawn(cleanupRefs.current, setLoading, setActiveTool);
  useAcpAgentExitWatcher(cleanupRefs.current);

  // Eager session creation — spawn agent + create session as soon as chat is
  // opened with an ACP connection, so mode picker populates before first message.
  const { stopEagerListener } = useEagerAcpSession({ effectiveConnection, selectedProjectPaths, activeConversationId });

  /** Keep waiting for the agent — dismiss the banner and restart the timer. */
  const keepWaiting = useCallback(() => {
    useAgentStatusStore.getState().clearStatus();
    // Restart the timer — if agent goes quiet again, we'll check again
    startUnresponsiveTimer();
    log.info('ai', 'User chose to keep waiting for agent');
  }, []);

  // Store last prompt context for retry (populated at the start of acpSendChatMessage)
  const lastPromptRef = useRef<{
    content: string;
    assistantMessageId: number;
    /** Timestamp of the user message in the (re)sent pair — excluded from replayed history. */
    userTimestamp: number;
    /** Registry key of the conversation that owns this send (task #2). */
    conversationId?: string;
    attachedFilePaths?: string[];
    sandboxPaths?: string[];
    attachments?: ImageAttachment[];
    pathFilterRoots: string[];
    homeDir: string;
  } | null>(null);

  /**
   * Generate text via ACP agent (single-turn, auto-approve permissions).
   * Used for inline actions (Improve, Summarize, Expand).
   */
  const acpGenerateText = useCallback(
    async (prompt: string): Promise<string> => {
      if (!effectiveConnection) throw new Error('No ACP connection');
      return acpGenerateTextOnce(effectiveConnection, acpSystemMessage, selectedProjectPaths, prompt);
    },
    [effectiveConnection, acpSystemMessage, selectedProjectPaths]
  );

  /**
   * Send a chat message via ACP agent (multi-turn with permission handling).
   */
  const acpSendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[]; parentId?: string | null; attachments?: ImageAttachment[]; conversationId?: string }) => {
      if (!effectiveConnection) throw new Error('No ACP connection');

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      // Stamp the target connection on the user message so later resend/edit
      // actions in `FloatingCommandBar` can detect provider mismatch
      // (project-data-isolation task #10). See matching write in
      // useDirectApiChat.ts.
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: userTimestamp,
        displayContent: opts?.displayContent,
        skillName: opts?.skillName,
        attachments: opts?.attachments,
        ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}),
        connectionId: effectiveConnection.id,
      };
      addMessage(userMessage, opts?.conversationId);

      // The conversation this send belongs to — the registry key for its ACP
      // agent, the routing key for its listeners + run-state, and the owner of
      // every store write below.
      //
      // `opts.conversationId` is set when the concurrency cap deferred this send
      // (#468): it names the chat the message was typed in, which may no longer
      // be the active one. Otherwise fall back to the active conversation, read
      // AFTER `addMessage` because that call CREATES (and activates) the
      // conversation for a brand-new chat — reading before would be `undefined`
      // and strand the run as a phantom `running` (the listener/cleanup
      // `runIdle` would no-op on the null id). Mirrors direct-API + Copilot.
      const conversationId =
        opts?.conversationId ?? useChatStore.getState().activeConversationId ?? undefined;

      // Clean up any stale listeners from a previous streaming call IN THIS
      // conversation only (review #3) — a concurrent stream in another
      // conversation keeps its own listeners. Done after the id is known so we
      // target the right entry.
      runConvCleanup(cleanupRefs.current, conversationId);

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
        connectionId: effectiveConnection.id,
        connectionLabel: effectiveConnection.label,
        connectionProvider: effectiveConnection.provider,
      }, conversationId);

      // Mark the run active NOW (before the agent-spawn await below) so the
      // command bar shows "working" during a cold spawn; the instance id is
      // attached once `ensureAcpAgent` resolves.
      runStarted(conversationId, 'acp');

      // Sandbox scope: comment-sourced chats stick to the source project (`opts.sandboxPaths`);
      // regular chats use selected projects unless the user opted into cross-project mode.
      // The path filter mirrors the kernel sandbox so denials match what Seatbelt would block.
      const sandboxScope = opts?.sandboxPaths ?? getChatSandboxScope(
        { projectPaths: selectedProjectPaths },
        effectiveConnection,
        useSettingsStore.getState().crossProjectMode,
      );
      const pathFilterRoots = sandboxScope;
      const homeDir = await getHomeDir();
      // Active project for scoped auto-allow lookup (#6b). Use the first selected
      // project — multi-select edge cases (where the tool acts on a file in one of
      // several roots) are an open question; first-selected is a reasonable default.
      const activeProjectRoot = selectedProjectPaths[0] ?? null;

      const listenerDeps = {
        assistantMessageId,
        conversationId: conversationId ?? null,
        pathFilterRoots,
        homeDir,
        connectionId: effectiveConnection.id,
        activeProjectRoot,
        updateMessage,
        addMessage,
        setActiveTool,
        addActivity,
        completeLastActivity,
        completeAllActivities,
        setLastActivityApprovalMode,
        appendTextSegment,
        appendThinkingSegment,
        pushSegment,
        updateSegment,
        updateOrPushPlanSegment,
        finalizeSegments,
      };

      // Save context for retryWithRestore
      lastPromptRef.current = {
        content,
        assistantMessageId,
        userTimestamp,
        conversationId,
        attachedFilePaths: opts?.attachedFilePaths,
        sandboxPaths: opts?.sandboxPaths,
        attachments: opts?.attachments,
        pathFilterRoots,
        homeDir,
      };

      try {
        const cwd = selectedProjectPaths[0] || '/tmp';
        log.info('ai', `[send-chat] selectedProjectPaths=[${selectedProjectPaths.join('|')}] sandboxScope=[${sandboxScope.join('|')}] optsSandboxPaths=${opts?.sandboxPaths ? `[${opts.sandboxPaths.join('|')}]` : 'undef'}`);
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'send-chat', { conversationId });
        // The registry entry this send owns — non-null right after a successful ensure.
        const agent = getAcpAgent(conversationId)!;

        // Spawn resolved — attach the instance handle to the already-active run.
        runAttachInstance(conversationId, instanceId);

        // Block sending if a project switch is pending user decision — on THIS
        // conversation. `selectPendingProjectSwitch` reads the active one, which
        // for a cap-deferred send is whatever the user wandered off to read
        // (#468): that would both block this send on an unrelated prompt and
        // skip a real pending switch on its own conversation.
        const pendingSwitch = conversationId
          ? (useChatStore.getState().conversations.find((c) => c.id === conversationId)
              ?.pendingProjectSwitch ?? null)
          : selectPendingProjectSwitch(useChatStore.getState());
        if (pendingSwitch) {
          throw new Error('Please resolve the project context change before sending a message.');
        }

        // Use segment-based session tracking for context isolation. Scoped to
        // this conversation for the same reason as the pending-switch check.
        const segment = (() => {
          const st = useChatStore.getState();
          const c = st.conversations.find((x) => x.id === (conversationId ?? st.activeConversationId));
          return c?.segments[c.activeSegmentIndex];
        })();
        let isNewSession = false;

        // New conversation or new segment -> need a fresh ACP session
        if (messages.length === 0) {
          agent.chatSessionId = null;
        }
        // Segment has no session yet (new segment from project switch)
        if (segment && !segment.sessionId) {
          agent.chatSessionId = null;
        }

        if (!agent.chatSessionId) {
          const session = await startFreshChatSession(
            instanceId, cwd, agent, effectiveConnection, selectedProjectPaths, conversationId,
          );
          isNewSession = true;

          // Store session modes and config options for UI rendering
          log.info('ai', `ACP session modes: ${JSON.stringify(session.modes)}`);
          log.info('ai', `ACP session config_options: ${JSON.stringify(session.config_options)}`);
          await applyFreshSessionConfig(instanceId, session, effectiveConnection ?? null);
        }

        // Full chat listeners now take over — stop the eager listener
        stopEagerListener();

        // Session this turn prompts on — the listeners gate on it so a session
        // swap on the shared agent instance (or an overlapping send) can't
        // bleed another session's chunks into this message (finding #4a).
        const promptSessionId = resolveActiveSessionId(agent.chatSessionId, conversationId);
        await attachTurnListeners({
          cleanupMap: cleanupRefs.current,
          instanceId,
          sessionId: promptSessionId,
          assistantMessageId,
          conversationId,
          listenerDeps,
          resolveRunKey: () => conversationId,
          setLoading,
          setActiveTool,
          finalizeSegments,
          setMessageInterrupted,
        });

        try {
          // Prepend system prompt on the first message of a new session
          const effectiveSystemMessage = buildAcpSystemMessage
            ? buildAcpSystemMessage(opts?.attachedFilePaths)
            : acpSystemMessage;
          let promptContent: string;
          if (isNewSession) {
            // Build conversation history for context restoration after interruption.
            // Respect provider context isolation — when user chose "Start fresh",
            // only include messages from the segment boundary onward. Excludes the
            // pair currently being sent (this user message + its assistant placeholder).
            const historyBlock = buildAcpHistoryBlock(
              [assistantMessageId, userTimestamp],
              undefined,
              conversationId,
            );
            promptContent = `${effectiveSystemMessage}${historyBlock}\n\n${content}`;
          } else {
            promptContent = content;
          }
          // Start unresponsiveness detection timer before prompt
          startUnresponsiveTimer();
          const acpImages = opts?.attachments?.length
            ? opts.attachments.map(a => ({ data: a.data, mime_type: a.mimeType }))
            : null;
          // The stop reason is the only signal that separates "the agent
          // finished" from "the agent gave up partway" (token budget exhausted,
          // per-turn step cap hit). Surfacing it is what keeps a long multi-file
          // task from ending in silence with no indication it was unfinished.
          const stopReason = await invoke<string>('acp_session_prompt', {
            instanceId,
            sessionId: promptSessionId,
            content: promptContent,
            images: acpImages,
          });
          // How the turn finished, in aggregate. `ai_chat_sent` fires at send
          // and cannot know the outcome; this is the only signal for how often
          // agents actually run out of room in the field.
          trackTurnEnded(stopReason);
          const notice = formatStopReasonNotice(stopReason);
          if (notice) {
            log.warn('ai', 'ACP turn ended early', { stopReason, conversationId });
            appendTurnNotice(assistantMessageId, notice, conversationId);
          }
        } finally {
          clearUnresponsiveTimer();
          runConvCleanup(cleanupRefs.current, conversationId);
        }
      } catch (error) {
        clearUnresponsiveTimer();
        runConvCleanup(cleanupRefs.current, conversationId);

        const agentLabel = effectiveConnection?.label || effectiveConnection?.provider || 'the agent';

        // Auto-retry once on connection errors (dead agent, broken pipe, etc.)
        if (isAcpConnectionError(error)) {
          log.warn('ai', `ACP connection error, retrying with session restore: ${String(error)}`);
          try {
            await retryWithRestore();
            return;
          } catch (retryError) {
            log.error('ai', 'ACP retry with restore also failed', retryError);
            const failedAgent = getAcpAgent(conversationId);
            if (failedAgent) {
              usePermissionStore.getState().clearRequestsForInstance(failedAgent.instanceId);
            }
            setMessageError(assistantMessageId, friendlyAcpError(retryError, agentLabel), conversationId ?? null);
            setLoading(false);
            setActiveTool(null);
            runError(conversationId);
            return;
          }
        }

        // "Session not found" — stale session ID after recovery or reconnect.
        // Clear the session so the next message creates a fresh one; don't kill the agent.
        const errorStr = String(error).toLowerCase();
        if (errorStr.includes('session not found') || errorStr.includes('session_not_found')) {
          log.warn('ai', 'ACP session not found — clearing stale session ID');
          const staleAgent = getAcpAgent(conversationId);
          if (staleAgent) {
            staleAgent.chatSessionId = null;
          }
          setMessageError(assistantMessageId, 'Session expired. Please send your message again.', conversationId ?? null);
          setLoading(false);
          setActiveTool(null);
          runError(conversationId);
          return;
        }

        // Non-connection error — show friendly message, no retry
        const erroredAgent = getAcpAgent(conversationId);
        if (erroredAgent) {
          usePermissionStore.getState().clearRequestsForInstance(erroredAgent.instanceId);
        }
        stopAcpAgent(conversationId);
        log.error('ai', 'ACP chat error', error);
        setMessageError(assistantMessageId, friendlyAcpError(error, agentLabel), conversationId ?? null);
        runError(conversationId);

        // Offer an actionable Re-authenticate toast when the provider rejected
        // our token (401 / auth-failed). Tokens in keychain can go stale while
        // other Claude processes on the host refresh them; a single click here
        // opens Terminal with the agent's login command. Users can also hit
        // the key icon on the connection card in Settings → Connections.
        if (
          isAuthError(error) &&
          effectiveConnection?.credentials.type === 'agent_managed'
        ) {
          // Flip the connection to `expired` so the dot stops reading "healthy"
          // and the connection card surfaces its Re-authenticate affordance — the
          // only reliable "needs reauth" signal, since heartbeat/session-create
          // doesn't validate the OAuth token. A successful reauth (or heartbeat)
          // flips it back to `connected`.
          useConnectionsStore.getState().updateConnection(effectiveConnection.id, { status: 'expired' });
          const creds = effectiveConnection.credentials as { agentBinary: string };
          if (canReauthenticate(creds.agentBinary)) {
            toast.error(t("toast.authFailed", { agent: agentLabel }), {
              id: `reauth-${effectiveConnection.id}`,
              duration: 12000,
              action: {
                label: 'Re-authenticate',
                onClick: () => reauthenticateAgent(creds.agentBinary, agentLabel),
              },
            });
          }
        }

        setLoading(false);
        setActiveTool(null);
      }
    },
    [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, stopEagerListener, addMessage, updateMessage, setMessageError, setMessageInterrupted, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, setLastActivityApprovalMode, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, updateOrPushPlanSegment, finalizeSegments]
  );

  /**
   * Retry the last prompt by reconnecting the agent (session/load) and resending.
   * Reuses the existing assistant message — no branching.
   */
  const retryWithRestore = useCallback(async () => {
    const prompt = lastPromptRef.current;
    if (!prompt) {
      log.warn('ai', 'No prompt context available for retry');
      return;
    }
    // The retry targets the conversation that owned the failed send (task #2).
    const conversationId = prompt.conversationId;
    const agent = getAcpAgent(conversationId);
    if (!agent || !effectiveConnection) return;

    // Clear the banner
    useAgentStatusStore.getState().clearStatus();

    // Reset the existing assistant message (clear partial content/segments)
    resetAssistantMessage(prompt.assistantMessageId, conversationId ?? null);
    setLoading(true);
    setActiveTool(null);

    const sessionId = agent.chatSessionId;
    const oldInstanceId = agent.instanceId;
    const agentLabel = effectiveConnection.label || effectiveConnection.provider || 'the agent';

    try {
      // Try to reconnect with session/load (preserves agent-side conversation context)
      let instanceId: string;
      let isNewSession = false;
      // Path filter must mirror the kernel sandbox actually in effect for this attempt.
      // Reconnect-success keeps the original spawn's sandbox; fresh-session paths
      // recompute against the current selection.
      let pathFilterRoots: string[] = prompt.pathFilterRoots;
      const supportsLoad = hasLoadSessionCapability(agent.capabilities);

      if (supportsLoad && sessionId) {
        try {
          const result = await invoke<AcpSpawnResult>('acp_agent_reconnect', {
            instanceId: oldInstanceId,
            sessionId,
          });
          instanceId = result.instance_id;
          updateAcpAgentInstanceId(instanceId, conversationId);
          log.info('ai', `ACP retry: reconnected with session/load (new instance: ${instanceId})`);
        } catch (reconnectErr) {
          // session/load failed — fall back to fresh session
          log.warn('ai', `ACP retry: reconnect failed (${String(reconnectErr)}), using fresh session`);
          stopAcpAgent(conversationId);
          const cwd = selectedProjectPaths[0] || '/tmp';
          const sandboxScope = prompt.sandboxPaths ?? getChatSandboxScope(
            { projectPaths: selectedProjectPaths },
            effectiveConnection,
            useSettingsStore.getState().crossProjectMode,
          );
          instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'retry-reconnect-failed', { conversationId });
          pathFilterRoots = sandboxScope;
          isNewSession = true;
        }
      } else {
        // Agent doesn't support session/load — go directly to fresh session
        log.info('ai', 'ACP retry: agent does not support session/load, using fresh session');
        stopAcpAgent(conversationId);
        const cwd = selectedProjectPaths[0] || '/tmp';
        const sandboxScope = prompt.sandboxPaths ?? getChatSandboxScope(
          { projectPaths: selectedProjectPaths },
          effectiveConnection,
          useSettingsStore.getState().crossProjectMode,
        );
        instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'retry-no-load-support', { conversationId });
        pathFilterRoots = sandboxScope;
        isNewSession = true;
      }

      // Re-fetch the live registry entry — a fresh-session fallback above replaced
      // the old one, so `agent` may be stale; reconnect keeps the same object.
      const liveAgent = getAcpAgent(conversationId)!;

      // Re-mark the run active — the pre-retry cleanup cleared it (task #4).
      runStarted(conversationId ?? useChatStore.getState().activeConversationId ?? null, 'acp', { instanceId });

      const listenerDeps = {
        assistantMessageId: prompt.assistantMessageId,
        conversationId: conversationId ?? null,
        pathFilterRoots,
        homeDir: prompt.homeDir,
        connectionId: effectiveConnection.id,
        activeProjectRoot: selectedProjectPaths[0] ?? null,
        updateMessage,
        addMessage,
        setActiveTool,
        addActivity,
        completeLastActivity,
        completeAllActivities,
        setLastActivityApprovalMode,
        appendTextSegment,
        appendThinkingSegment,
        pushSegment,
        updateSegment,
        updateOrPushPlanSegment,
        finalizeSegments,
      };

      // Create new session if reconnect with session/load failed
      if (isNewSession) {
        const cwd = selectedProjectPaths[0] || '/tmp';
        const session = await startFreshChatSession(
          instanceId, cwd, liveAgent, effectiveConnection, selectedProjectPaths, conversationId,
        );
        await applyFreshSessionConfig(instanceId, session, effectiveConnection ?? null);
      }

      // Full chat listeners now take over — stop the eager listener
      stopEagerListener();

      // Session this retry prompts on — the listeners gate on it (finding #4a).
      const retrySessionId = resolveActiveSessionId(liveAgent.chatSessionId);
      await attachTurnListeners({
        cleanupMap: cleanupRefs.current,
        instanceId,
        sessionId: retrySessionId,
        assistantMessageId: prompt.assistantMessageId,
        conversationId,
        listenerDeps,
        resolveRunKey: () => conversationId ?? useChatStore.getState().activeConversationId ?? null,
        setLoading,
        setActiveTool,
        finalizeSegments,
        setMessageInterrupted,
      });

      // Resend the prompt
      const effectiveSystemMessage = buildAcpSystemMessage
        ? buildAcpSystemMessage(prompt.attachedFilePaths)
        : acpSystemMessage;
      // On a fresh-session fallback, replay prior conversation history so the
      // agent keeps context (otherwise a crash-retry "breaks" the conversation).
      // Exclude the retried pair (assistant message + its user message) by their
      // actual timestamps captured at send time.
      const promptContent = isNewSession
        ? `${effectiveSystemMessage}${buildAcpHistoryBlock([prompt.assistantMessageId, prompt.userTimestamp])}\n\n${prompt.content}`
        : prompt.content;

      try {
        startUnresponsiveTimer();
        const retryImages = prompt.attachments?.length
          ? prompt.attachments.map(a => ({ data: a.data, mime_type: a.mimeType }))
          : null;
        const stopReason = await invoke<string>('acp_session_prompt', {
          instanceId,
          sessionId: retrySessionId,
          content: promptContent,
          images: retryImages,
        });
        // Same early-stop surfacing as the initial send — a retried turn can
        // exhaust its budget just as easily, and silence would be just as wrong.
        trackTurnEnded(stopReason);
        const notice = formatStopReasonNotice(stopReason);
        if (notice) {
          log.warn('ai', 'ACP turn ended early after retry', { stopReason, conversationId });
          appendTurnNotice(prompt.assistantMessageId, notice, conversationId);
        }
      } finally {
        clearUnresponsiveTimer();
        runConvCleanup(cleanupRefs.current, conversationId);
      }
    } catch (error) {
      clearUnresponsiveTimer();
      runConvCleanup(cleanupRefs.current, conversationId);
      stopAcpAgent(conversationId);
      log.error('ai', 'ACP retry failed', error);
      setMessageError(prompt.assistantMessageId, friendlyAcpError(error, agentLabel), conversationId ?? null);
      setLoading(false);
      setActiveTool(null);
      runError(conversationId ?? useChatStore.getState().activeConversationId ?? null);
    }
  }, [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, stopEagerListener, updateMessage, addMessage, setMessageError, setMessageInterrupted, setLoading, setActiveTool, addActivity, completeLastActivity, completeAllActivities, setLastActivityApprovalMode, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, updateOrPushPlanSegment, finalizeSegments, resetAssistantMessage]);

  /**
   * Cancel an active ACP chat session.
   */
  const acpCancelChat = useCallback((targetConversationId?: string | null) => {
    // Cancel a SPECIFIC conversation (review #13) — defaults to the foreground
    // one. A single `cleanupRef` + active-only agent lookup meant cancelling
    // could only ever target the foreground turn (and could tear down a
    // background stream via the shared ref).
    const conversationId = targetConversationId ?? useChatStore.getState().activeConversationId ?? undefined;

    // Clear unresponsiveness timer
    clearUnresponsiveTimer();

    // Clean up THIS conversation's listeners, finalize segments, and mark its
    // message interrupted.
    runConvCleanup(cleanupRefs.current, conversationId, true);

    // Cancel ACP session if active — the cancelled conversation's agent.
    const agent = getAcpAgent(conversationId);
    if (agent?.chatSessionId && agent?.instanceId) {
      // Deny any pending permission requests before cancelling
      const pendingRequests = usePermissionStore.getState().requests.filter(
        (r) => r.instanceId === agent.instanceId
      );
      for (const req of pendingRequests) {
        invoke('acp_permission_respond', {
          instanceId: agent.instanceId,
          requestId: req.requestId,
          optionId: null,
        }).catch(() => {}); // Expected: fire-and-forget deny during cancel
      }
      usePermissionStore.getState().clearRequestsForInstance(agent.instanceId);

      const instanceId = agent.instanceId;
      invoke('acp_session_cancel', {
        instanceId,
        sessionId: agent.chatSessionId,
      }).catch(() => {}); // Expected: session may already be complete

      // Start 5-second escalation timer: if agent doesn't respond to cancel, treat as hung
      const CANCEL_ESCALATION_MS = 5_000;

      // Track whether the escalation is still active. If the timeout fires before
      // the listen() promise resolves, the .then() callback must call unlisten()
      // immediately to avoid leaking the listener.
      let cancelMounted = true;

      // Listen for successful cancel confirmation
      listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const { update } = event.payload;
        if (
          update.sessionUpdate === 'agent_turn_complete' ||
          (update.sessionUpdate === 'agent_message_chunk' && update.stopReason === 'cancelled')
        ) {
          // Cancel succeeded — clear escalation
          cancelMounted = false;
          if (cancelEscalationRef.current) {
            clearTimeout(cancelEscalationRef.current);
            cancelEscalationRef.current = null;
          }
          cancelEscalationListenerRef.current?.();
          cancelEscalationListenerRef.current = null;
        }
      }).then((unlisten) => {
        if (!cancelMounted) {
          // Escalation already resolved (timeout fired or cancel confirmed) —
          // clean up the listener immediately to prevent a leak.
          unlisten();
          return;
        }
        cancelEscalationListenerRef.current = unlisten;
      });

      cancelEscalationRef.current = setTimeout(() => {
        cancelEscalationRef.current = null;
        cancelMounted = false;
        cancelEscalationListenerRef.current?.();
        cancelEscalationListenerRef.current = null;
        log.warn('ai', 'ACP cancel escalation: agent did not respond within 5s');
        // Don't auto-recover — show banner so user can retry or restart manually
        useAgentStatusStore.getState().setStatus('unresponsive');
      }, CANCEL_ESCALATION_MS);

      // Clear the session so the next message creates a fresh one
      agent.chatSessionId = null;
    }

    // Clear the cancelled conversation's run even if no cleanup was registered
    // yet (cancel during the cold-spawn window, before listeners attach) — else
    // its run-state would stay `running`/`queued` forever (review #13).
    runIdle(conversationId);
    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  // Expose callbacks on the monitor so UI components can call them without
  // prop drilling (ChatMessageList's AgentStatusBanner wiring).
  acpUnresponsiveMonitor.setRetryCallback(retryWithRestore);
  acpUnresponsiveMonitor.setKeepWaitingCallback(keepWaiting);

  return { acpGenerateText, acpSendChatMessage, acpCancelChat, keepWaiting, retryWithRestore };
}
