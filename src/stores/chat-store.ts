import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, Citation, AgentActivity } from '@/lib/ai/types';
import { createTauriStorage } from '@/lib/tauri-storage';

/** Tracks a project context boundary within a conversation */
export interface ConversationSegment {
  projectPaths: string[];
  sessionId: string | null;
  startMessageIndex: number;
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
  sourceCommentId?: string;
  sourceDocumentId?: string;
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

  addMessage: (message: ChatMessage) => void;
  updateMessage: (timestamp: number, content: string, citations?: Citation[]) => void;
  deleteMessage: (timestamp: number) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTool: (tool: string | null) => void;
  setSelectedProjectPaths: (paths: string[]) => void;
  toggleProjectPath: (path: string) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setMessageError: (timestamp: number, error: string) => void;
  updateMessageThinking: (timestamp: number, thinking: string) => void;
  addActivity: (messageTimestamp: number, activity: AgentActivity) => void;
  completeLastActivity: (messageTimestamp: number) => void;
  completeAllActivities: (messageTimestamp: number) => void;

  // ---------------------------------------------------------------------------
  // Segment management (context isolation)
  // ---------------------------------------------------------------------------

  /** Set a pending project switch — shows prompt in chat, blocks sending */
  setPendingProjectSwitch: (newPaths: string[], previousPaths: string[]) => void;
  /** Resolve a pending project switch with the user's choice */
  resolveProjectSwitch: (includeHistory: boolean) => void;
  /** Get the active segment for the current conversation */
  getActiveSegment: () => ConversationSegment | undefined;
  /** Update the session ID on the active segment */
  setSegmentSessionId: (sessionId: string) => void;

  /** Remove project paths that no longer exist from all conversations. */
  pruneStaleProjectPaths: (validPaths: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 500;

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

function autoTitle(content: string): string {
  const first = content.split('\n')[0] || content;
  return first.length > 50 ? first.slice(0, 50) + '\u2026' : first;
}

/** Remove the oldest inactive conversations until count <= MAX_CONVERSATIONS. */
function pruneConversations(
  conversations: Conversation[],
  activeId: string | null,
): Conversation[] {
  if (conversations.length <= MAX_CONVERSATIONS) return conversations;
  // Sort by updatedAt ascending (oldest first) to find prune candidates
  const sorted = [...conversations].sort((a, b) => a.updatedAt - b.updatedAt);
  const toRemove = new Set<string>();
  for (const conv of sorted) {
    if (conversations.length - toRemove.size <= MAX_CONVERSATIONS) break;
    if (conv.id !== activeId) {
      toRemove.add(conv.id);
    }
  }
  return toRemove.size > 0
    ? conversations.filter((c) => !toRemove.has(c.id))
    : conversations;
}

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
          updatedAt: now,
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
        };
        set((state) => {
          const updated = [conv, ...state.conversations];
          return {
            conversations: pruneConversations(updated, id),
            activeConversationId: id,
          };
        });
        return id;
      },

      deleteConversation: (id) => {
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

      addMessage: (message) => {
        const state = get();
        let activeId = state.activeConversationId;

        // Auto-create conversation if none active
        if (!activeId) {
          activeId = get().createConversation();
        }

        set((s) => {
          const conversations = s.conversations.map((c) => {
            if (c.id !== activeId) return c;
            const msg = { ...message, timestamp: message.timestamp || Date.now() };
            // Auto-title on first user message
            const title = c.title || (message.role === 'user' ? autoTitle(message.content) : c.title);
            let messages = [...c.messages, msg];
            // Cap messages per conversation
            if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
              messages = messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION);
            }
            return { ...c, messages, updatedAt: Date.now(), title };
          });
          return { conversations: pruneConversations(conversations, activeId) };
        });
      },

      updateMessage: (timestamp, content, citations) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, content, ...(citations ? { citations } : {}) }
              : msg
          ),
          updatedAt: Date.now(),
        }))),

      deleteMessage: (timestamp) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.filter((msg) => msg.timestamp !== timestamp),
          updatedAt: Date.now(),
        }))),

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

      setMessageError: (timestamp, error) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, content: error, isError: true }
              : msg
          ),
          updatedAt: Date.now(),
        }))),

      updateMessageThinking: (timestamp, thinking) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === timestamp
              ? { ...msg, thinking }
              : msg
          ),
        }))),

      addActivity: (messageTimestamp, activity) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.timestamp === messageTimestamp
              ? { ...msg, activities: [...(msg.activities || []), activity] }
              : msg
          ),
        }))),

      completeLastActivity: (messageTimestamp) =>
        set((state) => updateActiveConv(state, (c) => ({
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

      completeAllActivities: (messageTimestamp) =>
        set((state) => updateActiveConv(state, (c) => ({
          ...c,
          messages: c.messages.map((msg) => {
            if (msg.timestamp !== messageTimestamp || !msg.activities) return msg;
            const activities = msg.activities.map((a) =>
              a.status === 'running' ? { ...a, status: 'done' as const } : a
            );
            return { ...msg, activities };
          }),
        }))),

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
          segments: c.segments.map((s, i) =>
            i === c.activeSegmentIndex ? { ...s, sessionId } : s
          ),
        }))),

      pruneStaleProjectPaths: (validPaths) =>
        set((state) => {
          let changed = false;
          const conversations = state.conversations.map((c) => {
            const filtered = c.projectPaths.filter((p) => validPaths.has(p));
            if (filtered.length === c.projectPaths.length) return c;
            changed = true;
            return { ...c, projectPaths: filtered };
          });
          return changed ? { conversations } : {};
        }),
    }),
    {
      name: 'notesage-chat-history',
      storage: createTauriStorage(),
      version: 3,
      // Exclude transient UI state from persistence to avoid excessive
      // writes during streaming (isLoading/activeTool toggle rapidly).
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        webSearchEnabled: state.webSearchEnabled,
      }),
      migrate: (persisted: unknown, version: number) => {
        // v2 → v3: add segments to conversations
        if (version === 2) {
          const old = persisted as { conversations?: Conversation[]; [key: string]: unknown };
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
          return old;
        }
        if (version < 2) {
          // v1 → v2: wrap flat messages into a conversation
          const old = persisted as {
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
            });
            activeConversationId = id;
          }

          return {
            conversations,
            activeConversationId,
            isLoading: false,
            error: null,
            activeTool: null,
            webSearchEnabled: old.webSearchEnabled ?? false,
          };
        }
        return persisted;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors — derive per-conversation values reactively
// ---------------------------------------------------------------------------

/** Messages from the active conversation. Use: `useChatStore(selectMessages)` */
export function selectMessages(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): ChatMessage[] {
  if (!state.activeConversationId) return EMPTY_MESSAGES;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.messages ?? EMPTY_MESSAGES;
}

/** Project paths from the active conversation. Use: `useChatStore(selectProjectPaths)` */
export function selectProjectPaths(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): string[] {
  if (!state.activeConversationId) return EMPTY_PATHS;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.projectPaths ?? EMPTY_PATHS;
}

/** Pending project switch from the active conversation. */
export function selectPendingProjectSwitch(state: Pick<ChatStore, 'conversations' | 'activeConversationId'>): Conversation['pendingProjectSwitch'] {
  if (!state.activeConversationId) return null;
  return state.conversations.find((c) => c.id === state.activeConversationId)?.pendingProjectSwitch ?? null;
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

// Stable empty arrays to avoid unnecessary re-renders
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PATHS: string[] = [];
const EMPTY_SEGMENTS: ConversationSegment[] = [];
