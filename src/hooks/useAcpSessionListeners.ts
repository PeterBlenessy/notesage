// Shared ACP session listener setup for chat interactions.
// Eliminates duplication between primary and retry paths in useAcpLifecycle.

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { usePermissionStore } from '@/stores/permission-store';
import { isToolCallAllowed } from '@/lib/ai/path-filter';
import { log } from '@/lib/logger';
import type { ChatMessage, AgentActivity, ToolCallSegment, ToolResultSegment, Segment } from '@/lib/ai/types';
import { useChatStore } from '@/stores/chat-store';
import {
  type AcpSessionUpdatePayload,
  type AcpPermissionRequestPayload,
  extractToolInfo,
  truncateDetail,
  formatAcpToolName,
  formatToolLabel,
  parseRawInput,
} from '@/lib/ai/acp-utils';
import { resetUnresponsiveTimer } from '@/hooks/useAcpLifecycle';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { updateCurrentMode, updateConfigOptionValue, updateUsage, setAvailableCommands } from '@/lib/ai/acp-agent-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatListenerDeps {
  instanceId: string;
  assistantMessageId: number;
  conversationId: string | null;
  pathFilterRoot: string | null;
  homeDir: string;
  // Chat store actions
  updateMessage: (id: number, content: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setActiveTool: (tool: string | null) => void;
  addActivity: (messageId: number, activity: AgentActivity) => void;
  completeLastActivity: (messageId: number) => void;
  completeAllActivities: (messageId: number) => void;
  // Segment actions (dual-write for chronological rendering)
  appendTextSegment: (messageId: number, text: string) => void;
  appendThinkingSegment: (messageId: number, text: string) => void;
  pushSegment: (messageId: number, segment: Segment) => void;
  updateSegment: (messageId: number, index: number, patch: Partial<Segment>) => void;
  updateOrPushPlanSegment: (messageId: number, entries: import('@/lib/ai/types').PlanEntry[]) => void;
  finalizeSegments: (messageId: number) => void;
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
  // FIFO queue of pending tool_call segment indices — handles parallel tool calls
  // (agents like Claude Code may send multiple tool_calls before any tool_results)
  const pendingToolCallIndices: number[] = [];

  const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
    if (event.payload.instanceId !== deps.instanceId) return;
    // Reset unresponsiveness timer — agent is still alive
    resetUnresponsiveTimer();
    // Clear any "unresponsive" banner — agent is alive
    if (useAgentStatusStore.getState().status === 'unresponsive') {
      useAgentStatusStore.getState().clearStatus();
    }
    const { update } = event.payload;

    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      update.content?.type === 'text' &&
      update.content.text
    ) {
      streamedContent += update.content.text;
      deps.updateMessage(deps.assistantMessageId, streamedContent);
      deps.appendTextSegment(deps.assistantMessageId, update.content.text);
    } else if (
      update.sessionUpdate === 'agent_message_chunk' &&
      update.content?.type === 'image' &&
      update.content.data
    ) {
      deps.pushSegment(deps.assistantMessageId, {
        type: 'image',
        data: update.content.data,
        mimeType: update.content.mimeType || 'image/png',
        timestamp: Date.now(),
      });
    } else if (
      update.sessionUpdate === 'agent_thought_chunk' &&
      update.content?.type === 'text' &&
      update.content.text
    ) {
      deps.appendThinkingSegment(deps.assistantMessageId, update.content.text);
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
      // Segment: push tool call with descriptive label
      const parsedArgs = parseRawInput(update.rawInput);
      const segmentLabel = formatToolLabel(update.kind || 'unknown', parsedArgs, update.title);
      const conv = useChatStore.getState().conversations
        .find(c => c.id === useChatStore.getState().activeConversationId);
      const msg = conv?.messages.find(m => m.timestamp === deps.assistantMessageId);
      pendingToolCallIndices.push(msg?.segments?.length ?? 0);
      deps.pushSegment(deps.assistantMessageId, {
        type: 'tool_call',
        kind: update.kind || 'unknown',
        label: segmentLabel,
        detail: (() => {
          // Prefer rawInput if it has useful content, otherwise fall back to title
          if (typeof update.rawInput === 'string' && update.rawInput.trim() && update.rawInput.trim() !== '{}') return update.rawInput;
          if (update.rawInput && typeof update.rawInput === 'object') {
            const json = JSON.stringify(update.rawInput);
            if (json !== '{}' && json !== 'null') return json;
          }
          return (update.title && update.title !== 'undefined' && update.title !== 'null') ? update.title : undefined;
        })(),
        status: 'running',
        timestamp: Date.now(),
      } as ToolCallSegment);
    } else if (update.sessionUpdate === 'tool_call_update') {
      deps.setActiveTool(formatAcpToolName(update.kind, update.title));
      // Patch the corresponding tool_call segment with richer data
      const lastToolIdx = pendingToolCallIndices[pendingToolCallIndices.length - 1];
      if (lastToolIdx !== undefined && lastToolIdx >= 0) {
        const patch: Partial<ToolCallSegment> = {};
        // Status mapping
        const rawStatus = String(update.status ?? '');
        if (rawStatus === 'completed') patch.status = 'done';
        else if (rawStatus === 'failed') patch.status = 'error';
        // Locations
        if (Array.isArray(update.locations) && update.locations.length > 0) {
          patch.locations = (update.locations as Array<Record<string, unknown>>).map(loc => ({
            path: String(loc.path ?? loc.file ?? ''),
            line: typeof loc.line === 'number' ? loc.line : undefined,
          }));
        }
        // Update label if title changed
        if (update.title) {
          const parsedArgs = parseRawInput(update.rawInput);
          patch.label = formatToolLabel(update.kind || 'unknown', parsedArgs, update.title);
        }
        if (Object.keys(patch).length > 0) {
          deps.updateSegment(deps.assistantMessageId, lastToolIdx, patch);
        }
      }
    } else if (update.sessionUpdate === 'tool_result') {
      deps.setActiveTool(null);
      deps.completeLastActivity(deps.assistantMessageId);
      // Segment: push result and mark the preceding tool_call as done
      deps.pushSegment(deps.assistantMessageId, {
        type: 'tool_result',
        result: typeof update.content?.text === 'string' ? update.content.text : undefined,
        collapsed: true,
        timestamp: Date.now(),
      } as ToolResultSegment);
      // Mark the oldest pending tool_call as done (FIFO — handles parallel tool calls)
      const doneIndex = pendingToolCallIndices.shift();
      if (doneIndex !== undefined && doneIndex >= 0) {
        deps.updateSegment(deps.assistantMessageId, doneIndex, { status: 'done' });
      }
    } else if (update.sessionUpdate === 'agent_turn_complete') {
      deps.setActiveTool(null);
      deps.completeAllActivities(deps.assistantMessageId);
      deps.finalizeSegments(deps.assistantMessageId);
    } else if (update.sessionUpdate === 'session_info_update' && update.title) {
      // Agent-generated conversation title — override auto-generated title
      if (deps.conversationId) {
        useChatStore.getState().renameConversation(deps.conversationId, update.title);
      }
    } else if (update.sessionUpdate === 'current_mode_update' && (update.currentModeId || update.current_mode_id)) {
      // Agent-initiated mode change (camelCase from ACP schema)
      updateCurrentMode(String(update.currentModeId ?? update.current_mode_id));
    } else if (update.sessionUpdate === 'config_option_update' && (update.configId || update.config_id)) {
      // Agent-initiated config option change (camelCase from ACP schema)
      const configId = String(update.configId ?? update.config_id);
      const value = String(update.value ?? update.currentValue ?? '');
      if (configId && value) updateConfigOptionValue(configId, value);
    } else if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
      // Agent execution plan — full replacement
      const entries = (update.entries as Array<Record<string, unknown>>).map(e => ({
        content: String(e.content ?? e.description ?? ''),
        priority: (['high', 'medium', 'low'].includes(String(e.priority)) ? String(e.priority) : 'medium') as 'high' | 'medium' | 'low',
        status: (['pending', 'in_progress', 'completed'].includes(String(e.status)) ? String(e.status) : 'pending') as 'pending' | 'in_progress' | 'completed',
      }));
      deps.updateOrPushPlanSegment(deps.assistantMessageId, entries);
    } else if (update.sessionUpdate === 'usage_update') {
      // Token usage and cost tracking — ACP UsageUpdate fields: used, size, cost: { amount, currency }
      const contextUsed = typeof update.used === 'number' ? update.used : 0;
      const contextSize = typeof update.size === 'number' ? update.size : 0;
      const rawCost = update.cost as { amount?: number; currency?: string } | undefined;
      const cost = (rawCost && typeof rawCost.amount === 'number' && typeof rawCost.currency === 'string')
        ? { amount: rawCost.amount, currency: rawCost.currency }
        : undefined;
      if (contextUsed > 0 || contextSize > 0) {
        updateUsage({ contextUsed, contextSize, cost });
      }
    } else if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands ?? update.available_commands)) {
      // Agent slash commands (camelCase from ACP schema)
      const rawCommands = (update.availableCommands ?? update.available_commands) as Array<Record<string, unknown>>;
      const commands = rawCommands.map(cmd => ({
        name: String(cmd.name ?? ''),
        description: String(cmd.description ?? ''),
        inputHint: typeof cmd.inputHint === 'string' ? cmd.inputHint : undefined,
      }));
      setAvailableCommands(commands);
    } else if (update.sessionUpdate) {
      // Unknown session update type — log for debugging, don't crash
      log.debug('ai', `Unknown ACP session update type: ${update.sessionUpdate}`);
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
 *
 * When `cancelled` is true (user-initiated stop), the assistant message is
 * finalized and marked as interrupted so partial content stays visible.
 */
export function buildAcpChatCleanup(
  listeners: AcpChatListeners,
  instanceId: string,
  assistantMessageId: number,
  cleanupRef: React.MutableRefObject<(() => void) | null>,
  setLoading: (loading: boolean) => void,
  setActiveTool: (tool: string | null) => void,
  finalizeSegments: (messageId: number) => void,
  setMessageInterrupted: (messageId: number) => void,
): () => void {
  let cleaned = false;
  return (cancelled?: boolean) => {
    if (cleaned) return;
    cleaned = true;
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
    // Finalize segments so running spinners stop
    finalizeSegments(assistantMessageId);
    // Mark as interrupted if this was a user-initiated cancel
    if (cancelled) {
      setMessageInterrupted(assistantMessageId);
    }
    setLoading(false);
    setActiveTool(null);
  };
}
