import { useCallback, useEffect, useRef } from 'react';
import { useChatStore, selectProjectPaths, selectPendingProjectSwitch } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage } from '@/lib/ai/types';
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
import { acpAgent, stopAcpAgent, ensureAcpAgent, updateAcpAgentInstanceId, clearAcpAgent } from '@/lib/ai/acp-agent-state';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';

// Re-export for backward compatibility
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Unresponsiveness detection timer (60s inactivity → recovery)
// ---------------------------------------------------------------------------

const UNRESPONSIVE_TIMEOUT_MS = 60_000;

/** Module-level timer ID so useAcpSessionListeners can reset it. */
let unresponsiveTimerId: ReturnType<typeof setTimeout> | null = null;

/** Callback to invoke when the timer fires. Set by the hook. */
let onUnresponsiveCallback: (() => void) | null = null;

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
  const { addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities, addSystemStatus } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Recovery orchestrator — up to 3 attempts with backoff
  // ---------------------------------------------------------------------------

  const acpRecoverAgent = useCallback(async () => {
    if (!acpAgent || !effectiveConnection) return;

    const agentLabel = effectiveConnection.label || effectiveConnection.provider || 'the agent';
    const sessionId = acpAgent.chatSessionId;
    const oldInstanceId = acpAgent.instanceId;

    // Clean up listeners from the stuck prompt
    clearUnresponsiveTimer();
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    const MAX_ATTEMPTS = 3;
    const BACKOFF_DELAYS = [5_000, 15_000, 30_000];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      addSystemStatus('reconnecting', agentLabel, attempt, MAX_ATTEMPTS);

      // Wait backoff delay
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_DELAYS[attempt - 1]));

      try {
        const result = await invoke<{ instance_id: string }>('acp_agent_reconnect', {
          instanceId: oldInstanceId,
          sessionId: sessionId ?? '',
        });

        // Update the module-level singleton with new instance ID
        if (!acpAgent) {
          // Agent was cleared during recovery (e.g., connection changed)
          break;
        }
        updateAcpAgentInstanceId(result.instance_id);

        // Success — update status and resume
        addSystemStatus('reconnected', agentLabel);
        setLoading(false);
        setActiveTool(null);
        log.info('ai', `ACP recovery succeeded on attempt ${attempt}`);
        return;
      } catch (err) {
        log.warn('ai', `ACP recovery attempt ${attempt} failed: ${String(err)}`);
        // On failure, the old instance is already removed from the backend.
        // For retry, we need to use the same instance_id to attempt again,
        // but since reconnect already removed it, we need to handle this.
        // Actually, on failure the reconnect command may have partially succeeded
        // (spawned a new agent). Let's just continue — the next attempt will
        // try to reconnect whatever is in the map.
      }
    }

    // All attempts failed — show failed state
    addSystemStatus('failed', agentLabel);
    setLoading(false);
    setActiveTool(null);
    // Clear the agent so user can restart fresh
    clearAcpAgent();
    log.error('ai', 'ACP recovery exhausted all attempts');
  }, [effectiveConnection, addSystemStatus, setLoading, setActiveTool]);

  // Recovery callback ref for the unresponsive timer
  const recoveryCallbackRef = useRef<(() => void) | null>(null);
  recoveryCallbackRef.current = acpRecoverAgent;

  // Register the unresponsive callback so the timer can trigger recovery
  useEffect(() => {
    onUnresponsiveCallback = () => {
      log.warn('ai', 'ACP agent unresponsive for 60s, triggering recovery');
      recoveryCallbackRef.current?.();
    };
    return () => {
      onUnresponsiveCallback = null;
      clearUnresponsiveTimer();
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
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[]; parentId?: string | null }) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (!effectiveConnection) throw new Error('No ACP connection');

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp, displayContent: opts?.displayContent, skillName: opts?.skillName, ...(opts?.parentId !== undefined ? { parentId: opts.parentId } : {}) };
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
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: acpAgent!.chatSessionId,
            content: promptContent,
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
          log.warn('ai', `ACP connection error, retrying: ${String(error)}`);
          stopAcpAgent();
          updateMessage(assistantMessageId, 'Reconnecting to agent...');

          try {
            const cwd = selectedProjectPaths[0] || '/tmp';
            const retrySandboxScope = opts?.sandboxPaths ?? getAllWorkspacePaths();
            const instanceId = await ensureAcpAgent(effectiveConnection, cwd, retrySandboxScope);

            // Need a fresh session after reconnect
            const session = await invoke<AcpSessionResult>('acp_session_new', {
              instanceId,
              workingDirectory: cwd,
            });
            acpAgent!.chatSessionId = session.session_id;
            useChatStore.getState().setSegmentSessionId(session.session_id);

            if (session.available_models.length > 0) {
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

            // Set up listeners for the retry (reuses the same shared setup)
            const listeners = await setupAcpChatListeners({ ...listenerDeps, instanceId });
            cleanupRef.current = buildAcpChatCleanup(listeners, instanceId, cleanupRef, setLoading, setActiveTool);

            const effectiveSystemMessage = buildAcpSystemMessage
              ? buildAcpSystemMessage(opts?.attachedFilePaths)
              : acpSystemMessage;
            const promptContent = `${effectiveSystemMessage}\n\n${content}`;

            try {
              await invoke('acp_session_prompt', { instanceId, sessionId: acpAgent!.chatSessionId, content: promptContent });
              return; // Retry succeeded
            } finally {
              if (cleanupRef.current) {
                cleanupRef.current();
              }
            }
          } catch (retryError) {
            if (cleanupRef.current) {
              cleanupRef.current();
            }
            stopAcpAgent();
            log.error('ai', 'ACP retry also failed', retryError);
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
        stopAcpAgent();
        log.error('ai', 'ACP chat error', error);
        setMessageError(assistantMessageId, friendlyAcpError(error, agentLabel));
        setLoading(false);
        setActiveTool(null);
      }
    },
    [effectiveConnection, acpSystemMessage, buildAcpSystemMessage, selectedProjectPaths, addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities]
  );

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

      // Listen for successful cancel confirmation
      listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
        if (event.payload.instanceId !== instanceId) return;
        const { update } = event.payload;
        if (
          update.sessionUpdate === 'agent_turn_complete' ||
          (update.sessionUpdate === 'agent_message_chunk' && update.stopReason === 'cancelled')
        ) {
          // Cancel succeeded — clear escalation
          if (cancelEscalationRef.current) {
            clearTimeout(cancelEscalationRef.current);
            cancelEscalationRef.current = null;
          }
          cancelEscalationListenerRef.current?.();
          cancelEscalationListenerRef.current = null;
        }
      }).then((unlisten) => {
        cancelEscalationListenerRef.current = unlisten;
      });

      cancelEscalationRef.current = setTimeout(() => {
        cancelEscalationRef.current = null;
        cancelEscalationListenerRef.current?.();
        cancelEscalationListenerRef.current = null;
        log.warn('ai', 'ACP cancel escalation: agent did not respond within 5s, triggering recovery');
        recoveryCallbackRef.current?.();
      }, CANCEL_ESCALATION_MS);

      // Clear the session so the next message creates a fresh one
      acpAgent.chatSessionId = null;
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { acpGenerateText, acpSendChatMessage, acpCancelChat, acpRecoverAgent };
}
