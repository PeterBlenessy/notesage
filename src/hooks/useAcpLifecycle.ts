import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, selectProjectPaths, selectPendingProjectSwitch } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage, ImageAttachment } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { setAgentModels } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { isAcpConnectionError, friendlyAcpError } from '@/lib/ai/errors';
import { tauriApi } from '@/lib/tauri';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AcpSessionResult, AcpSessionUpdatePayload, AcpPermissionRequestPayload } from '@/lib/ai/acp-utils';
import { getAllWorkspacePaths } from '@/lib/ai/acp-utils';
import { acpAgent, stopAcpAgent, ensureAcpAgent, updateAcpAgentInstanceId, setSessionModes, setSessionConfigOptions, updateCurrentMode, updateConfigOptionValue } from '@/lib/ai/acp-agent-state';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';
import { useAgentStatusStore } from '@/stores/agent-status-store';

// Re-export for backward compatibility
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';

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
  const { addMessage, updateMessage, setMessageError, setMessageInterrupted, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, finalizeSegments, resetAssistantMessage } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

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

  // Respawn agent when workspace folders change (sandbox paths need updating)
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
      stopAcpAgent();
    }
    prevWorkspaceKeyRef.current = key;
  }, [workspaceProjects, workspaceExplorerFolders]);

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
    // Skip if a session already exists or a prompt is in progress
    if (acpAgent?.chatSessionId) return;

    let cancelled = false;
    (async () => {
      try {
        const cwd = selectedProjectPaths[0] || '/tmp';
        const sandboxScope = getAllWorkspacePaths();
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope);
        if (cancelled) return;

        // Only create session if one doesn't exist yet (another send may have raced)
        if (acpAgent?.chatSessionId) return;

        // Check if the active conversation has a stored session ID for restoration
        const conv = useChatStore.getState().conversations
          .find(c => c.id === useChatStore.getState().activeConversationId);
        const storedSessionId = conv?.acpSessionId;
        const supportsLoad = acpAgent?.capabilities?.load_session === true;

        let session: AcpSessionResult;

        if (storedSessionId && supportsLoad) {
          // Try to restore the existing session (preserves agent-side conversation history)
          try {
            session = await invoke<AcpSessionResult>('acp_session_load', {
              instanceId,
              sessionId: storedSessionId,
              workingDirectory: cwd,
            });
            log.info('ai', `ACP session restored via session/load (${storedSessionId})`);
          } catch (loadErr) {
            // session/load failed — fall back to new session
            log.info('ai', `ACP session/load failed, creating new session: ${String(loadErr)}`);
            session = await invoke<AcpSessionResult>('acp_session_new', {
              instanceId,
              workingDirectory: cwd,
            });
          }
        } else {
          session = await invoke<AcpSessionResult>('acp_session_new', {
            instanceId,
            workingDirectory: cwd,
          });
        }

        if (cancelled || !acpAgent) return;

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

        // Populate mode picker and config options
        log.info('ai', `ACP eager session modes: ${JSON.stringify(session.modes)}`);
        setSessionModes(session.modes ?? null);
        setSessionConfigOptions(session.config_options ?? null);

        // Apply user's configured defaults (only for new sessions, not restored ones)
        if (!storedSessionId || !supportsLoad) {
          const defaults = effectiveConnection.acpDefaults;
          if (defaults?.modeId && session.modes && session.session_id) {
            // Optimistically update local state (listeners aren't active yet for eager session)
            updateCurrentMode(defaults.modeId);
            tauriApi.acpSessionSetMode(instanceId, session.session_id, defaults.modeId).catch(() => {});
          }
          if (defaults?.thinkingEffort && session.session_id) {
            updateConfigOptionValue('reasoning_effort', defaults.thinkingEffort);
            tauriApi.acpSessionSetConfigOption(instanceId, session.session_id, 'reasoning_effort', defaults.thinkingEffort).catch(() => {});
          }
          if (effectiveConnection.config?.model && session.session_id) {
            tauriApi.acpSessionSetModel(instanceId, session.session_id, effectiveConnection.config.model).catch((err) => {
              log.debug('ai', `ACP eager set_model failed: ${String(err)}`);
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          log.debug('ai', `ACP eager session creation failed (non-fatal): ${String(err)}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [effectiveConnection, selectedProjectPaths]);

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
    attachedFilePaths?: string[];
    sandboxPaths?: string[];
    attachments?: ImageAttachment[];
    pathFilterRoot: string | null;
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
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, inlineSandboxPaths);

        const session = await invoke<AcpSessionResult>('acp_session_new', {
          instanceId,
          workingDirectory: cwd,
        });

        let result = '';
        const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
          if (event.payload.instanceId !== instanceId) return;
          const { update } = event.payload;
          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content?.type === 'text' &&
            update.content.text
          ) {
            result += update.content.text;
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
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp, displayContent: opts?.displayContent, skillName: opts?.skillName, attachments: opts?.attachments, ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}) };
      addMessage(userMessage);
      const assistantMessageId = userTimestamp + 1;
      addMessage({
        role: 'assistant',
        content: '',
        timestamp: assistantMessageId,
        connectionId: effectiveConnection.id,
        connectionLabel: effectiveConnection.label,
        connectionProvider: effectiveConnection.provider,
      });

      // Path filtering: resolve once, available in both try and catch (retry) blocks
      const pathFilterRoot = opts?.sandboxPaths ? (selectedProjectPaths[0] || null) : null;
      const homeDir = pathFilterRoot ? await tauriApi.getHomeDir() : '';

      const listenerDeps = {
        assistantMessageId,
        conversationId: useChatStore.getState().activeConversationId,
        pathFilterRoot,
        homeDir,
        updateMessage,
        addMessage,
        setActiveTool,
        addActivity,
        completeLastActivity,
        completeAllActivities,
        appendTextSegment,
        appendThinkingSegment,
        pushSegment,
        updateSegment,
        finalizeSegments,
      };

      // Save context for retryWithRestore
      lastPromptRef.current = {
        content,
        assistantMessageId,
        attachedFilePaths: opts?.attachedFilePaths,
        sandboxPaths: opts?.sandboxPaths,
        attachments: opts?.attachments,
        pathFilterRoot,
        homeDir,
      };

      try {
        const cwd = selectedProjectPaths[0] || '/tmp';
        // Comment-sourced chats: scope to source project only. Regular chats: all workspace folders.
        const sandboxScope = opts?.sandboxPaths ?? getAllWorkspacePaths();
        const instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope);

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

          // Set model via ACP-native mechanism (replaces CLI arg injection)
          if (effectiveConnection?.config?.model && session.session_id) {
            try {
              await tauriApi.acpSessionSetModel(instanceId, session.session_id, effectiveConnection.config.model);
            } catch (modelErr) {
              // Agent may not support set_model — not fatal, proceed without it
              log.debug('ai', `ACP set_model failed (agent may not support it): ${String(modelErr)}`);
            }
          }
        }

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
            // only include messages from the segment boundary onward.
            const conv = useChatStore.getState().conversations
              .find(c => c.id === useChatStore.getState().activeConversationId);
            const segment = useChatStore.getState().getActiveSegment();
            let allMessages = conv?.messages ?? [];
            if (segment && !segment.historyIncluded && segment.startMessageIndex > 0) {
              const dropCount = Math.min(segment.startMessageIndex, allMessages.length);
              allMessages = allMessages.slice(dropCount);
            }
            const priorMessages = allMessages.filter(
              (m) => m.timestamp !== assistantMessageId && m.timestamp !== userTimestamp
                && m.role !== 'system-status' && m.content
            );
            let historyBlock = '';
            if (priorMessages.length > 0) {
              const lines = priorMessages.map((m) => {
                const prefix = m.role === 'user' ? 'User' : 'Assistant';
                const truncated = m.content.length > 2000
                  ? m.content.slice(0, 2000) + '\n... (truncated)'
                  : m.content;
                const suffix = m.interrupted ? ' [interrupted]' : '';
                return `${prefix}${suffix}: ${truncated}`;
              });
              historyBlock = `\n\n<conversation-history>\nThe following is the prior conversation in this session. The user may ask you to continue from where you left off.\n\n${lines.join('\n\n')}\n</conversation-history>`;
            }
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
            sessionId: acpAgent!.chatSessionId,
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
        setLoading(false);
        setActiveTool(null);
      }
    },
    [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, addMessage, updateMessage, setMessageError, setMessageInterrupted, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, finalizeSegments]
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

    const listenerDeps = {
      assistantMessageId: prompt.assistantMessageId,
      conversationId: useChatStore.getState().activeConversationId,
      pathFilterRoot: prompt.pathFilterRoot,
      homeDir: prompt.homeDir,
      updateMessage,
      addMessage,
      setActiveTool,
      addActivity,
      completeLastActivity,
      completeAllActivities,
      appendTextSegment,
      appendThinkingSegment,
      pushSegment,
      updateSegment,
      finalizeSegments,
    };

    try {
      // Try to reconnect with session/load (preserves agent-side conversation context)
      let instanceId: string;
      let isNewSession = false;

      try {
        const result = await invoke<{ instance_id: string }>('acp_agent_reconnect', {
          instanceId: oldInstanceId,
          sessionId: sessionId ?? '',
        });
        instanceId = result.instance_id;
        updateAcpAgentInstanceId(instanceId);
        log.info('ai', `ACP retry: reconnected with session/load (new instance: ${instanceId})`);
      } catch (reconnectErr) {
        // session/load failed — fall back to fresh session
        log.warn('ai', `ACP retry: reconnect failed (${String(reconnectErr)}), using fresh session`);
        stopAcpAgent();
        const cwd = selectedProjectPaths[0] || '/tmp';
        const sandboxScope = prompt.sandboxPaths ?? getAllWorkspacePaths();
        instanceId = await ensureAcpAgent(effectiveConnection, cwd, sandboxScope);
        isNewSession = true;
      }

      // Create new session if reconnect with session/load failed
      if (isNewSession) {
        const cwd = selectedProjectPaths[0] || '/tmp';
        const session = await invoke<AcpSessionResult>('acp_session_new', {
          instanceId,
          workingDirectory: cwd,
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

        // Set model via ACP-native mechanism
        if (effectiveConnection?.config?.model && session.session_id) {
          try {
            await tauriApi.acpSessionSetModel(instanceId, session.session_id, effectiveConnection.config.model);
          } catch (modelErr) {
            log.debug('ai', `ACP set_model failed on retry: ${String(modelErr)}`);
          }
        }
      }

      // Set up listeners
      const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
      cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, prompt.assistantMessageId, cleanupRef, setLoading, setActiveTool, finalizeSegments, setMessageInterrupted);

      // Resend the prompt
      const effectiveSystemMessage = buildAcpSystemMessage
        ? buildAcpSystemMessage(prompt.attachedFilePaths)
        : acpSystemMessage;
      const promptContent = isNewSession
        ? `${effectiveSystemMessage}\n\n${prompt.content}`
        : prompt.content;

      try {
        startUnresponsiveTimer();
        const retryImages = prompt.attachments?.length
          ? prompt.attachments.map(a => ({ data: a.data, mime_type: a.mimeType }))
          : null;
        await invoke('acp_session_prompt', {
          instanceId,
          sessionId: acpAgent!.chatSessionId,
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
  }, [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, updateMessage, addMessage, setMessageError, setMessageInterrupted, setLoading, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, appendThinkingSegment, pushSegment, updateSegment, finalizeSegments, resetAssistantMessage]);

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
