// ---------------------------------------------------------------------------
// Single-turn ACP text generation for inline actions (Improve, Summarize,
// Expand). Extracted from `useAcpLifecycle` — the flow is self-contained (own
// throwaway session, auto-approved permissions, one connection-error retry)
// and touches no hook state, so it lives as a plain module function that the
// hook wraps in a thin `useCallback`.
// ---------------------------------------------------------------------------

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { log } from '@/lib/logger';
import { useChatStore } from '@/stores/chat-store';
import type { Connection } from '@/lib/ai/connections';
import { isAcpConnectionError, friendlyAcpError } from '@/lib/ai/errors';
import type { AcpSessionResult, AcpSessionUpdatePayload, AcpPermissionRequestPayload } from '@/lib/ai/acp-utils';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import { getAcpAgent, stopAcpAgent, ensureAcpAgent } from '@/lib/ai/acp-agent-state';

/**
 * Generate text via ACP agent (single-turn, auto-approve permissions).
 * Used for inline actions (Improve, Summarize, Expand).
 */
export async function acpGenerateTextOnce(
  effectiveConnection: Connection,
  acpSystemMessage: string,
  selectedProjectPaths: string[],
  prompt: string,
): Promise<string> {
  // Inline actions reuse the active conversation's agent (its registry key).
  const conversationId = useChatStore.getState().activeConversationId ?? undefined;

  const attemptGenerate = async (): Promise<string> => {
    const cwd = selectedProjectPaths[0] || '/tmp';
    const inlineSandboxPaths = cwd !== '/tmp' ? [cwd] : [];
    const instanceId = await ensureAcpAgent(effectiveConnection, cwd, inlineSandboxPaths, 'inline', { conversationId });

    const session = await invoke<AcpSessionResult>('acp_session_new', {
      instanceId,
      workingDirectory: cwd,
      mcpServers: buildAcpMcpServerInputs(getAcpAgent(conversationId)?.capabilities, selectedProjectPaths),
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
      stopAcpAgent(conversationId);
      try {
        return await attemptGenerate();
      } catch (retryError) {
        stopAcpAgent(conversationId);
        log.error('ai', 'ACP inline action retry also failed', retryError);
        throw new Error(friendlyAcpError(retryError, effectiveConnection?.label || effectiveConnection?.provider));
      }
    }
    stopAcpAgent(conversationId);
    log.error('ai', 'ACP inline action error', error);
    throw new Error(friendlyAcpError(error, effectiveConnection?.label || effectiveConnection?.provider));
  }
}
