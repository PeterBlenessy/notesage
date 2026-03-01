import { create } from 'zustand';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';

export interface CommentReply {
  id: string;
  body: string;
  author: string;
  timestamp: number;
}

export type CommentStatus = 'open' | 'delegated' | 'done' | 'resolved';

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
}

interface CommentStore {
  commentsByDocument: Record<string, Comment[]>;
  activeCommentId: string | null;
  /** Runtime-only activity log per comment (not persisted) */
  activitiesByComment: Record<string, DelegationActivity[]>;
  /** Increments when partialReplies map changes — subscribe to trigger re-renders */
  partialReplyVersion: number;

  loadComments: (documentId: string, projectRoot: string) => Promise<void>;
  addComment: (comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>) => Comment;
  updateComment: (documentId: string, commentId: string, body: string) => void;
  deleteComment: (documentId: string, commentId: string) => void;
  addReply: (documentId: string, commentId: string, body: string, author: string) => void;
  setCommentStatus: (documentId: string, commentId: string, status: CommentStatus) => void;
  setTaskId: (documentId: string, commentId: string, taskId: string) => void;
  addActivity: (commentId: string, activity: DelegationActivity) => void;
  completeLastActivity: (commentId: string) => void;
  completeAllActivities: (commentId: string) => void;
  clearActivities: (commentId: string) => void;
  setActiveComment: (id: string | null) => void;
  saveComments: (documentId: string, projectRoot: string) => Promise<void>;
  clearDocument: (documentId: string) => void;
}

export const useCommentStore = create<CommentStore>()((set, get) => ({
  commentsByDocument: {},
  activeCommentId: null,
  activitiesByComment: {},
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
      const comments: Comment[] = JSON.parse(raw);
      set((state) => ({
        commentsByDocument: { ...state.commentsByDocument, [documentId]: comments },
      }));
    } catch (error) {
      console.error('Failed to load comments:', error);
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
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.filter((c) => c.id !== commentId),
        },
        activeCommentId: state.activeCommentId === commentId ? null : state.activeCommentId,
      };
    });
  },

  addReply: (documentId: string, commentId: string, body: string, author: string) => {
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
                    { id: crypto.randomUUID(), body, author, timestamp: Date.now() },
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
    set((state) => {
      const comments = state.commentsByDocument[documentId] ?? [];
      return {
        commentsByDocument: {
          ...state.commentsByDocument,
          [documentId]: comments.map((c) =>
            c.id === commentId ? { ...c, status, updatedAt: Date.now() } : c
          ),
        },
      };
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

  setActiveComment: (id: string | null) => {
    set({ activeCommentId: id });
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
      console.error('Failed to save comments:', error);
      toast.error(`Failed to save comments: ${error}`);
    }
  },

  clearDocument: (documentId: string) => {
    set((state) => {
      const { [documentId]: _, ...rest } = state.commentsByDocument;
      return {
        commentsByDocument: rest,
        activeCommentId: state.activeCommentId &&
          (state.commentsByDocument[documentId] ?? []).some((c) => c.id === state.activeCommentId)
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
