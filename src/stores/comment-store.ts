import { create } from 'zustand';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';

export interface CommentReply {
  id: string;
  body: string;
  author: string;
  timestamp: number;
  activities?: DelegationActivity[];
}

export type CommentStatus = 'open' | 'delegated' | 'done' | 'resolved';
export type DelegationMode = 'chat' | 'delegate';

export interface DelegationActivity {
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'info' | 'error';
  timestamp: number;
}

export interface Comment {
  id: string;
  documentId: string;
  /** Anchor text snippet for fuzzy re-anchoring after edits */
  anchorText: string;
  /** ProseMirror position range at creation time */
  from: number;
  to: number;
  body: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  replies?: CommentReply[];
  status?: CommentStatus;
  taskId?: string;
  linkedConversationId?: string;
}

interface CommentStore {
  commentsByDocument: Record<string, Comment[]>;
  activeCommentId: string | null;
  /** When set, Editor.tsx scrolls to this comment's position before activating it */
  scrollToCommentId: string | null;
  /** Runtime-only activity log per comment (not persisted) */
  activitiesByComment: Record<string, DelegationActivity[]>;
  /** Runtime-only delegation mode per comment: 'chat' (popover stays open) or 'delegate' (background) */
  delegationModeByComment: Record<string, DelegationMode>;
  /** Increments when partialReplies map changes — subscribe to trigger re-renders */
  partialReplyVersion: number;

  loadComments: (documentId: string, projectRoot: string) => Promise<void>;
  addComment: (comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>) => Comment;
  updateComment: (documentId: string, commentId: string, body: string) => void;
  deleteComment: (documentId: string, commentId: string) => void;
  addReply: (documentId: string, commentId: string, body: string, author: string, activities?: DelegationActivity[]) => void;
  setCommentStatus: (documentId: string, commentId: string, status: CommentStatus) => void;
  setTaskId: (documentId: string, commentId: string, taskId: string) => void;
  setLinkedConversation: (documentId: string, commentId: string, conversationId: string) => void;
  addActivity: (commentId: string, activity: DelegationActivity) => void;
  completeLastActivity: (commentId: string) => void;
  completeAllActivities: (commentId: string) => void;
  clearActivities: (commentId: string) => void;
  setDelegationMode: (commentId: string, mode: DelegationMode) => void;
  clearDelegationMode: (commentId: string) => void;
  setActiveComment: (id: string | null) => void;
  /** Scroll to a comment's position and then activate it (used by external navigation) */
  requestScrollToComment: (id: string) => void;
  clearScrollToComment: () => void;
  updateCommentPositions: (documentId: string, positions: Array<{id: string; from: number; to: number; anchorText: string}>) => void;
  saveComments: (documentId: string, projectRoot: string) => Promise<void>;
  clearDocument: (documentId: string) => void;
}

export const useCommentStore = create<CommentStore>()((set, get) => ({
  commentsByDocument: {},
  activeCommentId: null,
  scrollToCommentId: null,
  activitiesByComment: {},
  delegationModeByComment: {},
  partialReplyVersion: 0,

  loadComments: async (documentId: string, projectRoot: string) => {
    const filePath = `${projectRoot}/.notesage/comments/${documentId}.json`;
    try {
      const exists = await tauriApi.pathExists(filePath);
      if (!exists) {
        set((state) => ({
          commentsByDocument: { ...state.commentsByDocument, [documentId]: [] },
        }));
        return;
      }
      const raw = await tauriApi.readFile(filePath);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseError) {
        console.error('Failed to parse comment file:', filePath, parseError);
        log.error('comments', `Failed to parse comment file: ${filePath}`, parseError);
        toast.error('Failed to load comments — file may be corrupted');
        set((state) => ({
          commentsByDocument: { ...state.commentsByDocument, [documentId]: [] },
        }));
        return;
      }
      const comments: Comment[] = (parsed as Comment[]).map((c: Comment) => {
        // Reset 'delegated' status on load — agent sessions don't survive restart
        if (c.status === 'delegated') {
          return { ...c, status: (c.replies && c.replies.length > 0) ? 'done' : 'open' };
        }
        return c;
      });
      set((state) => ({
        commentsByDocument: { ...state.commentsByDocument, [documentId]: comments },
      }));
    } catch (error) {
      console.error('Failed to load comment file:', filePath, error);
      log.error('comments', `Failed to load comments from ${filePath}`, error);
      set((state) => ({
        commentsByDocument: { ...state.commentsByDocument, [documentId]: [] },
      }));
    }
  },

  addComment: (partial) => {
    const now = Date.now();
    const comment: Comment = {
      ...partial,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => {
      const existing = state.commentsByDocument[partial.documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [partial.documentId]: [...existing, comment],
        },
      };
    });
    return comment;
  },

  updateComment: (documentId: string, commentId: string, body: string) => {
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId ? { ...c, body, updatedAt: Date.now() } : c
          ),
        },
      };
    });
  },

  deleteComment: (documentId: string, commentId: string) => {
    // Clean up runtime state for the deleted comment
    delete partialReplies[partialKey(documentId, commentId)];
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      const { [commentId]: _, ...restActivities } = state.activitiesByComment;
      const { [commentId]: __, ...restModes } = state.delegationModeByComment;
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.filter((c) => c.id !== commentId),
        },
        activitiesByComment: restActivities,
        delegationModeByComment: restModes,
        activeCommentId: state.activeCommentId === commentId ? null : state.activeCommentId,
      };
    });
  },

  addReply: (documentId: string, commentId: string, body: string, author: string, activities?: DelegationActivity[]) => {
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  replies: [
                    ...(c.replies ?? []),
                    { id: crypto.randomUUID(), body, author, timestamp: Date.now(), activities },
                  ],
                  updatedAt: Date.now(),
                }
              : c
          ),
        },
      };
    });
  },

  setCommentStatus: (documentId: string, commentId: string, status: CommentStatus) => {
    // When resolving, clean up runtime state for this comment
    if (status === 'resolved') {
      clearPartialReply(documentId, commentId);
    }
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      const base: Partial<CommentStore> = {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId ? { ...c, status, updatedAt: Date.now() } : c
          ),
        },
      };
      if (status === 'resolved') {
        const { [commentId]: _, ...restActivities } = state.activitiesByComment;
        const { [commentId]: __, ...restModes } = state.delegationModeByComment;
        base.activitiesByComment = restActivities;
        base.delegationModeByComment = restModes;
      }
      return base;
    });
  },

  setTaskId: (documentId: string, commentId: string, taskId: string) => {
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId ? { ...c, taskId, updatedAt: Date.now() } : c
          ),
        },
      };
    });
  },

  setLinkedConversation: (documentId: string, commentId: string, conversationId: string) => {
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId ? { ...c, linkedConversationId: conversationId, updatedAt: Date.now() } : c
          ),
        },
      };
    });
  },

  addActivity: (commentId: string, activity: DelegationActivity) => {
    set((state) => ({
      activitiesByComment: {
        ...state.activitiesByComment,
        [commentId]: [...(state.activitiesByComment[commentId] ?? []), activity],
      },
    }));
  },

  completeLastActivity: (commentId: string) => {
    set((state) => {
      const activities = state.activitiesByComment[commentId];
      if (!activities || activities.length === 0) return state;
      const updated = [...activities];
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].status === 'running') {
          updated[i] = { ...updated[i], status: 'done' };
          break;
        }
      }
      return { activitiesByComment: { ...state.activitiesByComment, [commentId]: updated } };
    });
  },

  completeAllActivities: (commentId: string) => {
    set((state) => {
      const activities = state.activitiesByComment[commentId];
      if (!activities || activities.length === 0) return state;
      const updated = activities.map((a) =>
        a.status === 'running' ? { ...a, status: 'done' as const } : a
      );
      return { activitiesByComment: { ...state.activitiesByComment, [commentId]: updated } };
    });
  },

  clearActivities: (commentId: string) => {
    set((state) => {
      const { [commentId]: _, ...rest } = state.activitiesByComment;
      return { activitiesByComment: rest };
    });
  },

  setDelegationMode: (commentId: string, mode: DelegationMode) => {
    set((state) => ({
      delegationModeByComment: { ...state.delegationModeByComment, [commentId]: mode },
    }));
  },

  clearDelegationMode: (commentId: string) => {
    set((state) => {
      const { [commentId]: _, ...rest } = state.delegationModeByComment;
      return { delegationModeByComment: rest };
    });
  },

  setActiveComment: (id: string | null) => {
    set({ activeCommentId: id });
  },

  requestScrollToComment: (id: string) => {
    set({ scrollToCommentId: id });
  },

  clearScrollToComment: () => {
    set({ scrollToCommentId: null });
  },

  updateCommentPositions: (documentId, positions) => {
    set((state) => {
      const comments = state.commentsByDocument[documentId];
      if (!comments || comments.length === 0) return state;
      const posMap = new Map(positions.map((p) => [p.id, p]));
      let changed = false;
      const updated = comments.map((c) => {
        const pos = posMap.get(c.id);
        if (!pos) return c;
        if (pos.from === c.from && pos.to === c.to && pos.anchorText === c.anchorText) return c;
        changed = true;
        return { ...c, from: pos.from, to: pos.to, anchorText: pos.anchorText };
      });
      if (!changed) return state;
      return {
        commentsByDocument: { ...state.commentsByDocument, [documentId]: updated },
      };
    });
  },

  saveComments: async (documentId: string, projectRoot: string) => {
    const comments = get().commentsByDocument[documentId] ?? [];
    const dirPath = `${projectRoot}/.notesage/comments`;
    const filePath = `${dirPath}/${documentId}.json`;
    try {
      // Ensure directory exists
      const dirExists = await tauriApi.pathExists(dirPath);
      if (!dirExists) {
        const notesageDir = `${projectRoot}/.notesage`;
        const notesageDirExists = await tauriApi.pathExists(notesageDir);
        if (!notesageDirExists) {
          await tauriApi.createDirectory(notesageDir);
        }
        await tauriApi.createDirectory(dirPath);
      }
      await tauriApi.writeFile(filePath, JSON.stringify(comments, null, 2));
    } catch (error) {
      log.error('comments', 'Failed to save comments', error);
      toast.error(`Failed to save comments: ${error}`);
    }
  },

  clearDocument: (documentId: string) => {
    // Clean up partial replies, activities, and delegation modes for all comments in this document
    const comments = get().commentsByDocument[documentId] ?? [];
    for (const c of comments) {
      delete partialReplies[partialKey(documentId, c.id)];
    }
    set((state) => {
      const { [documentId]: _, ...rest } = state.commentsByDocument;
      const cleanedActivities = { ...state.activitiesByComment };
      const cleanedModes = { ...state.delegationModeByComment };
      for (const c of comments) {
        delete cleanedActivities[c.id];
        delete cleanedModes[c.id];
      }
      return {
        commentsByDocument: rest,
        activitiesByComment: cleanedActivities,
        delegationModeByComment: cleanedModes,
        activeCommentId: state.activeCommentId &&
          comments.some((c) => c.id === state.activeCommentId)
          ? null
          : state.activeCommentId,
      };
    });
  },
}));

// ---------------------------------------------------------------------------
// Partial reply tracking (module-level, NOT in Zustand state)
//
// Streaming chunks arrive very frequently. Storing them in Zustand state would
// cause the entire comment tree to re-render on every chunk. Instead we keep
// a module-level map and expose a Zustand counter (partialReplyVersion) that
// components can subscribe to for efficient updates.
// ---------------------------------------------------------------------------

const partialReplies: Record<string, string> = {};

function partialKey(documentId: string, commentId: string): string {
  return `${documentId}:${commentId}`;
}

export function appendPartialReply(documentId: string, commentId: string, chunk: string): void {
  const key = partialKey(documentId, commentId);
  partialReplies[key] = (partialReplies[key] ?? '') + chunk;
  useCommentStore.setState((s) => ({ partialReplyVersion: s.partialReplyVersion + 1 }));
}

export function getPartialReply(documentId: string, commentId: string): string | undefined {
  return partialReplies[partialKey(documentId, commentId)] || undefined;
}

export function clearPartialReply(documentId: string, commentId: string): void {
  delete partialReplies[partialKey(documentId, commentId)];
  useCommentStore.setState((s) => ({ partialReplyVersion: s.partialReplyVersion + 1 }));
}
