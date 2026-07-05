// Shared ACP session listener setup for chat interactions.
// Eliminates duplication between primary and retry paths in useAcpLifecycle.

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { usePermissionStore } from '@/stores/permission-store';
import { useSettingsStore } from '@/stores/settings-store';
import { isToolCallAllowed } from '@/lib/ai/path-filter';
import { log } from '@/lib/logger';
import type { ChatMessage, AgentActivity, ToolCallSegment, ToolResultSegment, Segment, ActivityApprovalMode } from '@/lib/ai/types';
import { useChatStore } from '@/stores/chat-store';
import {
  type AcpSessionUpdatePayload,
  type AcpPermissionRequestPayload,
  extractToolInfo,
  truncateDetail,
  formatAcpToolName,
  formatToolLabel,
  parseRawInput,
  normalizeToolCallContent,
  formatResourceLinkAsMarkdown,
} from '@/lib/ai/acp-utils';
import { resetUnresponsiveTimer } from '@/hooks/acp/unresponsive-monitor';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { updateCurrentMode, updateConfigOptionValue, updateUsage, setAvailableCommands, setLastTurnUsage } from '@/lib/ai/acp-agent-state';
import { parseUsageMeta, parseTurnUsage } from '@/lib/ai/usage';
import { useUsageStore } from '@/stores/usage-store';
import { runRunning, runAwaitingPermission, runIdle } from '@/lib/ai/session-run';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatListenerDeps {
  instanceId: string;
  /**
   * ACP session this turn prompts on. A single agent instance is reused across
   * sessions within a conversation (`chatSessionId` is swapped on the agent
   * object, not the instance), so the instanceId gate alone lets a stale
   * listener receive a NEWER session's chunks — the listeners below also
   * reject events whose payload carries a different sessionId. Conservative:
   * when either side lacks a session id (older agents, pre-session updates),
   * the gate falls back to instanceId-only so legitimate events aren't dropped.
   */
  sessionId?: string | null;
  assistantMessageId: number;
  conversationId: string | null;
  /**
   * Project roots that bound the agent's filesystem reach. Mirrors the kernel
   * sandbox so the application-level filter denies the same paths Seatbelt would
   * block. Empty array means no project scope (system + safe-home paths only).
   */
  pathFilterRoots: string[];
  homeDir: string;
  /**
   * Active connection id and project root used to scope `isAutoAllowed` lookups
   * (#6b angle 2). An "always allow X" granted in Project A must NOT auto-approve
   * X while the user is in Project B. Optional for backward compat with callers
   * that haven't been updated; when undefined the lookup falls back to the
   * legacy unscoped `(null, null)` query and behaves as before.
   */
  connectionId?: string | null;
  activeProjectRoot?: string | null;
  // Chat store actions. The streaming-write methods carry an optional trailing
  // `convId` so a background session's deltas target the conversation that OWNS
  // the message rather than the foreground one (task #3); these mirror the
  // chat-store action signatures. `updateMessage` keeps its `citations` slot.
  updateMessage: (id: number, content: string, citations?: import('@/lib/ai/types').Citation[], convId?: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  setActiveTool: (tool: string | null) => void;
  addActivity: (messageId: number, activity: AgentActivity, convId?: string | null) => void;
  completeLastActivity: (messageId: number, convId?: string | null) => void;
  completeAllActivities: (messageId: number, convId?: string | null) => void;
  /**
   * Patch `approvalMode` on the most recent activity on this message. Called
   * from the permission handler once we know whether the tool was auto-approved,
   * user-approved, or denied — keeps the activity panel badge accurate.
   */
  setLastActivityApprovalMode: (messageId: number, mode: ActivityApprovalMode, convId?: string | null) => void;
  // Segment actions (dual-write for chronological rendering)
  appendTextSegment: (messageId: number, text: string, convId?: string | null) => void;
  appendThinkingSegment: (messageId: number, text: string, convId?: string | null) => void;
  pushSegment: (messageId: number, segment: Segment, convId?: string | null) => void;
  updateSegment: (messageId: number, index: number, patch: Partial<Segment>, convId?: string | null) => void;
  updateOrPushPlanSegment: (messageId: number, entries: import('@/lib/ai/types').PlanEntry[], convId?: string | null) => void;
  finalizeSegments: (messageId: number, convId?: string | null) => void;
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
  // Conversation that owns this session — every store write below addresses it
  // explicitly so a background ACP session's deltas land on its own conversation,
  // not whatever is foregrounded (task #3). `null` → `updateConv` falls back to
  // the active conversation (legacy single-session behavior).
  const cid = deps.conversationId;

  const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
    if (event.payload.instanceId !== deps.instanceId) return;
    // Session gate — see `ChatListenerDeps.sessionId`. Only rejects when BOTH
    // sides carry a session id and they differ; a missing id on either side
    // falls back to the instanceId-only gate.
    if (deps.sessionId && event.payload.sessionId && event.payload.sessionId !== deps.sessionId) return;
    // Reset unresponsiveness timer — agent is still alive
    resetUnresponsiveTimer();
    // Any session activity means the agent is working again — if it had been
    // blocked on a permission decision, flip the run back to `running` (task #4).
    // The guard inside `runRunning` makes this a no-op unless that transition
    // actually applies, so it's cheap to call per event.
    runRunning(cid);
    // Clear any "unresponsive" banner — agent is alive
    if (useAgentStatusStore.getState().status === 'unresponsive') {
      useAgentStatusStore.getState().clearStatus();
    }
    const { update } = event.payload;
    // `content` is a single ContentBlock for *_chunk events and an array for tool_call_update.
    // Narrow to the single-object form here; tool_call_update handles the array form below.
    const chunkContent = Array.isArray(update.content) ? undefined : update.content;

    // Persist the agent-assigned message ID when emitted. On `agent_message_chunk`,
    // `messageId` (ContentChunk.message_id, stable in ACP 0.13.6) groups the chunks
    // of one assistant message — all chunks of the same message share it; a change
    // signals a new message. It is NOT an echo of a client-supplied UUID (the old
    // PromptRequest.message_id design was removed). No user-visible effect in v1 —
    // future-proofing for features that reference messages by stable protocol ID.
    if (update.sessionUpdate === 'agent_message_chunk') {
      const assistantAcpId = typeof update.messageId === 'string' && update.messageId
        ? update.messageId
        : typeof update.message_id === 'string' && update.message_id
          ? update.message_id
          : undefined;
      if (assistantAcpId) {
        useChatStore.getState().setMessageAcpId(deps.assistantMessageId, assistantAcpId, cid);
      }
    }

    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      chunkContent?.type === 'text' &&
      chunkContent.text
    ) {
      streamedContent += chunkContent.text;
      deps.updateMessage(deps.assistantMessageId, streamedContent, undefined, cid);
      deps.appendTextSegment(deps.assistantMessageId, chunkContent.text, cid);
    } else if (
      update.sessionUpdate === 'agent_message_chunk' &&
      chunkContent?.type === 'resource_link' &&
      chunkContent.uri
    ) {
      // Render resource_link inline as a markdown link. The existing markdown renderer
      // + link-click extension handle navigation (internal file → tab, external → browser).
      const markdown = formatResourceLinkAsMarkdown(chunkContent);
      if (markdown) {
        streamedContent += markdown;
        deps.updateMessage(deps.assistantMessageId, streamedContent, undefined, cid);
        deps.appendTextSegment(deps.assistantMessageId, markdown, cid);
      }
    } else if (
      update.sessionUpdate === 'agent_message_chunk' &&
      chunkContent?.type === 'image' &&
      chunkContent.data
    ) {
      deps.pushSegment(deps.assistantMessageId, {
        type: 'image',
        data: chunkContent.data,
        mimeType: chunkContent.mimeType || 'image/png',
        timestamp: Date.now(),
      }, cid);
    } else if (
      update.sessionUpdate === 'agent_thought_chunk' &&
      chunkContent?.type === 'text' &&
      chunkContent.text
    ) {
      deps.appendThinkingSegment(deps.assistantMessageId, chunkContent.text, cid);
    } else if (update.sessionUpdate === 'tool_call') {
      const toolLabel = formatAcpToolName(update.kind, update.title);
      deps.setActiveTool(toolLabel);
      // Optimistic `approvalMode: 'auto'`. If a permission request arrives for
      // this call, the handler below patches it to 'user' or 'denied' via
      // `setLastActivityApprovalMode`. Tools that don't trigger a permission
      // request (auto-allowed, e.g. read-only) stay 'auto'.
      deps.addActivity(deps.assistantMessageId, {
        kind: update.kind || 'unknown',
        label: toolLabel,
        detail: update.rawInput ? truncateDetail(update.rawInput) : undefined,
        status: 'running',
        timestamp: Date.now(),
        approvalMode: 'auto',
      }, cid);
      // Segment: push tool call with descriptive label
      const parsedArgs = parseRawInput(update.rawInput);
      const segmentLabel = formatToolLabel(update.kind || 'unknown', parsedArgs, update.title);
      // Locate the message in THIS listener's own conversation, not the foreground
      // one. Under concurrent sessions (task #2) a background agent's tool_call must
      // compute its pending-segment index against its own conversation; reading
      // `activeConversationId` here would index into whichever chat the user is
      // currently watching and cross-wire the segment. Fall back to the active
      // conversation only when this listener has no bound id (legacy callers).
      const ownerConvId = cid ?? useChatStore.getState().activeConversationId;
      const conv = useChatStore.getState().conversations
        .find(c => c.id === ownerConvId);
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
      } as ToolCallSegment, cid);
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
        // Rich content (Diff / Content / Terminal). Per ACP spec, this is a full replacement
        // of the previous content array — not an append.
        if (Array.isArray(update.content)) {
          patch.content = normalizeToolCallContent(update.content);
        }
        if (Object.keys(patch).length > 0) {
          deps.updateSegment(deps.assistantMessageId, lastToolIdx, patch, cid);
        }
      }
    } else if (update.sessionUpdate === 'tool_result') {
      deps.setActiveTool(null);
      deps.completeLastActivity(deps.assistantMessageId, cid);
      // Segment: push result and mark the preceding tool_call as done
      deps.pushSegment(deps.assistantMessageId, {
        type: 'tool_result',
        result: (!Array.isArray(update.content) && typeof update.content?.text === 'string')
          ? update.content.text
          : undefined,
        collapsed: true,
        timestamp: Date.now(),
      } as ToolResultSegment, cid);
      // Mark the oldest pending tool_call as done (FIFO — handles parallel tool calls)
      const doneIndex = pendingToolCallIndices.shift();
      if (doneIndex !== undefined && doneIndex >= 0) {
        deps.updateSegment(deps.assistantMessageId, doneIndex, { status: 'done' }, cid);
      }
    } else if (update.sessionUpdate === 'agent_turn_complete') {
      deps.setActiveTool(null);
      deps.completeAllActivities(deps.assistantMessageId, cid);
      deps.finalizeSegments(deps.assistantMessageId, cid);
    } else if (update.sessionUpdate === 'session_info_update' && update.title) {
      // Agent-generated conversation title — override auto-generated title
      if (deps.conversationId) {
        useChatStore.getState().renameConversation(deps.conversationId, update.title);
      }
    } else if (update.sessionUpdate === 'current_mode_update' && (update.currentModeId || update.current_mode_id)) {
      // Agent-initiated mode change (camelCase from ACP schema)
      const nextModeId = String(update.currentModeId ?? update.current_mode_id);
      updateCurrentMode(nextModeId);
      // Persist so a later restore re-applies the latest actual mode (keeps the
      // conversation's agentModeId in sync with agent self-changes).
      useChatStore.getState().setConversationMode(nextModeId);
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
      deps.updateOrPushPlanSegment(deps.assistantMessageId, entries, cid);
    } else if (update.sessionUpdate === 'usage_update') {
      // Token usage and cost tracking — ACP UsageUpdate fields: used, size, cost: { amount, currency }
      const contextUsed = typeof update.used === 'number' ? update.used : 0;
      const contextSize = typeof update.size === 'number' ? update.size : 0;
      const rawCost = update.cost as { amount?: number; currency?: string } | undefined;
      const cost = (rawCost && typeof rawCost.amount === 'number' && typeof rawCost.currency === 'string')
        ? { amount: rawCost.amount, currency: rawCost.currency }
        : undefined;
      // Rate-limit state riding along in the non-contractual `_meta` bag
      // (e.g. `_claude/rateLimit` from claude-code-acp). Best-effort: malformed
      // or absent `_meta` yields undefined and behavior matches today.
      const rateLimit = parseUsageMeta(update._meta);
      if (contextUsed > 0 || contextSize > 0 || rateLimit) {
        updateUsage({ contextUsed, contextSize, cost, rateLimit });
        // Write through to the per-connection snapshot store (#6) so the live
        // singleton and Settings-facing snapshots stay in sync. Sparse patch:
        // a rate-limit-only update must not zero out a prior context reading.
        if (deps.connectionId) {
          useUsageStore.getState().recordUsage(deps.connectionId, {
            ...(contextUsed > 0 || contextSize > 0 ? { contextUsed, contextSize } : {}),
            cost,
            rateLimit,
            source: 'acp',
            confidence: 'exact',
          });
        }
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
    } else if (update.sessionUpdate === 'user_message_chunk') {
      // Agent echoes user message as received — we already have it locally.
      // Recognize explicitly to suppress the "Unknown session update" debug log.
    } else if (update.sessionUpdate) {
      // Unknown session update type — log for debugging, don't crash
      log.debug('ai', `Unknown ACP session update type: ${update.sessionUpdate}`);
    }
  });

  // Per-turn token usage from the prompt response (`acp-turn-usage`, emitted by
  // the Rust prompt path when the agent reports `PromptResponse.usage` — an
  // UNSTABLE upstream field, so the payload is validated, never trusted).
  // Malformed payloads are ignored silently (provider-usage-display #5).
  const unlistenTurnUsage = await listen<{ instanceId: string; sessionId: string; usage: unknown }>(
    'acp-turn-usage',
    (event) => {
      if (event.payload.instanceId !== deps.instanceId) return;
      // Session gate — same conservative rule as the session-update listener:
      // reject only when BOTH sides carry a session id and they differ, so a
      // stale listener never records another session's turn usage.
      if (deps.sessionId && event.payload.sessionId && event.payload.sessionId !== deps.sessionId) return;
      const turnUsage = parseTurnUsage(event.payload.usage);
      if (!turnUsage) return;
      setLastTurnUsage(turnUsage);
      if (deps.connectionId) {
        useUsageStore.getState().recordUsage(deps.connectionId, {
          lastTurnUsage: turnUsage,
          source: 'acp',
          confidence: 'exact',
        });
      }
    },
  );

  const unlistenPermission = await listen<AcpPermissionRequestPayload>('acp-permission-request', (event) => {
    if (event.payload.instanceId !== deps.instanceId) return;
    // Session gate — same conservative rule as the session-update listener.
    if (deps.sessionId && event.payload.sessionId && event.payload.sessionId !== deps.sessionId) return;
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

    // Path filtering runs unconditionally and BEFORE auto-approval — a denied path
    // must stay denied even if the tool kind is on the auto-allow list. Mirrors the
    // kernel sandbox; the agent receives a normal tool error and narrates the denial
    // itself. We don't add a system message here because (a) the tool_call segment
    // already shows the error state and (b) the agent's response explains the why,
    // so a third deny notice is just noise. Log retained for debugging.
    const filterResult = isToolCallAllowed(toolInfo.kind, toolInfo.input, deps.pathFilterRoots, deps.homeDir);
    if (!filterResult.allowed) {
      const scopeLabel = deps.pathFilterRoots.length > 0 ? deps.pathFilterRoots.join(', ') : '(no project selected)';
      log.info('ai', `Chat tool call denied: ${toolInfo.title} targets ${filterResult.deniedPath} outside scope ${scopeLabel}`);
      deps.setLastActivityApprovalMode(deps.assistantMessageId, 'denied', cid);
      invoke('acp_permission_respond', { instanceId: deps.instanceId, requestId: payload.requestId, optionId: null }).catch(() => {}); // Expected: fire-and-forget deny
      return;
    }

    // Global kill-switch: `requireAllToolConfirmations` forces EVERY tool call
    // through the user-approval card, overriding built-in auto-allow and any
    // persisted "always allow" entries. The activity was optimistically tagged
    // 'auto' on `tool_call`; the PermissionCard will flip it to 'user' on
    // approval or 'denied' on rejection (handled where the decision is resolved).
    const requireAll = useSettingsStore.getState().requireAllToolConfirmations;

    // Scope-bound lookup (#6b angle 2): pass connection + active project so an
    // "always allow" granted for one project does not auto-approve in another.
    // Legacy unscoped (`null, null`) entries still wildcard-match — backward compat.
    const lookupConnectionId = deps.connectionId ?? null;
    const lookupProjectRoot = deps.activeProjectRoot ?? null;
    if (!requireAll && usePermissionStore.getState().isAutoAllowed(toolInfo.kind, lookupConnectionId, lookupProjectRoot)) {
      // Tool kinds in session or always allow-lists: auto-approve silently.
      // Activity already tagged 'auto' at creation time — no update needed.
      invoke('acp_permission_respond', {
        instanceId: deps.instanceId,
        requestId: payload.requestId,
        optionId: firstOptionId,
      }).catch(() => {}); // Expected: fire-and-forget auto-approve
    } else {
      // Write tools: add to permission store, let PermissionCard UI handle response.
      // Flip the activity's approvalMode from optimistic 'auto' to 'user' — the
      // user is being prompted. (If they later deny, the tool result/error
      // conveys that outcome; the 'user' badge reflects "user had to approve".)
      deps.setLastActivityApprovalMode(deps.assistantMessageId, 'user', cid);
      // Run is blocked on the user's decision — drives the orb "needs you" pulse
      // (#13) and the foreground-aware auto-deny timeout (#7). The next session
      // update flips it back to `running` via `runRunning` above (task #4).
      runAwaitingPermission(cid, payload.requestId);

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
        conversationId: cid,
      });
    }
  });

  return {
    // Compose the turn-usage teardown into the session-update handle so every
    // existing call site cleans it up without changes.
    unlisten: () => {
      unlisten();
      unlistenTurnUsage();
    },
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
  // Remove this cleanup from the owner's registry so a re-entrant or external
  // trigger can't run it twice (review #3 — was a single `cleanupRef`; now a
  // per-conversation map, so the closure deregisters itself by key).
  clearSelf: () => void,
  setLoading: (loading: boolean) => void,
  setActiveTool: (tool: string | null) => void,
  finalizeSegments: (messageId: number, convId?: string | null) => void,
  setMessageInterrupted: (messageId: number, convId?: string | null) => void,
  // Conversation that owns the message, so a background session's cleanup
  // finalizes/interrupts its OWN message, not the foreground one (task #3).
  conversationId: string | null = null,
): (cancelled?: boolean) => void {
  let cleaned = false;
  return (cancelled?: boolean) => {
    if (cleaned) return;
    cleaned = true;
    // Deregister first to prevent re-entrant calls
    clearSelf();
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
    finalizeSegments(assistantMessageId, conversationId);
    // Mark as interrupted if this was a user-initiated cancel
    if (cancelled) {
      setMessageInterrupted(assistantMessageId, conversationId);
    }
    setLoading(false);
    setActiveTool(null);
    // Turn ended (completed or cancelled) — clear the run. Error paths in
    // useAcpLifecycle override this with `runError` afterwards (task #4).
    runIdle(conversationId);
  };
}
