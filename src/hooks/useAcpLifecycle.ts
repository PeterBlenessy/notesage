import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, selectProjectPaths, selectPendingProjectSwitch, getSessionIdForLeaf, sliceThreadBySegment } from '@/stores/chat-store';
import { getThreadResilient } from '@/lib/chat-tree';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage, ImageAttachment } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { setAgentModels } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { isAcpConnectionError, friendlyAcpError } from '@/lib/ai/errors';
import { isAuthError, canReauthenticate, reauthenticateAgent } from '@/lib/ai/reauth';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { AcpSessionResult, AcpSessionUpdatePayload, AcpPermissionRequestPayload } from '@/lib/ai/acp-utils';
import { restoreOrCreateAcpSession } from '@/lib/ai/acp-session-restore';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import { buildAttachmentActivities, getChatSandboxScope, hasLoadSessionCapability } from '@/lib/ai/acp-utils';
import { acpAgent, stopAcpAgent, ensureAcpAgent, updateAcpAgentInstanceId, setSessionModes, setSessionConfigOptions, updateCurrentMode, updateConfigOptionValue, setAvailableCommands, backfillAcpCapabilities, resolveConfiguredModeId } from '@/lib/ai/acp-agent-state';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';
import { useAgentStatusStore } from '@/stores/agent-status-store';

/**
 * Re-apply the conversation's remembered ACP permission mode (or, for a fresh
 * session, the connection default) to a newly created or restored session.
 *
 * A sandbox-scope change respawns the agent and creates a fresh session that
 * resets to the agent's own default mode (e.g. Claude Code → 'default' = Read
 * Only). Without this, the picker's mode silently reverts after the user picked
 * "Agent". The pick is persisted per-conversation (`chat-store.agentModeId`) and
 * re-asserted here so it survives every respawn. Must be called immediately after
 * `setSessionModes(session.modes)` at each session-creation site.
 *
 * @param restored True when `session` came from session/load|resume (it already
 *   carries the agent's remembered mode, so we don't impose the connection
 *   default — but an explicit per-conversation pick still wins).
 */
export function reapplySessionMode(
  instanceId: string,
  session: AcpSessionResult,
  connection: Connection | null,
  restored: boolean,
): void {
  if (!session.modes || !session.session_id) return;
  const state = useChatStore.getState();
  const convMode = state.conversations.find((c) => c.id === state.activeConversationId)?.agentModeId;
  // On restore, only an explicit per-conversation pick wins (don't impose the
  // connection default over the agent's restored mode); on a fresh session, fall
  // back to the connection default via the shared precedence resolver.
  const targetMode = restored ? convMode : resolveConfiguredModeId(convMode, connection);
  if (!targetMode || targetMode === session.modes.currentModeId) return;
  updateCurrentMode(targetMode);
  tauriApi.acpSessionSetMode(instanceId, session.session_id, targetMode).catch((err) => {
    log.debug('ai', `ACP re-apply mode failed: ${String(err)}`);
  });
}

/**
 * Apply the connection's configured model to a fresh ACP session.
 *
 * ACP 0.14 removed the dedicated `session/set_model` request; model selection is
 * a session config option with category `"model"`. Agents without such an option
 * have no model selector — skip silently (debug log), never fail the send.
 */
export async function applyConnectionModelOption(
  instanceId: string,
  session: AcpSessionResult,
  model: string | undefined,
): Promise<void> {
  if (!model || !session.session_id) return;
  const modelOption = session.config_options?.find((opt) => opt.category === 'model');
  if (!modelOption) {
    log.debug('ai', 'ACP model default skipped: agent reports no model-category config option');
    return;
  }
  try {
    await tauriApi.acpSessionSetConfigOption(instanceId, session.session_id, modelOption.id, model);
    updateConfigOptionValue(modelOption.id, model);
  } catch (err) {
    // Agent may reject an unknown model id — not fatal, proceed without it.
    log.debug('ai', `ACP set model config option failed: ${String(err)}`);
  }
}

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
 */
export function buildAcpHistoryBlock(excludeTimestamps: number[]): string {
  const store = useChatStore.getState();
  const conv = store.conversations.find((c) => c.id === store.activeConversationId);
  const segment = store.getActiveSegment();
  const baseThread: ChatMessage[] = conv
    ? getThreadResilient(conv.messages, conv.activeLeafId).thread
    : [];
  const allMessages = sliceThreadBySegment(baseThread, segment, conv?.messages ?? []);
  const exclude = new Set(excludeTimestamps);
  const priorMessages = allMessages.filter(
    (m) => (m.timestamp === undefined || !exclude.has(m.timestamp)) && m.role !== 'system-status' && m.content,
  );
  if (priorMessages.length === 0) return '';
  const lines = priorMessages.map((m) => {
    const prefix = m.role === 'user' ? 'User' : 'Assistant';
    const truncated = m.content.length > 2000 ? m.content.slice(0, 2000) + '\n... (truncated)' : m.content;
    const suffix = m.interrupted ? ' [interrupted]' : '';
    return `${prefix}${suffix}: ${truncated}`;
  });
  return `\n\n<conversation-history>\nThe following is the prior conversation in this session. The user may ask you to continue from where you left off.\n\n${lines.join('\n\n')}\n</conversation-history>`;
}

/**
 * Resolve the ACP session ID to use for the next prompt on the active conversation.
 *
 * Prefers a branch-specific session (attached after `session/fork` on a leaf-branch)
 * by walking the active leaf's ancestor chain; falls back to the conversation-level
 * session and finally to the agent's current chatSessionId.
 */
function resolveActiveSessionId(fallback: string | null): string | null {
  const state = useChatStore.getState();
  const conv = state.conversations.find((c) => c.id === state.activeConversationId);
  if (!conv) return fallback;
  return getSessionIdForLeaf(conv, conv.activeLeafId) ?? fallback;
}

// Re-export for backward compatibility
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';

// Lazy-resolved home directory for path filtering. Stable per OS session;
// memoised so the path-filter hot path doesn't await Tauri IPC every prompt.
let _homeDir: string | null = null;
async function getHomeDirCached(): Promise<string> {
  if (!_homeDir) {
    _homeDir = await tauriApi.getHomeDir();
  }
  return _homeDir;
}

/**
 * In-flight promise for the eager session-creation effect. React 18 strict mode
 * and store rehydration can each trigger the effect multiple times at startup;
 * without this lock all firings would race and create redundant ACP sessions.
 * Subsequent callers await the first one instead of duplicating the work.
 */
let eagerSessionPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Unresponsiveness detection timer (60s inactivity → recovery)
// ---------------------------------------------------------------------------

// 5 minutes — agents can have long gaps between events (thinking, web fetches,
// large file reads). The backend health check confirms aliveness; this timer
// only catches genuinely hung agents, not slow ones.
const UNRESPONSIVE_TIMEOUT_MS = 300_000;

/** Module-level timer ID so useAcpSessionListeners can reset it. */
let unresponsiveTimerId: ReturnType<typeof setTimeout> | null = null;

/** Callback to invoke when the timer fires. Set by the hook. */
let onUnresponsiveCallback: (() => void) | null = null;

/** Module-level retry callback — set by the hook, callable from UI components. */
let retryCallback: (() => Promise<void>) | null = null;
export function getRetryCallback(): (() => Promise<void>) | null {
  return retryCallback;
}

/** Module-level keep-waiting callback — set by the hook, callable from UI components. */
let keepWaitingCallback: (() => void) | null = null;
export function getKeepWaitingCallback(): (() => void) | null {
  return keepWaitingCallback;
}

/** Start (or restart) the unresponsiveness timer. */
export function startUnresponsiveTimer(): void {
  clearUnresponsiveTimer();
  if (!onUnresponsiveCallback) return;
  unresponsiveTimerId = setTimeout(() => {
    unresponsiveTimerId = null;
    onUnresponsiveCallback?.();
  }, UNRESPONSIVE_TIMEOUT_MS);
}

/** Reset the timer (called on every acp-session-update event). */
export function resetUnresponsiveTimer(): void {
  if (unresponsiveTimerId !== null) {
    startUnresponsiveTimer();
  }
}

/** Clear the timer (called on prompt completion, cancel, or unmount). */
export function clearUnresponsiveTimer(): void {
  if (unresponsiveTimerId !== null) {
    clearTimeout(unresponsiveTimerId);
    unresponsiveTimerId = null;
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
  const cleanupRef = useRef<(() => void) | null>(null);
  const eagerUnlistenRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Unresponsive agent detection — check if alive, then show banner
  // ---------------------------------------------------------------------------

  const checkAgentAndNotify = useCallback(async () => {
    if (!acpAgent) return;

    // Clean up listeners from the stuck prompt
    clearUnresponsiveTimer();
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    try {
      const alive = await invoke<boolean>('acp_is_agent_alive', {
        instanceId: acpAgent.instanceId,
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
    onUnresponsiveCallback = () => {
      log.warn('ai', `ACP agent unresponsive for ${UNRESPONSIVE_TIMEOUT_MS / 1000}s, checking status`);
      recoveryCallbackRef.current?.();
    };
    return () => {
      onUnresponsiveCallback = null;
      clearUnresponsiveTimer();
    };
  }, []);

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

  // Respawn agent when workspace folders change (sandbox paths need updating).
  //
  // Task #29: before tearing down the agent, gracefully cancel any in-flight
  // turn and drain pending permission requests. Without this, a stale
  // permission prompt can linger in the UI pointing at a session tied to a
  // dead agent — approving it races against the new agent's spawn and either
  // no-ops or hits the wrong instance. Ordering matters:
  //   1. Cancel the active ACP turn (tells the agent to stop streaming).
  //   2. Deny pending permissions for this instance (fire-and-forget; the
  //      store is then drained so the UI doesn't render dead cards).
  //   3. `stopAcpAgent()` — now the SIGTERM is the cleanup, not a mid-turn
  //      interrupt that dumps errors into the logs.
  const workspaceProjects = useWorkspaceStore((s) => s.projects);
  const workspaceExplorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const prevWorkspaceKeyRef = useRef('');
  useEffect(() => {
    const key = [
      ...workspaceProjects.map((p) => p.path),
      ...workspaceExplorerFolders.map((f) => f.path),
    ].sort().join('|');

    if (prevWorkspaceKeyRef.current && prevWorkspaceKeyRef.current !== key && acpAgent) {
      log.info('ai', 'Workspace folders changed — restarting agent for updated sandbox');

      const instanceId = acpAgent.instanceId;
      const sessionId = acpAgent.chatSessionId;
      const permStore = usePermissionStore.getState();
      const pendingForInstance = permStore.requests.filter((r) => r.instanceId === instanceId);
      const chatLoading = useChatStore.getState().isLoading;
      const turnActive = chatLoading || pendingForInstance.length > 0;

      if (turnActive) {
        // 1. Cancel the ACP turn if a session is active. Agent may be dying
        //    already — swallow rejections rather than throwing into React.
        if (sessionId) {
          invoke('acp_session_cancel', { instanceId, sessionId }).catch((err) => {
            log.warn('ai', `acp_session_cancel during workspace change failed: ${String(err)}`);
          });
        }

        // 2. Deny every pending permission waiter on this instance, then
        //    drain the store. `acp_permission_respond` resolves the agent-
        //    side future; `clearRequestsForInstance` drops the UI cards.
        for (const req of pendingForInstance) {
          invoke('acp_permission_respond', {
            instanceId,
            requestId: req.requestId,
            optionId: null,
          }).catch(() => {
            // Expected: fire-and-forget deny during context reset.
          });
        }
        permStore.clearRequestsForInstance(instanceId);

        // 3. Surface a toast so the user knows why the stream stopped. The
        //    stable id prevents duplicate toasts if two workspace changes
        //    fire back-to-back.
        toast.info('Context reset: workspace changed, previous turn cancelled', {
          id: 'acp-workspace-context-reset',
        });

        // Tear down any in-flight chat listeners and clear the loading flag
        // so the chat UI exits its streaming state cleanly.
        if (cleanupRef.current) {
          (cleanupRef.current as (cancelled?: boolean) => void)(true);
          cleanupRef.current = null;
        }
        clearUnresponsiveTimer();
        setLoading(false);
        setActiveTool(null);
      }

      stopAcpAgent();
    }
    prevWorkspaceKeyRef.current = key;
  }, [workspaceProjects, workspaceExplorerFolders, setLoading, setActiveTool]);

  // Listen for agent process death events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ instanceId: string; exitCode: number | null }>('acp-agent-exited', (event) => {
      if (!acpAgent || event.payload.instanceId !== acpAgent.instanceId) return;

      log.warn('ai', `ACP agent process exited (code: ${event.payload.exitCode})`);
      useAgentStatusStore.getState().setStatus('exited', event.payload.exitCode);

      // Clean up if we're mid-prompt
      clearUnresponsiveTimer();
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  // ---------------------------------------------------------------------------
  // Eager session creation — spawn agent + create session as soon as chat is
  // opened with an ACP connection, so mode picker populates before first message.
  // If the active conversation has a stored sessionId, try session/load first
  // to restore agent-side conversation context.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!effectiveConnection || effectiveConnection.authMethod !== 'agent_managed') return;

    // Look up the conversation we should be attached to.
    const targetConv = useChatStore.getState().conversations.find((c) => c.id === activeConversationId);
    const targetSessionId = targetConv?.acpSessionId;

    // Skip only when the agent is already attached to the right session. This lets
    // switching conversations re-trigger restoration for the new conversation's
    // stored session (otherwise a chat switch leaves the agent on the previous
    // conversation's session and prompts go to the wrong timeline).
    if (acpAgent?.chatSessionId && targetSessionId && acpAgent.chatSessionId === targetSessionId) return;
    // Brand-new conversations have no stored session — keep whatever session the
    // agent currently has; the prompt-send path creates a fresh one on first message.
    if (acpAgent?.chatSessionId && !targetSessionId) return;
    // Skip if another firing of this effect is already doing the work (React strict
    // mode + hydration state changes can fire this effect multiple times at startup;
    // without the lock, all firings race to create/resume redundantly).
    if (eagerSessionPromise) return;

    eagerSessionPromise = (async () => {
      try {
        // Wait for the persisted chat-store to rehydrate. The tauri-storage backend
        // is async, so the initial in-memory `conversations` array is empty — without
        // this gate, `storedSessionId` reads undefined and we never attempt resume/load.
        // See `docs/prds/2026-04-17-acp-session-lifecycle-completeness.md` for context.
        const persistApi = (useChatStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => () => void } }).persist;
        if (persistApi?.hasHydrated && !persistApi.hasHydrated()) {
          await new Promise<void>((resolve) => {
            const unsub = persistApi.onFinishHydration?.(() => { unsub?.(); resolve(); });
            // Safety net in case hydration has already completed between the check and the subscribe.
            if (persistApi.hasHydrated?.()) { unsub?.(); resolve(); }
          });
        }

        // Re-read project paths from the store after hydration — the `selectedProjectPaths`
        // closure value was captured when the effect dispatched (pre-hydration), and is
        // stale once the persist middleware populates `conversations`. Using the stale
        // value spawns the agent with an empty scope, which then triggers a respawn
        // later when any caller fires with the hydrated scope. Task #6d diagnostic.
        const freshPaths = selectProjectPaths(useChatStore.getState());
        const cwd = freshPaths[0] || '/tmp';
        const sandboxScope = getChatSandboxScope(
          { projectPaths: freshPaths },
          effectiveConnection,
          useSettingsStore.getState().crossProjectMode,
        );
        log.info('ai', `[eager] activeConversationId=${useChatStore.getState().activeConversationId} freshPaths=[${freshPaths.join('|')}] scope=[${sandboxScope.join('|')}] closurePaths=[${selectedProjectPaths.join('|')}]`);
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'eager');

        // Re-read the target session after the async hydration/spawn waits — the
        // active conversation may have changed while we were waiting.
        const conv = useChatStore.getState().conversations
          .find(c => c.id === useChatStore.getState().activeConversationId);
        const storedSessionId = conv?.acpSessionId;

        // If the agent is already attached to the right session, nothing to do.
        if (acpAgent?.chatSessionId && storedSessionId && acpAgent.chatSessionId === storedSessionId) return;
        // If the conversation has no stored session and the agent has any current session,
        // keep it — new chats shouldn't disturb the agent's current session.
        if (acpAgent?.chatSessionId && !storedSessionId) return;

        const session: AcpSessionResult = await restoreOrCreateAcpSession({
          instanceId,
          cwd,
          storedSessionId,
          capabilities: acpAgent?.capabilities,
          mcpServers: buildAcpMcpServerInputs(acpAgent?.capabilities, freshPaths),
        });

        if (!acpAgent) return;

        acpAgent.chatSessionId = session.session_id;
        useChatStore.getState().setSegmentSessionId(session.session_id);

        // Cache models
        if (session.available_models.length > 0 && effectiveConnection) {
          setAgentModels(
            effectiveConnection.id,
            session.available_models.map((m) => ({
              modelId: m.model_id,
              name: m.name,
              description: m.description,
            })),
            session.current_model,
          );
        }

        // Register a lightweight listener for init-time session notifications
        // (available_commands_update, session_info_update, etc.) that fire before
        // the full chat listeners are set up on first prompt.
        const eagerUnlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;
          if (update.sessionUpdate === 'available_commands_update') {
            const rawCommands = (update.availableCommands ?? update.available_commands) as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(rawCommands)) {
              const commands = rawCommands.map(cmd => ({
                name: String(cmd.name ?? ''),
                description: String(cmd.description ?? ''),
                inputHint: typeof cmd.inputHint === 'string' ? cmd.inputHint : undefined,
              }));
              setAvailableCommands(commands);
            }
          } else if (update.sessionUpdate === 'current_mode_update' && typeof update.currentModeId === 'string') {
            updateCurrentMode(update.currentModeId);
            // Persist agent-initiated mode changes too, so a later restore re-applies
            // the latest actual mode rather than a stale user pick.
            useChatStore.getState().setConversationMode(update.currentModeId);
          } else if (update.sessionUpdate === 'config_option_update') {
            const configId = update.optionId ?? update.option_id;
            const value = update.selectedValueId ?? update.selected_value_id ?? update.value;
            if (typeof configId === 'string' && typeof value === 'string') updateConfigOptionValue(configId, value);
          }
        });
        // Store unlisten so cleanup can call it
        const prevEagerUnlisten = eagerUnlistenRef.current;
        eagerUnlistenRef.current = eagerUnlisten;
        prevEagerUnlisten?.();

        // Populate mode picker and config options
        log.info('ai', `ACP eager session modes: ${JSON.stringify(session.modes)}`);
        setSessionModes(session.modes ?? null);
        setSessionConfigOptions(session.config_options ?? null);
        backfillAcpCapabilities(effectiveConnection?.id, session);

        // Re-apply the conversation's remembered mode (or, for fresh sessions, the
        // connection default). Listeners aren't active yet for the eager session, so
        // the optimistic local update inside the helper is what the picker reads.
        const restored = session.session_id === storedSessionId;
        reapplySessionMode(instanceId, session, effectiveConnection, restored);

        // Apply remaining configured defaults only for fresh sessions. A restoration hit
        // returns the agent's existing config — don't overwrite it.
        if (!restored) {
          const defaults = effectiveConnection.acpDefaults;
          if (defaults?.thinkingEffort && session.session_id) {
            updateConfigOptionValue('reasoning_effort', defaults.thinkingEffort);
            tauriApi.acpSessionSetConfigOption(instanceId, session.session_id, 'reasoning_effort', defaults.thinkingEffort).catch(() => {});
          }
          void applyConnectionModelOption(instanceId, session, effectiveConnection.config?.model);
        }
      } catch (err) {
        log.debug('ai', `ACP eager session creation failed (non-fatal): ${String(err)}`);
      }
    })().finally(() => {
      eagerSessionPromise = null;
    });

    return () => {
      // Tear down the init-time session listener. Safe to call on strict-mode
      // re-mount cleanups too: the ref is re-populated when the first firing
      // finishes attaching the listener (only one firing runs thanks to the lock).
      eagerUnlistenRef.current?.();
      eagerUnlistenRef.current = null;
    };
  }, [effectiveConnection, selectedProjectPaths, activeConversationId]);

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

      const attemptGenerate = async (): Promise<string> => {
        const cwd = selectedProjectPaths[0] || '/tmp';
        const inlineSandboxPaths = cwd !== '/tmp' ? [cwd] : [];
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, inlineSandboxPaths, 'inline');

        const session = await invoke<AcpSessionResult>('acp_session_new', {
          instanceId,
          workingDirectory: cwd,
          mcpServers: buildAcpMcpServerInputs(acpAgent?.capabilities, selectedProjectPaths),
        });

        let result = '';
        const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;
          const chunkContent = Array.isArray(update.content) ? undefined : update.content;
          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            chunkContent?.type === 'text' &&
            chunkContent.text
          ) {
            result += chunkContent.text;
          }
        });

        const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const payload = event.payload;
          let firstOptionId: string | null = null;
          if (Array.isArray(payload.options) && payload.options.length > 0) {
            const opt = payload.options[0] as Record<string, unknown>;
            firstOptionId = typeof opt === 'string' ? opt : String(opt?.id ?? '');
          }
          invoke('acp_permission_respond', {
            instanceId,
            requestId: payload.requestId,
            optionId: firstOptionId,
          }).catch(() => {}); // Expected: fire-and-forget permission response, agent may have exited
        });

        try {
          const fullPrompt = `${acpSystemMessage}\n\n${prompt}`;
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: session.session_id,
            content: fullPrompt,
          });
          return result;
        } finally {
          unlisten();
          unlistenPermission();
        }
      };

      try {
        return await attemptGenerate();
      } catch (error) {
        if (isAcpConnectionError(error)) {
          log.warn('ai', `ACP inline action connection error, retrying: ${String(error)}`);
          stopAcpAgent();
          try {
            return await attemptGenerate();
          } catch (retryError) {
            stopAcpAgent();
            log.error('ai', 'ACP inline action retry also failed', retryError);
            throw new Error(friendlyAcpError(retryError, effectiveConnection?.label || effectiveConnection?.provider));
          }
        }
        stopAcpAgent();
        log.error('ai', 'ACP inline action error', error);
        throw new Error(friendlyAcpError(error, effectiveConnection?.label || effectiveConnection?.provider));
      }
    },
    [effectiveConnection, acpSystemMessage, selectedProjectPaths]
  );

  /**
   * Send a chat message via ACP agent (multi-turn with permission handling).
   */
  const acpSendChatMessage = useCallback(
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[]; parentId?: string | null; attachments?: ImageAttachment[] }) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

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
      addMessage(userMessage);
      // Task #30 — log every file-path attachment on the user message so the
      // user has a visible trail of what was shipped to the provider. Image
      // byte attachments are visible as thumbnails already (intentionally not
      // logged here).
      for (const activity of buildAttachmentActivities(opts?.attachedFilePaths, userTimestamp)) {
        addActivity(userTimestamp, activity);
      }
      const assistantMessageId = userTimestamp + 1;
      addMessage({
        role: 'assistant',
        content: '',
        timestamp: assistantMessageId,
        connectionId: effectiveConnection.id,
        connectionLabel: effectiveConnection.label,
        connectionProvider: effectiveConnection.provider,
      });

      // Sandbox scope: comment-sourced chats stick to the source project (`opts.sandboxPaths`);
      // regular chats use selected projects unless the user opted into cross-project mode.
      // The path filter mirrors the kernel sandbox so denials match what Seatbelt would block.
      const sandboxScope = opts?.sandboxPaths ?? getChatSandboxScope(
        { projectPaths: selectedProjectPaths },
        effectiveConnection,
        useSettingsStore.getState().crossProjectMode,
      );
      const pathFilterRoots = sandboxScope;
      const homeDir = await getHomeDirCached();
      // Active project for scoped auto-allow lookup (#6b). Use the first selected
      // project — multi-select edge cases (where the tool acts on a file in one of
      // several roots) are an open question; first-selected is a reasonable default.
      const activeProjectRoot = selectedProjectPaths[0] ?? null;

      const listenerDeps = {
        assistantMessageId,
        conversationId: useChatStore.getState().activeConversationId,
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
        attachedFilePaths: opts?.attachedFilePaths,
        sandboxPaths: opts?.sandboxPaths,
        attachments: opts?.attachments,
        pathFilterRoots,
        homeDir,
      };

      try {
        const cwd = selectedProjectPaths[0] || '/tmp';
        log.info('ai', `[send-chat] selectedProjectPaths=[${selectedProjectPaths.join('|')}] sandboxScope=[${sandboxScope.join('|')}] optsSandboxPaths=${opts?.sandboxPaths ? `[${opts.sandboxPaths.join('|')}]` : 'undef'}`);
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'send-chat');

        // Block sending if a project switch is pending user decision
        const pendingSwitch = selectPendingProjectSwitch(useChatStore.getState());
        if (pendingSwitch) {
          throw new Error('Please resolve the project context change before sending a message.');
        }

        // Use segment-based session tracking for context isolation
        const segment = useChatStore.getState().getActiveSegment();
        let isNewSession = false;

        // New conversation or new segment -> need a fresh ACP session
        if (messages.length === 0 && acpAgent) {
          acpAgent.chatSessionId = null;
        }
        // Segment has no session yet (new segment from project switch)
        if (segment && !segment.sessionId) {
          acpAgent!.chatSessionId = null;
        }

        if (!acpAgent!.chatSessionId) {
          const session = await invoke<AcpSessionResult>('acp_session_new', {
            instanceId,
            workingDirectory: cwd,
            mcpServers: buildAcpMcpServerInputs(acpAgent!.capabilities, selectedProjectPaths),
          });
          acpAgent!.chatSessionId = session.session_id;
          isNewSession = true;

          // Track session in the segment
          useChatStore.getState().setSegmentSessionId(session.session_id);

          // Cache available models from the agent for the config dialog
          if (session.available_models.length > 0 && effectiveConnection) {
            setAgentModels(
              effectiveConnection.id,
              session.available_models.map((m) => ({
                modelId: m.model_id,
                name: m.name,
                description: m.description,
              })),
              session.current_model,
            );
          }

          // Store session modes and config options for UI rendering
          log.info('ai', `ACP session modes: ${JSON.stringify(session.modes)}`);
          log.info('ai', `ACP session config_options: ${JSON.stringify(session.config_options)}`);
          setSessionModes(session.modes ?? null);
          setSessionConfigOptions(session.config_options ?? null);
          backfillAcpCapabilities(effectiveConnection?.id, session);
          // Fresh session (respawn on scope change / new conversation / new segment)
          // resets to the agent default — re-assert the conversation's remembered mode.
          reapplySessionMode(instanceId, session, effectiveConnection ?? null, false);

          // Set model via the model-category config option (replaces CLI arg injection)
          await applyConnectionModelOption(instanceId, session, effectiveConnection?.config?.model);
        }

        // Full chat listeners now take over — stop the eager listener
        eagerUnlistenRef.current?.();
        eagerUnlistenRef.current = null;

        const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
        cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, assistantMessageId, cleanupRef, setLoading, setActiveTool, finalizeSegments, setMessageInterrupted);

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
            const historyBlock = buildAcpHistoryBlock([assistantMessageId, userTimestamp]);
            promptContent = `${effectiveSystemMessage}${historyBlock}\n\n${content}`;
          } else {
            promptContent = content;
          }
          // Start unresponsiveness detection timer before prompt
          startUnresponsiveTimer();
          const acpImages = opts?.attachments?.length
            ? opts.attachments.map(a => ({ data: a.data, mime_type: a.mimeType }))
            : null;
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: resolveActiveSessionId(acpAgent!.chatSessionId),
            content: promptContent,
            images: acpImages,
          });
        } finally {
          clearUnresponsiveTimer();
          if (cleanupRef.current) {
            cleanupRef.current();
          }
        }
      } catch (error) {
        clearUnresponsiveTimer();
        if (cleanupRef.current) {
          cleanupRef.current();
        }

        const agentLabel = effectiveConnection?.label || effectiveConnection?.provider || 'the agent';

        // Auto-retry once on connection errors (dead agent, broken pipe, etc.)
        if (isAcpConnectionError(error)) {
          log.warn('ai', `ACP connection error, retrying with session restore: ${String(error)}`);
          try {
            await retryWithRestore();
            return;
          } catch (retryError) {
            log.error('ai', 'ACP retry with restore also failed', retryError);
            if (acpAgent) {
              usePermissionStore.getState().clearRequestsForInstance(acpAgent.instanceId);
            }
            setMessageError(assistantMessageId, friendlyAcpError(retryError, agentLabel));
            setLoading(false);
            setActiveTool(null);
            return;
          }
        }

        // "Session not found" — stale session ID after recovery or reconnect.
        // Clear the session so the next message creates a fresh one; don't kill the agent.
        const errorStr = String(error).toLowerCase();
        if (errorStr.includes('session not found') || errorStr.includes('session_not_found')) {
          log.warn('ai', 'ACP session not found — clearing stale session ID');
          if (acpAgent) {
            acpAgent.chatSessionId = null;
          }
          setMessageError(assistantMessageId, 'Session expired. Please send your message again.');
          setLoading(false);
          setActiveTool(null);
          return;
        }

        // Non-connection error — show friendly message, no retry
        if (acpAgent) {
          usePermissionStore.getState().clearRequestsForInstance(acpAgent.instanceId);
        }
        stopAcpAgent();
        log.error('ai', 'ACP chat error', error);
        setMessageError(assistantMessageId, friendlyAcpError(error, agentLabel));

        // Offer an actionable Re-authenticate toast when the provider rejected
        // our token (401 / auth-failed). Tokens in keychain can go stale while
        // other Claude processes on the host refresh them; a single click here
        // opens Terminal with the agent's login command. Users can also hit
        // the key icon on the connection card in Settings → Connections.
        if (
          isAuthError(error) &&
          effectiveConnection?.credentials.type === 'agent_managed'
        ) {
          const creds = effectiveConnection.credentials as { agentBinary: string };
          if (canReauthenticate(creds.agentBinary)) {
            toast.error(`Authentication failed for ${agentLabel}`, {
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
    [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, addMessage, updateMessage, setMessageError, setMessageInterrupted, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, setLastActivityApprovalMode, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, updateOrPushPlanSegment, finalizeSegments]
  );

  /**
   * Retry the last prompt by reconnecting the agent (session/load) and resending.
   * Reuses the existing assistant message — no branching.
   */
  const retryWithRestore = useCallback(async () => {
    if (!acpAgent || !effectiveConnection) return;
    const prompt = lastPromptRef.current;
    if (!prompt) {
      log.warn('ai', 'No prompt context available for retry');
      return;
    }

    // Clear the banner
    useAgentStatusStore.getState().clearStatus();

    // Reset the existing assistant message (clear partial content/segments)
    resetAssistantMessage(prompt.assistantMessageId);
    setLoading(true);
    setActiveTool(null);

    const sessionId = acpAgent.chatSessionId;
    const oldInstanceId = acpAgent.instanceId;
    const agentLabel = effectiveConnection.label || effectiveConnection.provider || 'the agent';

    try {
      // Try to reconnect with session/load (preserves agent-side conversation context)
      let instanceId: string;
      let isNewSession = false;
      // Path filter must mirror the kernel sandbox actually in effect for this attempt.
      // Reconnect-success keeps the original spawn's sandbox; fresh-session paths
      // recompute against the current selection.
      let pathFilterRoots: string[] = prompt.pathFilterRoots;
      const supportsLoad = hasLoadSessionCapability(acpAgent?.capabilities);

      if (supportsLoad && sessionId) {
        try {
          const result = await invoke<{ instance_id: string }>('acp_agent_reconnect', {
            instanceId: oldInstanceId,
            sessionId,
          });
          instanceId = result.instance_id;
          updateAcpAgentInstanceId(instanceId);
          log.info('ai', `ACP retry: reconnected with session/load (new instance: ${instanceId})`);
        } catch (reconnectErr) {
          // session/load failed — fall back to fresh session
          log.warn('ai', `ACP retry: reconnect failed (${String(reconnectErr)}), using fresh session`);
          stopAcpAgent();
          const cwd = selectedProjectPaths[0] || '/tmp';
          const sandboxScope = prompt.sandboxPaths ?? getChatSandboxScope(
            { projectPaths: selectedProjectPaths },
            effectiveConnection,
            useSettingsStore.getState().crossProjectMode,
          );
          instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'retry-reconnect-failed');
          pathFilterRoots = sandboxScope;
          isNewSession = true;
        }
      } else {
        // Agent doesn't support session/load — go directly to fresh session
        log.info('ai', 'ACP retry: agent does not support session/load, using fresh session');
        stopAcpAgent();
        const cwd = selectedProjectPaths[0] || '/tmp';
        const sandboxScope = prompt.sandboxPaths ?? getChatSandboxScope(
          { projectPaths: selectedProjectPaths },
          effectiveConnection,
          useSettingsStore.getState().crossProjectMode,
        );
        instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope, 'retry-no-load-support');
        pathFilterRoots = sandboxScope;
        isNewSession = true;
      }

      const listenerDeps = {
        assistantMessageId: prompt.assistantMessageId,
        conversationId: useChatStore.getState().activeConversationId,
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
        const session = await invoke<AcpSessionResult>('acp_session_new', {
          instanceId,
          workingDirectory: cwd,
          mcpServers: buildAcpMcpServerInputs(acpAgent!.capabilities, selectedProjectPaths),
        });
        acpAgent!.chatSessionId = session.session_id;
        useChatStore.getState().setSegmentSessionId(session.session_id);

        if (session.available_models.length > 0 && effectiveConnection) {
          setAgentModels(
            effectiveConnection.id,
            session.available_models.map((m) => ({
              modelId: m.model_id,
              name: m.name,
              description: m.description,
            })),
            session.current_model,
          );
        }

        // Store session modes and config options for UI rendering
        setSessionModes(session.modes ?? null);
        setSessionConfigOptions(session.config_options ?? null);
        backfillAcpCapabilities(effectiveConnection?.id, session);
        // Fresh session on reconnect — re-assert the conversation's remembered mode.
        reapplySessionMode(instanceId, session, effectiveConnection ?? null, false);

        // Set model via the model-category config option
        await applyConnectionModelOption(instanceId, session, effectiveConnection?.config?.model);
      }

      // Full chat listeners now take over — stop the eager listener
      eagerUnlistenRef.current?.();
      eagerUnlistenRef.current = null;

      // Set up listeners
      const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
      cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, prompt.assistantMessageId, cleanupRef, setLoading, setActiveTool, finalizeSegments, setMessageInterrupted);

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
        await invoke('acp_session_prompt', {
          instanceId,
          sessionId: resolveActiveSessionId(acpAgent!.chatSessionId),
          content: promptContent,
          images: retryImages,
        });
      } finally {
        clearUnresponsiveTimer();
        if (cleanupRef.current) {
          cleanupRef.current();
        }
      }
    } catch (error) {
      clearUnresponsiveTimer();
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      stopAcpAgent();
      log.error('ai', 'ACP retry failed', error);
      setMessageError(prompt.assistantMessageId, friendlyAcpError(error, agentLabel));
      setLoading(false);
      setActiveTool(null);
    }
  }, [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, updateMessage, addMessage, setMessageError, setMessageInterrupted, setLoading, setActiveTool, addActivity, completeLastActivity, completeAllActivities, setLastActivityApprovalMode, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, updateOrPushPlanSegment, finalizeSegments, resetAssistantMessage]);

  /**
   * Cancel an active ACP chat session.
   */
  // Stop button escalation timer: 5s after cancel, if no response → SIGKILL + recovery
  const cancelEscalationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelEscalationListenerRef = useRef<(() => void) | null>(null);

  const acpCancelChat = useCallback(() => {
    // Clear unresponsiveness timer
    clearUnresponsiveTimer();

    // Clean up listeners, finalize segments, and mark message as interrupted
    if (cleanupRef.current) {
      (cleanupRef.current as (cancelled?: boolean) => void)(true);
    }

    // Cancel ACP session if active
    if (acpAgent?.chatSessionId && acpAgent?.instanceId) {
      // Deny any pending permission requests before cancelling
      const pendingRequests = usePermissionStore.getState().requests.filter(
        (r) => r.instanceId === acpAgent!.instanceId
      );
      for (const req of pendingRequests) {
        invoke('acp_permission_respond', {
          instanceId: acpAgent!.instanceId,
          requestId: req.requestId,
          optionId: null,
        }).catch(() => {}); // Expected: fire-and-forget deny during cancel
      }
      usePermissionStore.getState().clearRequestsForInstance(acpAgent!.instanceId);

      const instanceId = acpAgent.instanceId;
      invoke('acp_session_cancel', {
        instanceId,
        sessionId: acpAgent.chatSessionId,
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
      acpAgent.chatSessionId = null;
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  // Expose callbacks at module level so UI components can call them without prop drilling
  retryCallback = retryWithRestore;
  keepWaitingCallback = keepWaiting;

  return { acpGenerateText, acpSendChatMessage, acpCancelChat, keepWaiting, retryWithRestore };
}
