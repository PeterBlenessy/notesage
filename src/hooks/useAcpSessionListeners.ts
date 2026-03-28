// Shared ACP session listener setup for chat interactions.
// Eliminates duplication between primary and retry paths in useAcpLifecycle.

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { usePermissionStore } from '@/stores/permission-store';
import { isToolCallAllowed } from '@/lib/ai/path-filter';
import { log } from '@/lib/logger';
import type { ChatMessage, AgentActivity } from '@/lib/ai/types';
import {
  type AcpSessionUpdatePayload,
  type AcpPermissionRequestPayload,
  extractToolInfo,
  truncateDetail,
  formatAcpToolName,
} from '@/lib/ai/acp-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatListenerDeps {
  instanceId: string;
  assistantMessageId: number;
  pathFilterRoot: string | null;
  homeDir: string;
  // Chat store actions
  updateMessage: (id: number, content: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setActiveTool: (tool: string | null) => void;
  addActivity: (messageId: number, activity: AgentActivity) => void;
  completeLastActivity: (messageId: number) => void;
  completeAllActivities: (messageId: number) => void;
}

export interface AcpChatListeners {
  unlisten: () => void;
  unlistenPermission: () => void;
  getStreamedContent: () => string;
}

// ---------------------------------------------------------------------------
// Listener setup
// ---------------------------------------------------------------------------

/**
 * Set up `acp-session-update` and `acp-permission-request` listeners for a
 * chat session. Returns handles to unlisten and to read accumulated content.
 */
export async function setupAcpChatListeners(deps: ChatListenerDeps): Promise<AcpChatListeners> {
  let streamedContent = '';

  const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
    if (event.payload.instanceId !== deps.instanceId) return;
    const { update } = event.payload;

    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      update.content?.type === 'text' &&
      update.content.text
    ) {
      streamedContent += update.content.text;
      deps.updateMessage(deps.assistantMessageId, streamedContent);
    } else if (update.sessionUpdate === 'tool_call') {
      const toolLabel = formatAcpToolName(update.kind, update.title);
      deps.setActiveTool(toolLabel);
      deps.addActivity(deps.assistantMessageId, {
        kind: update.kind || 'unknown',
        label: toolLabel,
        detail: update.rawInput ? truncateDetail(update.rawInput) : undefined,
        status: 'running',
        timestamp: Date.now(),
      });
    } else if (update.sessionUpdate === 'tool_call_update') {
      deps.setActiveTool(formatAcpToolName(update.kind, update.title));
    } else if (update.sessionUpdate === 'tool_result') {
      deps.setActiveTool(null);
      deps.completeLastActivity(deps.assistantMessageId);
    } else if (update.sessionUpdate === 'agent_turn_complete') {
      deps.setActiveTool(null);
      deps.completeAllActivities(deps.assistantMessageId);
    }
  });

  const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
    if (event.payload.instanceId !== deps.instanceId) return;
    const payload = event.payload;

    // Clear the active tool spinner — the previous tool finished,
    // now the agent is asking permission for the next action.
    deps.setActiveTool(null);

    const toolInfo = extractToolInfo(payload.toolCall);
    const rawOptions = payload.options as unknown[];
    let firstOptionId: string | null = null;
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      const opt = rawOptions[0] as Record<string, unknown>;
      firstOptionId = typeof opt === 'string' ? opt : String(opt?.optionId ?? opt?.id ?? '');
    }

    // Path filtering for comment-sourced chats: deny tool calls outside project scope
    if (deps.pathFilterRoot) {
      const filterResult = isToolCallAllowed(toolInfo.kind, toolInfo.input, deps.pathFilterRoot, deps.homeDir);
      if (!filterResult.allowed) {
        log.info('ai', `Chat tool call denied: ${toolInfo.title} targets ${filterResult.deniedPath} outside project ${deps.pathFilterRoot}`);
        deps.addMessage({
          role: 'system',
          content: `Tool call denied: **${toolInfo.title}** \u2014 targets path outside project scope (\`${filterResult.deniedPath}\`)`,
          timestamp: Date.now(),
        });
        invoke('acp_permission_respond', { instanceId: deps.instanceId, requestId: payload.requestId, optionId: null }).catch(() => {}); // Expected: fire-and-forget deny
        return;
      }
    }

    if (usePermissionStore.getState().isAutoAllowed(toolInfo.kind)) {
      // Tool kinds in session or always allow-lists: auto-approve silently
      invoke('acp_permission_respond', {
        instanceId: deps.instanceId,
        requestId: payload.requestId,
        optionId: firstOptionId,
      }).catch(() => {}); // Expected: fire-and-forget auto-approve
    } else {
      // Write tools: add to permission store, let PermissionCard UI handle response
      const options = Array.isArray(rawOptions)
        ? rawOptions.map((o) => {
            const opt = o as Record<string, unknown>;
            return {
              optionId: String(opt?.optionId ?? opt?.id ?? ''),
              kind: String(opt?.kind ?? ''),
              name: String(opt?.name ?? ''),
            };
          })
        : [];

      usePermissionStore.getState().addRequest({
        id: `${payload.requestId}-${Date.now()}`,
        instanceId: deps.instanceId,
        sessionId: payload.sessionId,
        requestId: payload.requestId,
        toolKind: toolInfo.kind,
        toolTitle: toolInfo.title,
        toolInput: truncateDetail(toolInfo.input, 200),
        options,
        timestamp: Date.now(),
      });
    }
  });

  return {
    unlisten,
    unlistenPermission,
    getStreamedContent: () => streamedContent,
  };
}

// ---------------------------------------------------------------------------
// Cleanup builder
// ---------------------------------------------------------------------------

/**
 * Build a one-shot cleanup function that unlistens, denies pending permissions,
 * and resets loading/tool state. Sets `cleanupRef.current = null` at entry to
 * prevent re-entrant calls.
 */
export function buildAcpChatCleanup(
  listeners: AcpChatListeners,
  instanceId: string,
  cleanupRef: React.MutableRefObject<(() => void) | null>,
  setLoading: (loading: boolean) => void,
  setActiveTool: (tool: string | null) => void,
): () => void {
  return () => {
    // Null the ref first to prevent re-entrant calls
    cleanupRef.current = null;
    listeners.unlisten();
    listeners.unlistenPermission();
    // Deny any pending permission requests for this agent and clear from store
    const pendingRequests = usePermissionStore.getState().requests.filter(
      (r) => r.instanceId === instanceId
    );
    for (const req of pendingRequests) {
      invoke('acp_permission_respond', {
        instanceId,
        requestId: req.requestId,
        optionId: null,
      }).catch(() => {}); // Expected: fire-and-forget deny during cleanup
    }
    usePermissionStore.getState().clearRequestsForInstance(instanceId);
    setLoading(false);
    setActiveTool(null);
  };
}
