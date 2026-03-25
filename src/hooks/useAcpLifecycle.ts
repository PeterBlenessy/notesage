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
import { acpAgent, stopAcpAgent, ensureAcpAgent } from '@/lib/ai/acp-agent-state';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';

// Re-export for backward compatibility
export { stopAcpAgent } from '@/lib/ai/acp-agent-state';
export { truncateDetail, formatAcpToolName } from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface AcpLifecycleParams {
  effectiveConnection: Connection | null;
  acpSystemMessage: string;
  buildAcpSystemMessage?: (attachedFilePaths?: string[]) => string;
}

export function useAcpLifecycle({ effectiveConnection, acpSystemMessage, buildAcpSystemMessage }: AcpLifecycleParams) {
  const { addMessage, updateMessage, setMessageError, setLoading, setError, setActiveTool, addActivity, completeLastActivity, completeAllActivities } = useChatStore();
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const cleanupRef = useRef<(() => void) | null>(null);

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
          }).catch(() => {});
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
    async (content: string, messages: ChatMessage[], opts?: { displayContent?: string; skillName?: string; attachedFilePaths?: string[]; sandboxPaths?: string[] }) => {
      // Clean up any stale listeners from a previous streaming call
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (!effectiveConnection) throw new Error('No ACP connection');

      setLoading(true);
      setError(null);

      const userTimestamp = Date.now();
      const userMessage: ChatMessage = { role: 'user', content, timestamp: userTimestamp, displayContent: opts?.displayContent, skillName: opts?.skillName };
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
          await invoke('acp_session_prompt', {
            instanceId,
            sessionId: acpAgent!.chatSessionId,
            content: promptContent,
          });
        } finally {
          if (cleanupRef.current) {
            cleanupRef.current();
          }
        }
      } catch (error) {
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
  const acpCancelChat = useCallback(() => {
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
        }).catch(() => {});
      }
      usePermissionStore.getState().clearRequestsForInstance(acpAgent!.instanceId);

      invoke('acp_session_cancel', {
        instanceId: acpAgent.instanceId,
        sessionId: acpAgent.chatSessionId,
      }).catch(() => {});

      // Clear the session so the next message creates a fresh one
      acpAgent.chatSessionId = null;
    }

    setLoading(false);
    setActiveTool(null);
  }, [setLoading, setActiveTool]);

  return { acpGenerateText, acpSendChatMessage, acpCancelChat };
}
