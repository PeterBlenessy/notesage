import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, Citation, AgentActivity, ToolCall, ToolCallActivity, SystemStatusType, Segment } from '@/lib/ai/types';
import { createTauriStorage } from '@/lib/tauri-storage';
import { getThread, getThreadResilient, getDescendants, getChildren, getLeaves } from '@/lib/chat-tree';
import { log } from '@/lib/logger';
// Note: the thread-slicing helper `sliceThreadBySegment` is declared below and
// exported for use by hooks/components that apply segment-based context isolation.
import { autoTitle, pruneConversations, pruneStaleProjectPaths as pruneStaleProjectPathsUtil } from '@/lib/conversationOps';
import {
  appendTextSegment as appendTextSegmentUtil,
  appendThinkingSegment as appendThinkingSegmentUtil,
  pushSegment as pushSegmentUtil,
  updateSegment as updateSegmentUtil,
  updateOrPushPlanSegment as updateOrPushPlanSegmentUtil,
  finalizeSegments as finalizeSegmentsUtil,
  resetAssistantMessage as resetAssistantMessageUtil,
} from '@/lib/segmentOps';
import type { PlanEntry } from '@/lib/ai/types';

/** Tracks a project context boundary within a conversation */
export interface ConversationSegment {
  projectPaths: string[];
  sessionId: string | null;
  /**
   * @deprecated Use `startMessageId` — numeric index is unstable under branching.
   * Kept in the type for backward compatibility during migration (v4 → v5).
   * New segments written by the store will still set this field (for safety if
   * code rolls back) but all slicing should be driven by `startMessageId`.
   */
  startMessageIndex: number;
  /**
   * Stable message-id anchor for the first post-boundary message. Walking the
   * active-leaf thread and locating this id gives correct slicing under branching.
   * When undefined, the segment boundary does not apply (slicing is a no-op).
   */
  startMessageId?: string;
  historyIncluded: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  projectPaths: string[];
  segments: ConversationSegment[];
  activeSegmentIndex: number;
  /** True when a project switch prompt is pending user decision */
  pendingProjectSwitch?: {
    newPaths: string[];
    previousPaths: string[];
  } | null;
  /** True when an agent switch prompt is pending user decision */
  pendingAgentSwitch?: {
    newAgent: string;
    previousAgent: string;
  } | null;
  sourceCommentId?: string;
  sourceDocumentId?: string;
  /** ACP session ID for session restoration via session/load */
  acpSessionId?: string;
  /**
   * User-selected ACP session permission mode (e.g. 'acceptEdits' = Agent) for this
   * conversation. Persisted so it survives agent respawns (scope changes spawn a fresh
   * session that resets to the agent's default mode). Falls back to the connection's
   * `acpDefaults.modeId` when unset. See `useAcpLifecycle` mode re-application.
   */
  agentModeId?: string;
  /**
   * Per-branch ACP session IDs, keyed by the new branch's first message ID (assigned when
   * the first message after branching is added). Populated only when `session/fork` was
   * used on a leaf-branch. Historical branches and pre-migration conversations continue
   * to share `acpSessionId`.
   */
  branchSessions?: Record<string, string>;
  /**
   * Staged fork session — waits for the next `addMessage` whose parentId matches to be
   * attached to `branchSessions`. Cleared after consumption or on any other mutation that
   * invalidates the pending fork (e.g. switching branches).
   */
  pendingBranchSession?: { parentId: string; sessionId: string } | null;
  /** ID of the leaf message in the currently active branch (null = no messages yet) */
  activeLeafId: string | null;
}

interface ChatStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: string | null;
  activeTool: string | null;
  /** Whether web search is enabled for AI chat. */
  webSearchEnabled: boolean;

  // ---------------------------------------------------------------------------
  // Conversation management
  // ---------------------------------------------------------------------------

  createConversation: (opts?: {
    title?: string;
    projectPaths?: string[];
    sourceCommentId?: string;
    sourceDocumentId?: string;
  }) => string;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  renameConversation: (id: string, title: string) => void;

  // ---------------------------------------------------------------------------
  // Message methods (scoped to active conversation)
  // ---------------------------------------------------------------------------

  addMessage: (message: ChatMessage, convId?: string | null) => void;
  // Streaming-write actions take an optional trailing `convId` so a background
  // session can address the conversation that OWNS the message; omitting it
  // targets the active conversation (today's behavior). See `updateConv` (task #3).
  updateMessage: (timestamp: number, content: string, citations?: Citation[], convId?: string | null) => void;
  deleteMessage: (timestamp: number) => void;
  /** Delete a message and all its descendants, reset activeLeafId to the message's parent. */
  deleteMessageAndDescendants: (messageId: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTool: (tool: string | null) => void;
  setSelectedProjectPaths: (paths: string[]) => void;
  toggleProjectPath: (path: string) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setMessageError: (timestamp: number, error: string, convId?: string | null) => void;
  /** Mark a message as interrupted (cancelled before completion) */
  setMessageInterrupted: (timestamp: number, convId?: string | null) => void;
  /** Store the ACP protocol-level message ID on a message (from agent echo). */
  setMessageAcpId: (timestamp: number, acpMessageId: string, convId?: string | null) => void;
  updateMessageThinking: (timestamp: number, thinking: string, convId?: string | null) => void;
  addActivity: (messageTimestamp: number, activity: AgentActivity, convId?: string | null) => void;
  completeLastActivity: (messageTimestamp: number, convId?: string | null) => void;
  completeAllActivities: (messageTimestamp: number, convId?: string | null) => void;
  /**
   * Patch the `approvalMode` on the most recent running activity (or last overall).
   * Used when a permission decision arrives after the activity is created
   * (ACP path: activity added on `tool_call`, decision made on `acp-permission-request`).
   */
  setLastActivityApprovalMode: (messageTimestamp: number, mode: import('@/lib/ai/types').ActivityApprovalMode, convId?: string | null) => void;
  addToolCallsToMessage: (messageTimestamp: number, toolCalls: ToolCall[]) => void;
  addToolCallActivity: (messageTimestamp: number, activity: ToolCallActivity) => void;
  updateToolCallActivity: (messageTimestamp: number, toolCallId: string, updates: Partial<ToolCallActivity>) => void;

  // ---------------------------------------------------------------------------
  // Segment methods (chronological message rendering)
  // ---------------------------------------------------------------------------

  /** Append text to the last text segment, or create a new text segment */
  appendTextSegment: (messageTimestamp: number, text: string, convId?: string | null) => void;
  /** Append text to the last thinking segment, or create a new thinking segment */
  appendThinkingSegment: (messageTimestamp: number, text: string, convId?: string | null) => void;
  /** Push a new segment to the message's segments array */
  pushSegment: (messageTimestamp: number, segment: Segment, convId?: string | null) => void;
  /** Update a segment by index with a partial patch */
  updateSegment: (messageTimestamp: number, index: number, patch: Partial<Segment>, convId?: string | null) => void;
  /** Update or push a plan segment (full replacement) */
  updateOrPushPlanSegment: (messageTimestamp: number, entries: PlanEntry[], convId?: string | null) => void;
  /** Finalize all segments: collapse thinking, mark running tool_calls as done */
  finalizeSegments: (messageTimestamp: number, convId?: string | null) => void;
  /** Reset an assistant message for retry — clears content, segments, error state */
  resetAssistantMessage: (timestamp: number, convId?: string | null) => void;

  // ---------------------------------------------------------------------------
  // System status messages (reconnection flow)
  // ---------------------------------------------------------------------------

  /**
   * Insert or update a system-status message in the active conversation.
   * - `reconnecting`: replaced in-place when attempt changes (same ID reused)
   * - `reconnected`: has `dismissAt` = now + 3s for auto-dismiss
   * - `failed`: static until user acts
   */
  addSystemStatus: (statusType: SystemStatusType, agentName: string, attempt?: number, maxAttempts?: number) => string;
  /** Remove a system-status message by ID (used for auto-dismiss). */
  removeSystemStatus: (messageId: string) => void;

  // ---------------------------------------------------------------------------
  // Branching
  // ---------------------------------------------------------------------------

  /** Create a branch starting after the message with the given timestamp */
  /**
   * Branch from a specific message. When `forkedSessionId` is provided (caller has
   * already obtained a fresh ACP session via `session/fork`), stage it as
   * `pendingBranchSession` so the next addMessage attaches the session to the new branch.
   */
  branchFromMessage: (messageTimestamp: number, forkedSessionId?: string) => void;
  /** Switch to a different branch by setting the active leaf */
  switchBranch: (leafId: string) => void;
  /** Delete a branch by its leaf ID (removes the first diverging message and all its descendants) */
  deleteBranch: (leafId: string) => void;

  // ---------------------------------------------------------------------------
  // Segment management (context isolation)
  // ---------------------------------------------------------------------------

  /** Set a pending project switch — shows prompt in chat, blocks sending */
  setPendingProjectSwitch: (newPaths: string[], previousPaths: string[]) => void;
  /** Resolve a pending project switch with the user's choice */
  resolveProjectSwitch: (includeHistory: boolean) => void;
  /** Set a pending agent switch — shows prompt in chat, blocks sending */
  setPendingAgentSwitch: (newAgent: string, previousAgent: string) => void;
  /** Resolve a pending agent switch with the user's choice */
  resolveAgentSwitch: (includeHistory: boolean) => void;
  /** Get the active segment for the current conversation */
  getActiveSegment: () => ConversationSegment | undefined;
  /** Update the session ID on the active segment */
  setSegmentSessionId: (sessionId: string) => void;
  /** Persist the user-selected ACP permission mode on the active conversation. */
  setConversationMode: (modeId: string) => void;

  /** Remove project paths that no longer exist from all conversations. */
  pruneStaleProjectPaths: (validPaths: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 500;
/** Conversations already warned about an orphaned thread — dedupes the log. Cleared on delete. */
const warnedOrphanThreads = new Set<string>();

/**
 * Monotonically increasing timestamp for conversation updates.
 * Date.now() can return the same value for rapid sequential calls (same millisecond),
 * which breaks the selectMessages selector cache — it uses updatedAt in its cache key,
 * so two updates with the same updatedAt cause a stale cache hit and missed re-renders.
 * This helper guarantees a unique, increasing value on every call.
 */
let _lastUpdatedAt = 0;
function nextUpdatedAt(): number {
  const now = Date.now();
  _lastUpdatedAt = now > _lastUpdatedAt ? now : _lastUpdatedAt + 1;
  return _lastUpdatedAt;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateActiveConv(
  state: { conversations: Conversation[]; activeConversationId: string | null },
  updater: (conv: Conversation) => Conversation,
): Partial<{ conversations: Conversation[] }> {
  if (!state.activeConversationId) return {};
  return {
    conversations: state.conversations.map((c) =>
      c.id === state.activeConversationId ? updater(c) : c
    ),
  };
}

/**
 * Apply `updater` to a SPECIFIC conversation by id, falling back to the active
 * conversation when `convId` is null/undefined.
 *
 * Streaming-write actions (segment/content/activity updates) route through this
 * so a background session's deltas land on the conversation that OWNS the
 * message — not on whatever the user is currently watching. Concurrent sessions
 * (PRD `2026-06-14-command-bar-session-multitasking`, task #3) each address
 * their own conversation by id; the foreground/`activeConversationId` is a pure
 * view selector. Callers that omit `convId` (UI actions operating on the visible
 * conversation) keep today's active-scoped behavior unchanged.
 */
function updateConv(
  state: { conversations: Conversation[]; activeConversationId: string | null },
  convId: string | null | undefined,
  updater: (conv: Conversation) => Conversation,
): Partial<{ conversations: Conversation[] }> {
  const targetId = convId ?? state.activeConversationId;
  if (!targetId) return {};
  return {
    conversations: state.conversations.map((c) =>
      c.id === targetId ? updater(c) : c
    ),
  };
}

// autoTitle and pruneConversations extracted to @/lib/conversationOps

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,
      activeTool: null,
      webSearchEnabled: false,

      // ----- Conversation management -----

      createConversation: (opts) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const initialPaths = opts?.projectPaths ?? [];
        const conv: Conversation = {
          id,
          title: opts?.title ?? '',
          messages: [],
          createdAt: now,
          updatedAt: nextUpdatedAt(),
          projectPaths: initialPaths,
          segments: [{
            projectPaths: initialPaths,
            sessionId: null,
            startMessageIndex: 0,
            historyIncluded: false,
          }],
          activeSegmentIndex: 0,
          pendingProjectSwitch: null,
          sourceCommentId: opts?.sourceCommentId,
          sourceDocumentId: opts?.sourceDocumentId,
          activeLeafId: null,
        };
        set((state) => {
          const updated = [conv, ...state.conversations];
          return {
            conversations: pruneConversations(updated, id, MAX_CONVERSATIONS),
            activeConversationId: id,
          };
        });
        return id;
      },

      deleteConversation: (id) => {
        warnedOrphanThreads.delete(id); // don't retain diagnostic state for a gone conversation
        set((state) => {
          const remaining = state.conversations.filter((c) => c.id !== id);
          let nextActive = state.activeConversationId;
          if (nextActive === id) {
            nextActive = remaining.length > 0 ? remaining[0].id : null;
          }
          return { conversations: remaining, activeConversationId: nextActive };
        });
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      renameConversation: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title } : c
          ),
        }));
      },

      // ----- Message methods (scoped to active conversation) -----

      addMessage: (message, convId) => {
        const state = get();
        // `convId` addresses a SPECIFIC conversation — used by a send that was
        // deferred by the concurrency cap, which must append to the chat it was
        // typed in even though the user has since navigated away (#468). Callers
        // that omit it target the active conversation (the common UI path).
        let activeId = convId ?? state.activeConversationId;

        // Auto-create conversation if none active. Only meaningful without an
        // explicit target: a deferred send always names an existing conversation.
        if (!activeId) {
          activeId = get().createConversation();
        }

        set((s) => {
          const conversations = s.conversations.map((c) => {
            if (c.id !== activeId) return c;
            const msgId = message.id ?? crypto.randomUUID();
            // parentId: use message's parentId if explicitly set, otherwise chain to current activeLeafId
            const parentId = message.parentId !== undefined ? message.parentId : (c.activeLeafId ?? null);
            const msg: ChatMessage = { ...message, id: msgId, parentId, timestamp: message.timestamp || Date.now() };
            // Auto-title on first user message
            const title = c.title || (message.role === 'user' ? autoTitle(message.content) : c.title);
            let messages = [...c.messages, msg];
            // Cap messages per conversation
            if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
              messages = messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION);
            }
            // If there's a staged fork session waiting for this parent, attach it
            // to the new message and clear the pending flag.
            let branchSessions = c.branchSessions;
            let pendingBranchSession = c.pendingBranchSession;
            if (pendingBranchSession && pendingBranchSession.parentId === parentId) {
              branchSessions = { ...(c.branchSessions ?? {}), [msgId]: pendingBranchSession.sessionId };
              pendingBranchSession = null;
            }
            // If the active segment was created with a future `startMessageIndex`
            // and has no stable `startMessageId` yet, adopt this new message's id
            // as the boundary anchor. (Task #28 — segment boundary as message id.)
            let segments = c.segments;
            const activeSegIdx = c.activeSegmentIndex;
            const activeSeg = segments[activeSegIdx];
            if (activeSeg && activeSeg.startMessageId === undefined && activeSegIdx > 0) {
              segments = segments.map((s, i) =>
                i === activeSegIdx ? { ...s, startMessageId: msgId } : s,
              );
            }
            return {
              ...c,
              messages,
              updatedAt: nextUpdatedAt(),
              title,
              activeLeafId: msgId,
              branchSessions,
              pendingBranchSession,
              segments,
            };
          });
          return { conversations: pruneConversations(conversations, activeId, MAX_CONVERSATIONS) };
        });
      },

      updateMessage: (timestamp, content, citations, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, content, ...(citations ? { citations } : {}) }
              : msg
          ),
          updatedAt: nextUpdatedAt(),
        }))),

      deleteMessage: (timestamp) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.filter((msg) => msg.timestamp !== timestamp),
          updatedAt: nextUpdatedAt(),
        }))),

      deleteMessageAndDescendants: (messageId) =>
        set((state) => updateActiveConv(state, (c) => {
          const msg = c.messages.find((m) => m.id === messageId);
          if (!msg) return c;
          const descendantIds = getDescendants(c.messages, messageId);
          return {
            ...c,
            messages: c.messages.filter((m) => !m.id || !descendantIds.has(m.id)),
            activeLeafId: msg.parentId ?? null,
            updatedAt: nextUpdatedAt(),
          };
        })),

      clearMessages: () => {
        // Delete the active conversation
        const active = get().activeConversationId;
        if (active) {
          get().deleteConversation(active);
        }
        set({ isLoading: false, error: null, activeTool: null });
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      setActiveTool: (tool) => set({ activeTool: tool }),

      setSelectedProjectPaths: (paths) =>
        set((state) => updateActiveConv(state, (c) => ({ ...c, projectPaths: paths }))),

      toggleProjectPath: (path) =>
        set((state) => updateActiveConv(state, (c) => {
          const has = c.projectPaths.includes(path);
          return {
            ...c,
            projectPaths: has
              ? c.projectPaths.filter((p) => p !== path)
              : [...c.projectPaths, path],
          };
        })),

      setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),

      setMessageError: (timestamp, error, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, content: error, isError: true }
              : msg
          ),
          updatedAt: nextUpdatedAt(),
        }))),

      setMessageInterrupted: (timestamp, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, interrupted: true }
              : msg
          ),
          updatedAt: nextUpdatedAt(),
        }))),

      setMessageAcpId: (timestamp, acpMessageId, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp && msg.acpMessageId !== acpMessageId
              ? { ...msg, acpMessageId }
              : msg
          ),
          updatedAt: nextUpdatedAt(),
        }))),

      updateMessageThinking: (timestamp, thinking, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, thinking }
              : msg
          ),
        }))),

      addActivity: (messageTimestamp, activity, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp
              ? { ...msg, activities: [...(msg.activities || []), activity] }
              : msg
          ),
        }))),

      completeLastActivity: (messageTimestamp, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) => {
            if (msg.timestamp !== messageTimestamp || !msg.activities) return msg;
            const lastRunningIdx = msg.activities.map((a) => a.status).lastIndexOf('running');
            if (lastRunningIdx === -1) return msg;
            const activities = msg.activities.map((a, i) =>
              i === lastRunningIdx ? { ...a, status: 'done' as const } : a
            );
            return { ...msg, activities };
          }),
        }))),

      completeAllActivities: (messageTimestamp, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) => {
            if (msg.timestamp !== messageTimestamp || !msg.activities) return msg;
            const activities = msg.activities.map((a) =>
              a.status === 'running' ? { ...a, status: 'done' as const } : a
            );
            return { ...msg, activities };
          }),
        }))),

      setLastActivityApprovalMode: (messageTimestamp, mode, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          messages: c.messages.map((msg) => {
            if (msg.timestamp !== messageTimestamp || !msg.activities || msg.activities.length === 0) return msg;
            const activities = [...msg.activities];
            let targetIdx = -1;
            for (let i = activities.length - 1; i >= 0; i--) {
              if (activities[i].status === 'running') { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = activities.length - 1;
            activities[targetIdx] = { ...activities[targetIdx], approvalMode: mode };
            return { ...msg, activities };
          }),
        }))),

      addToolCallsToMessage: (messageTimestamp, toolCalls) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp
              ? { ...msg, toolCalls: [...(msg.toolCalls || []), ...toolCalls] }
              : msg
          ),
        }))),

      addToolCallActivity: (messageTimestamp, activity) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp
              ? { ...msg, toolCallActivities: [...(msg.toolCallActivities || []), activity] }
              : msg
          ),
        }))),

      updateToolCallActivity: (messageTimestamp, toolCallId, updates) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) => {
            if (msg.timestamp !== messageTimestamp || !msg.toolCallActivities) return msg;
            return {
              ...msg,
              toolCallActivities: msg.toolCallActivities.map((a) =>
                a.id === toolCallId ? { ...a, ...updates } : a
              ),
            };
          }),
        }))),

      // ----- Segment methods -----

      appendTextSegment: (messageTimestamp, text, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? appendTextSegmentUtil(msg, text) : msg
          ),
        }))),

      appendThinkingSegment: (messageTimestamp, text, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? appendThinkingSegmentUtil(msg, text) : msg
          ),
        }))),

      pushSegment: (messageTimestamp, segment, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? pushSegmentUtil(msg, segment) : msg
          ),
        }))),

      updateSegment: (messageTimestamp, index, patch, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? updateSegmentUtil(msg, index, patch) : msg
          ),
        }))),

      updateOrPushPlanSegment: (messageTimestamp, entries, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? updateOrPushPlanSegmentUtil(msg, entries) : msg
          ),
        }))),

      finalizeSegments: (messageTimestamp, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? finalizeSegmentsUtil(msg) : msg
          ),
        }))),

      resetAssistantMessage: (messageTimestamp, convId) =>
        set((state) => updateConv(state, convId, (c) => ({
          ...c,
          updatedAt: nextUpdatedAt(),
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp ? resetAssistantMessageUtil(msg) : msg
          ),
        }))),

      // ----- System status messages -----

      addSystemStatus: (statusType, agentName, attempt, maxAttempts) => {
        const state = get();
        let activeId = state.activeConversationId;
        if (!activeId) {
          activeId = get().createConversation();
        }

        // For 'reconnecting', reuse the existing system-status message ID
        const conv = state.conversations.find((c) => c.id === activeId);
        const existing = conv?.messages.find(
          (m) => m.role === 'system-status' && m.statusType !== 'reconnected'
        );

        const msgId = existing?.id ?? crypto.randomUUID();
        const now = nextUpdatedAt();

        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== activeId) return c;

            // If updating an existing reconnecting message, replace in-place
            if (existing) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === msgId
                    ? {
                        ...m,
                        statusType,
                        attempt,
                        maxAttempts,
                        agentName,
                        dismissAt: statusType === 'reconnected' ? now + 3000 : undefined,
                        timestamp: now,
                      }
                    : m
                ),
                updatedAt: now,
              };
            }

            // Insert new system-status message
            const msg: ChatMessage = {
              role: 'system-status',
              content: '',
              id: msgId,
              parentId: c.activeLeafId ?? null,
              timestamp: now,
              statusType,
              attempt,
              maxAttempts,
              agentName,
              dismissAt: statusType === 'reconnected' ? now + 3000 : undefined,
            };
            return { ...c, messages: [...c.messages, msg], activeLeafId: msgId, updatedAt: now };
          }),
        }));

        return msgId;
      },

      removeSystemStatus: (messageId) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.filter((m) => m.id !== messageId),
          // If we removed the active leaf, fall back to previous
          activeLeafId: c.activeLeafId === messageId
            ? (c.messages.find((m) => m.id !== messageId && m.role !== 'system-status')?.id ?? null)
            : c.activeLeafId,
          updatedAt: nextUpdatedAt(),
        }))),

      // ----- Branching -----

      branchFromMessage: (messageTimestamp, forkedSessionId) =>
        set((state) => updateActiveConv(state, (c) => {
          const branchPoint = c.messages.find((m) => m.timestamp === messageTimestamp);
          if (!branchPoint?.id) return c;
          const next: Partial<Conversation> = { activeLeafId: branchPoint.id };
          if (forkedSessionId) {
            // Stage the fork session; it will be attached to the next new message's ID.
            next.pendingBranchSession = { parentId: branchPoint.id, sessionId: forkedSessionId };
          } else {
            // Clear any stale pending fork from an earlier abandoned branch click.
            next.pendingBranchSession = null;
          }
          return { ...c, ...next };
        })),

      switchBranch: (leafId) =>
        set((state) => updateActiveConv(state, (c) => {
          // Verify the leaf exists in this conversation
          if (!c.messages.some((m) => m.id === leafId)) return c;
          return { ...c, activeLeafId: leafId };
        })),

      deleteBranch: (leafId) =>
        set((state) => updateActiveConv(state, (c) => {
          // Walk from leaf to find the first message that diverges from the trunk
          const thread = getThread(c.messages, leafId);
          if (thread.length === 0) return c;

          // Find the branch root: the first message in this thread whose parent has multiple children
          let branchRootId: string | null = null;
          for (const msg of thread) {
            if (!msg.id) continue;
            const parentId = msg.parentId ?? null;
            const siblings = getChildren(c.messages, parentId);
            if (siblings.length > 1) {
              branchRootId = msg.id;
              break;
            }
          }

          // If no branch point found (single linear thread), don't delete
          if (!branchRootId) return c;

          // Collect all descendants of the branch root (the entire sub-tree to remove)
          const toRemove = getDescendants(c.messages, branchRootId);
          const remaining = c.messages.filter((m) => !m.id || !toRemove.has(m.id));

          // If the active branch was deleted, switch to a sibling
          let newLeafId = c.activeLeafId;
          if (newLeafId && toRemove.has(newLeafId)) {
            const leaves = getLeaves(remaining);
            newLeafId = leaves.length > 0 ? (leaves[leaves.length - 1].id ?? null) : null;
          }

          return { ...c, messages: remaining, activeLeafId: newLeafId, updatedAt: nextUpdatedAt() };
        })),

      // ----- Segment management -----

      setPendingProjectSwitch: (newPaths, previousPaths) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          pendingProjectSwitch: { newPaths, previousPaths },
        }))),

      resolveProjectSwitch: (includeHistory) =>
        set((state) => updateActiveConv(state, (c) => {
          if (!c.pendingProjectSwitch) return c;
          const newSegment: ConversationSegment = {
            projectPaths: c.pendingProjectSwitch.newPaths,
            sessionId: null,
            startMessageIndex: c.messages.length,
            historyIncluded: includeHistory,
          };
          return {
            ...c,
            projectPaths: c.pendingProjectSwitch.newPaths,
            segments: [...c.segments, newSegment],
            activeSegmentIndex: c.segments.length,
            pendingProjectSwitch: null,
          };
        })),

      setPendingAgentSwitch: (newAgent, previousAgent) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          pendingAgentSwitch: { newAgent, previousAgent },
        }))),

      resolveAgentSwitch: (includeHistory) =>
        set((state) => updateActiveConv(state, (c) => {
          if (!c.pendingAgentSwitch) return c;
          const newSegment: ConversationSegment = {
            projectPaths: c.projectPaths,
            sessionId: null,
            startMessageIndex: c.messages.length,
            historyIncluded: includeHistory,
          };
          return {
            ...c,
            segments: [...c.segments, newSegment],
            activeSegmentIndex: c.segments.length,
            pendingAgentSwitch: null,
          };
        })),

      getActiveSegment: () => {
        const state = get();
        if (!state.activeConversationId) return undefined;
        const conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (!conv) return undefined;
        return conv.segments[conv.activeSegmentIndex];
      },

      setSegmentSessionId: (sessionId) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          acpSessionId: sessionId,
          segments: c.segments.map((s, i) =>
            i === c.activeSegmentIndex ? { ...s, sessionId } : s
          ),
        }))),

      setConversationMode: (modeId) =>
        set((state) => updateActiveConv(state, (c) => ({ ...c, agentModeId: modeId }))),

      pruneStaleProjectPaths: (validPaths) =>
        set((state) => {
          const result = pruneStaleProjectPathsUtil(state.conversations, validPaths);
          return result.changed ? { conversations: result.conversations } : {};
        }),
    }),
    {
      name: 'notesage-chat-history',
      storage: createTauriStorage(),
      version: 5,
      // Exclude transient UI state from persistence to avoid excessive
      // writes during streaming (isLoading/activeTool toggle rapidly).
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        webSearchEnabled: state.webSearchEnabled,
      }),
      migrate: (persisted: unknown, version: number) => {
        let data = persisted as Record<string, unknown>;

        // v1 → v2: wrap flat messages into a conversation
        if (version < 2) {
          const old = data as {
            messages?: ChatMessage[];
            selectedProjectPaths?: string[];
            webSearchEnabled?: boolean;
          };
          const messages = old.messages ?? [];
          const conversations: Conversation[] = [];
          let activeConversationId: string | null = null;

          if (messages.length > 0) {
            const id = 'migrated-default';
            const paths = old.selectedProjectPaths ?? [];
            conversations.push({
              id,
              title: 'Chat History',
              messages,
              createdAt: messages[0]?.timestamp ?? Date.now(),
              updatedAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
              projectPaths: paths,
              segments: [{ projectPaths: paths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
              activeSegmentIndex: 0,
              pendingProjectSwitch: null,
              activeLeafId: messages.length > 0 ? (messages[messages.length - 1].id ?? null) : null,
            });
            activeConversationId = id;
          }

          data = {
            conversations,
            activeConversationId,
            isLoading: false,
            error: null,
            activeTool: null,
            webSearchEnabled: old.webSearchEnabled ?? false,
          };
          version = 2;
        }

        // v2 → v3: add segments to conversations
        if (version === 2) {
          const old = data as { conversations?: Conversation[]; [key: string]: unknown };
          if (old.conversations) {
            old.conversations = old.conversations.map((c) => ({
              ...c,
              segments: c.segments ?? [{
                projectPaths: c.projectPaths ?? [],
                sessionId: null,
                startMessageIndex: 0,
                historyIncluded: false,
              }],
              activeSegmentIndex: c.activeSegmentIndex ?? 0,
              pendingProjectSwitch: null,
            }));
          }
          data = old;
          version = 3;
        }

        // v3 → v4: add branching data (id, parentId, activeLeafId) to messages
        if (version === 3) {
          const old = data as { conversations?: Conversation[]; [key: string]: unknown };
          if (old.conversations) {
            old.conversations = old.conversations.map((c) => {
              let prevId: string | null = null;
              const messages = c.messages.map((m) => {
                const id = crypto.randomUUID();
                const updated = { ...m, id, parentId: prevId };
                prevId = id;
                return updated;
              });
              return { ...c, messages, activeLeafId: prevId };
            });
          }
          data = old;
          version = 4;
        }

        // v4 → v5: derive `startMessageId` on segments from the stored
        // `startMessageIndex` lookup at migration time. Stable id anchors are
        // required for correct slicing under branching (task #28).
        if (version === 4) {
          const old = data as { conversations?: Conversation[]; [key: string]: unknown };
          if (old.conversations) {
            old.conversations = old.conversations.map((c) => {
              if (!c.segments || c.segments.length === 0) return c;
              const segments = c.segments.map((seg) => {
                if (seg.startMessageId) return seg;
                const idx = seg.startMessageIndex;
                if (typeof idx !== 'number' || idx < 0 || idx >= c.messages.length) {
                  // No resolvable message — leave `startMessageId` undefined so
                  // slicing is a no-op (conservative: preserves context).
                  return seg;
                }
                const anchor = c.messages[idx]?.id;
                if (!anchor) return seg;
                return { ...seg, startMessageId: anchor };
              });
              return { ...c, segments };
            });
          }
          data = old;
        }

        // Fixup: ensure all conversations have activeLeafId set (may be undefined
        // for conversations created before the field was required)
        const fixup = data as { conversations?: Conversation[]; [key: string]: unknown };
        if (fixup.conversations) {
          fixup.conversations = fixup.conversations.map((c) => {
            if (c.activeLeafId !== undefined) return c;
            // Derive from last message in the conversation
            const lastMsg = c.messages[c.messages.length - 1];
            return { ...c, activeLeafId: lastMsg?.id ?? null };
          });
          data = fixup;
        }

        return data;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors — derive per-conversation values reactively
// ---------------------------------------------------------------------------

// Stable empty arrays to avoid unnecessary re-renders
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PATHS: string[] = [];
const EMPTY_SEGMENTS: ConversationSegment[] = [];

/**
 * Messages from the active branch of the active conversation.
 * Returns only the linear thread from root to activeLeafId.
 * Falls back to all messages for legacy conversations without branching data.
 *
 * IMPORTANT: Must return a stable reference when the result hasn't changed,
 * otherwise Zustand triggers infinite re-renders (new array !== old array).
 */
export const selectMessages = (() => {
  // Per-conversation thread memoization. A single shared slot (the previous
  // design) corrupts the moment two subscribers render different conversations
  // — each call overwrote the other's cached thread — and would thrash a
  // hypothetical side-by-side view (audit perf B4). Keying the cache by
  // conv.id isolates each conversation; the inner key still forces a recompute
  // on any message/leaf/update change. Bounded so a long session that touches
  // many conversations can't grow it without limit.
  const cache = new Map<string, { key: string; thread: ChatMessage[] }>();
  const MAX_ENTRIES = 32;

  return (state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): ChatMessage[] => {
    if (!state.activeConversationId) return EMPTY_MESSAGES;
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    if (!conv) return EMPTY_MESSAGES;

    // If conversation has branching data, return only the active thread
    if (conv.activeLeafId) {
      // Cache key: leaf id + message count + updatedAt — changes on every
      // message add/update/delete, ensuring cache invalidation.
      const key = `${conv.activeLeafId}:${conv.messages.length}:${conv.updatedAt}`;
      const entry = cache.get(conv.id);
      if (entry && entry.key === key) return entry.thread;

      // Resilient walk: an orphaned activeLeafId (parent chain references a
      // missing message) would make a plain getThread return just the leaf,
      // hiding all history. getThreadResilient falls back to the full thread
      // on corruption so history is never lost.
      const { thread, broken } = getThreadResilient(conv.messages, conv.activeLeafId);
      if (broken && !warnedOrphanThreads.has(conv.id)) {
        warnedOrphanThreads.add(conv.id);
        log.warn(
          'ai',
          `[chat] orphaned activeLeafId=${conv.activeLeafId} in conv=${conv.id} (${conv.messages.length} msgs) — recovered full history`,
        );
      } else if (!broken) {
        warnedOrphanThreads.delete(conv.id);
      }
      const result = thread.length > 0 ? thread : conv.messages;
      cache.set(conv.id, { key, thread: result });
      if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return result;
    }
    // Legacy conversations without activeLeafId: return all messages
    return conv.messages;
  };
})();

/** All messages from the active conversation (full tree, not just active branch). */
export function selectAllMessages(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): ChatMessage[] {
  if (!state.activeConversationId) return EMPTY_MESSAGES;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.messages ?? EMPTY_MESSAGES;
}

/** Active leaf ID from the active conversation. */
export function selectActiveLeafId(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): string | null {
  if (!state.activeConversationId) return null;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.activeLeafId ?? null;
}

/**
 * Slice a thread (ancestors-in-order, root → leaf) to drop pre-boundary messages
 * according to a segment's `startMessageId` anchor.
 *
 * Semantics (branch-aware):
 *   1. If the segment includes history (`historyIncluded` is true) or has no
 *      boundary anchor, return the thread unchanged.
 *   2. If `startMessageId` is found in the thread, drop all messages before it
 *      and return the rest (matching the linear `slice(N)` behaviour where the
 *      boundary message itself is included).
 *   3. If `startMessageId` is not in the thread, look up the boundary message in
 *      `allMessages` and find the lowest common ancestor (LCA) of the leaf's
 *      thread and the boundary's lineage. Drop everything in the thread up to
 *      and including the LCA — those messages were written pre-switch. Keep the
 *      rest, which were written on this branch post-switch.
 *   4. If the boundary message id can't be resolved at all (message deleted),
 *      return the thread unchanged — conservative fallback preserves context.
 */
export function sliceThreadBySegment(
  thread: ChatMessage[],
  segment: ConversationSegment | undefined,
  allMessages: ChatMessage[],
): ChatMessage[] {
  if (!segment) return thread;
  if (segment.historyIncluded) return thread;
  const anchorId = segment.startMessageId;
  if (!anchorId) return thread;

  // Case 1: boundary in thread
  const idx = thread.findIndex((m) => m.id === anchorId);
  if (idx >= 0) return thread.slice(idx);

  // Case 2: boundary in sibling subtree — find LCA and drop ancestors.
  const boundaryMsg = allMessages.find((m) => m.id === anchorId);
  if (!boundaryMsg) return thread;

  // Build boundary's ancestor set (all ids from boundary up to root).
  const byId = new Map<string, ChatMessage>();
  for (const m of allMessages) {
    if (m.id) byId.set(m.id, m);
  }
  const boundaryAncestors = new Set<string>();
  let cursor: ChatMessage | undefined = boundaryMsg;
  while (cursor?.id) {
    boundaryAncestors.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  // LCA = last (deepest) thread message whose id is in boundaryAncestors.
  let lcaIdx = -1;
  for (let i = thread.length - 1; i >= 0; i--) {
    const tid = thread[i].id;
    if (tid && boundaryAncestors.has(tid)) {
      lcaIdx = i;
      break;
    }
  }
  if (lcaIdx === -1) return thread; // no common ancestor: unrelated branches
  return thread.slice(lcaIdx + 1);
}

/**
 * Resolve the ACP session ID to use for a given branch leaf.
 *
 * Walks the leaf's ancestor chain and returns the first branch-specific session
 * found in `branchSessions`. Falls back to the conversation-level `acpSessionId`
 * when no branch match is found — preserves pre-fork behavior for existing chats
 * and for historical (non-leaf) branching.
 */
export function getSessionIdForLeaf(conv: Conversation, leafId: string | null): string | undefined {
  if (!conv.branchSessions || Object.keys(conv.branchSessions).length === 0) {
    return conv.acpSessionId;
  }
  if (leafId) {
    // Check direct hit first (cheap)
    const direct = conv.branchSessions[leafId];
    if (direct) return direct;
    // Walk up the thread and return the first ancestor with a branch session.
    const thread = getThread(conv.messages, leafId);
    for (let i = thread.length - 1; i >= 0; i--) {
      const id = thread[i].id;
      if (id && conv.branchSessions[id]) return conv.branchSessions[id];
    }
  }
  return conv.acpSessionId;
}

/** Project paths from the active conversation. Use: `useChatStore(selectProjectPaths)` */
export function selectProjectPaths(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): string[] {
  if (!state.activeConversationId) return EMPTY_PATHS;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.projectPaths ?? EMPTY_PATHS;
}

/**
 * Display title shown for a conversation that has no user/auto-assigned title
 * yet. Single source of truth (review #8) — `CommandBarHistory`, `ChatHistoryView`,
 * `AgentPanel`, and `useSessionManager` all resolved this inline and one used
 * `'Chat'` while the rest used `'New Chat'`.
 */
export const DEFAULT_CONVERSATION_TITLE = 'New Chat';

/**
 * The display title for a conversation by id — its own `title`, or
 * {@link DEFAULT_CONVERSATION_TITLE} when unset/blank. Returns the default for an
 * unknown id too, so callers can render without a presence check.
 */
export function selectConversationTitle(
  state: Pick<ChatStore, 'conversations'>,
  conversationId: string | null | undefined,
): string {
  if (!conversationId) return DEFAULT_CONVERSATION_TITLE;
  return state.conversations.find((c) => c.id === conversationId)?.title || DEFAULT_CONVERSATION_TITLE;
}

/** Pending project switch from the active conversation. */
export function selectPendingProjectSwitch(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): Conversation['pendingProjectSwitch'] {
  if (!state.activeConversationId) return null;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.pendingProjectSwitch ?? null;
}

/** Pending agent switch from the active conversation. */
export function selectPendingAgentSwitch(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): Conversation['pendingAgentSwitch'] {
  if (!state.activeConversationId) return null;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.pendingAgentSwitch ?? null;
}

/** Segments from the active conversation. */
export function selectSegments(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): ConversationSegment[] {
  if (!state.activeConversationId) return EMPTY_SEGMENTS;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.segments ?? EMPTY_SEGMENTS;
}

/** Active segment index from the active conversation. */
export function selectActiveSegmentIndex(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): number {
  if (!state.activeConversationId) return 0;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.activeSegmentIndex ?? 0;
}

// (empty constants moved above selectors)
