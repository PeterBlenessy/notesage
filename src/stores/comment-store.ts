import { create } from 'zustand';
import { tauriApi } from '@/lib/tauri';

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
}

interface CommentStore {
  commentsByDocument: Record<string, Comment[]>;
  activeCommentId: string | null;

  loadComments: (documentId: string, projectRoot: string) => Promise<void>;
  addComment: (comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>) => Comment;
  updateComment: (documentId: string, commentId: string, body: string) => void;
  deleteComment: (documentId: string, commentId: string) => void;
  setActiveComment: (id: string | null) => void;
  saveComments: (documentId: string, projectRoot: string) => Promise<void>;
  clearDocument: (documentId: string) => void;
}

export const useCommentStore = create<CommentStore>()((set, get) => ({
  commentsByDocument: {},
  activeCommentId: null,

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
