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
import { acpAgent, stopAcpAgent, ensureAcpAgent, updateAcpAgentInstanceId } from '@/lib/ai/acp-agent-state';
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
  const { addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, pushSegment, updateSegment, finalizeSegments, resetAssistantMessage } = useChatStore();
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
        pathFilterRoot,
        homeDir,
        updateMessage,
        addMessage,
        setActiveTool,
        addActivity,
        completeLastActivity,
        completeAllActivities,
        appendTextSegment,
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
        }

        const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
        cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, cleanupRef, setLoading, setActiveTool);

        try {
          // Prepend system prompt on the first message of a new session
          const effectiveSystemMessage = buildAcpSystemMessage
            ? buildAcpSystemMessage(opts?.attachedFilePaths)
            : acpSystemMessage;
          const promptContent = isNewSession
            ? `${effectiveSystemMessage}\n\n${content}`
            : content;
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
    [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, pushSegment, updateSegment, finalizeSegments]
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
      pathFilterRoot: prompt.pathFilterRoot,
      homeDir: prompt.homeDir,
      updateMessage,
      addMessage,
      setActiveTool,
      addActivity,
      completeLastActivity,
      completeAllActivities,
      appendTextSegment,
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
      }

      // Set up listeners
      const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
      cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, cleanupRef, setLoading, setActiveTool);

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
  }, [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, updateMessage, addMessage, setMessageError, setLoading, setActiveTool, addActivity, completeLastActivity, completeAllActivities, appendTextSegment, pushSegment, updateSegment, finalizeSegments, resetAssistantMessage]);

  /**
   * Cancel an active ACP chat session.
   */
  // Stop button escalation timer: 5s after cancel, if no response → SIGKILL + recovery
  const cancelEscalationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelEscalationListenerRef = useRef<(() => void) | null>(null);

  const acpCancelChat = useCallback(() => {
    // Clear unresponsiveness timer
    clearUnresponsiveTimer();

    // Clean up listeners and reset loading state
    if (cleanupRef.current) {
      cleanupRef.current();
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
