import { useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCommentStore } from '@/stores/comment-store';
import type { Comment } from '@/stores/comment-store';
import { useActiveProject } from '@/hooks/useActiveProject';
import { ensureDocumentId } from '@/lib/frontmatter';
import { updateDocumentIndex } from '@/lib/document-index';
import {
  setCommentDecorations,
  clearCommentDecorations,
  CommentMarkPluginKey,
} from '@/components/editor/extensions';

/** Simple deterministic hash of a string → hex string (for filename-safe comment keys). */
function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

/**
 * Orchestrates the full comment lifecycle: load, create, edit, delete, save.
 * Connects comment-store ↔ editor decorations ↔ sidecar JSON persistence.
 *
 * Project files use a UUID (from frontmatter) as the comment key — survives renames.
 * Non-project files use a hash of the file path — no frontmatter modification.
 */
export function useCommentOperations(editor: Editor | null) {
  const { projectPath } = useActiveProject();
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  // Project-scoped storage if file is in a project, otherwise fall back to the Notesage library
  const storageRoot = projectPath ?? (notesRootPath && !notesRootPath.startsWith('~') ? notesRootPath : null);
  const isProjectFile = !!projectPath;
  const activeTab = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const updateFrontmatter = useEditorStore((s) => s.updateFrontmatter);

  const {
    commentsByDocument,
    activeCommentId,
    loadComments,
    addComment,
    updateComment,
    deleteComment,
    setActiveComment,
    saveComments,
    clearDocument,
    updateCommentPositions,
    delegationModeByComment,
  } = useCommentStore();

  const lastLoadedKeyRef = useRef<string | null>(null);

  // Get document ID from current tab's frontmatter (project files only)
  const documentId = (activeTab?.frontmatter?.id as string) ?? null;

  // Comment key: UUID for project files, path hash for non-project files
  const commentKey = isProjectFile ? documentId : (activeTab?.filePath ? hashPath(activeTab.filePath) : null);

  // Load comments when opening a file
  useEffect(() => {
    if (!commentKey || !storageRoot) {
      // Clear decorations if no comment key
      if (editor && lastLoadedKeyRef.current) {
        clearCommentDecorations(editor);
        lastLoadedKeyRef.current = null;
      }
      return;
    }

    if (commentKey === lastLoadedKeyRef.current) return;
    lastLoadedKeyRef.current = commentKey;

    loadComments(commentKey, storageRoot);
  }, [commentKey, storageRoot, editor, loadComments]);

  // Sync remapped positions from plugin → store on every document change,
  // and debounce-save to disk so tab switches see current positions.
  const positionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor || !commentKey || !storageRoot) return;

    const handleDocChanged = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      const pluginState = CommentMarkPluginKey.getState(editor.state);
      if (!pluginState?.comments?.length) return;

      const doc = editor.state.doc;
      const positions = (pluginState.comments as Array<{ commentId: string; from: number; to: number }>)
        .filter((c) => c.from < c.to && c.to <= doc.content.size)
        .map((c) => ({
          id: c.commentId,
          from: c.from,
          to: c.to,
          anchorText: doc.textBetween(c.from, c.to, '\n'),
        }));

      updateCommentPositions(commentKey, positions);

      // Debounce save to disk (2s after last edit)
      if (positionSaveTimeoutRef.current) clearTimeout(positionSaveTimeoutRef.current);
      positionSaveTimeoutRef.current = setTimeout(() => {
        saveComments(commentKey, storageRoot);
      }, 2000);
    };

    editor.on('transaction', handleDocChanged);
    return () => {
      editor.off('transaction', handleDocChanged);
      // Save immediately on cleanup (e.g., tab switch)
      if (positionSaveTimeoutRef.current) {
        clearTimeout(positionSaveTimeoutRef.current);
        positionSaveTimeoutRef.current = null;
        saveComments(commentKey, storageRoot);
      }
    };
  }, [editor, commentKey, storageRoot, updateCommentPositions, saveComments]);

  // Sync decorations when comments change — filter out resolved comments.
  // Merge with plugin's authoritative remapped positions to prevent overwriting.
  useEffect(() => {
    if (!editor || !commentKey) return;
    const storeComments = (commentsByDocument[commentKey] ?? []).filter(
      (c) => c.status !== 'resolved'
    );

    // Use plugin's remapped positions as authoritative when available
    const pluginState = CommentMarkPluginKey.getState(editor.state);
    const pluginPosMap = new Map<string, { from: number; to: number }>();
    if (pluginState) {
      for (const c of pluginState.comments as Array<{ commentId: string; from: number; to: number }>) {
        pluginPosMap.set(c.commentId, { from: c.from, to: c.to });
      }
    }

    const mergedComments = storeComments.map((c) => {
      const pluginPos = pluginPosMap.get(c.id);
      return pluginPos ? { ...c, from: pluginPos.from, to: pluginPos.to } : c;
    });

    setCommentDecorations(editor, mergedComments, activeCommentId, delegationModeByComment);
  }, [editor, commentKey, commentsByDocument, activeCommentId, delegationModeByComment]);

  // Listen for comment creation requests and click-to-select from the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      const meta = transaction.getMeta(CommentMarkPluginKey);
      if (!meta) return;

      if (meta.requestCreateComment) {
        pendingCreateRef.current = meta.requestCreateComment;
      }

      // Delegated comment clicked — show toast instead of opening popover
      if (meta.delegatedClick) {
        toast.info('An agent is working on this comment. Check the activity panel for progress.', {
          id: 'delegated-comment',
          duration: 3000,
        });
        return;
      }

      // Bridge ProseMirror click → Zustand store so React effects fire
      if (meta.setActiveComment !== undefined) {
        setActiveComment(meta.setActiveComment as string | null);
      }
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor, setActiveComment]);

  const pendingCreateRef = useRef<{ from: number; to: number } | null>(null);

  /** Ensure a project file has a UUID in frontmatter. No-op for non-project files. */
  const ensureUUID = useCallback(() => {
    if (!isProjectFile || documentId || !activeTab || !storageRoot) return;
    const { frontmatter: updatedFm, id } = ensureDocumentId(activeTab.frontmatter);
    updateFrontmatter(activeTab.id, updatedFm);
    updateDocumentIndex(storageRoot, id, activeTab.filePath).catch((err) =>
      console.error('Failed to update document index:', err)
    );
  }, [isProjectFile, documentId, activeTab, storageRoot, updateFrontmatter]);

  /** Create a comment on a text range. For project files, call ensureUUID first. */
  const createComment = useCallback(
    async (body: string, from: number, to: number) => {
      if (!editor || !commentKey || !storageRoot) return null;

      const anchorText = editor.state.doc.textBetween(from, to, '\n');

      const comment = addComment({
        documentId: commentKey,
        anchorText,
        from,
        to,
        body,
        author: 'You',
      });

      await saveComments(commentKey, storageRoot);
      setActiveComment(comment.id);

      return comment;
    },
    [editor, commentKey, storageRoot, addComment, saveComments, setActiveComment]
  );

  /** Edit a comment's body. */
  const editComment = useCallback(
    async (commentId: string, body: string) => {
      if (!commentKey || !storageRoot) return;
      updateComment(commentKey, commentId, body);
      await saveComments(commentKey, storageRoot);
    },
    [commentKey, storageRoot, updateComment, saveComments]
  );

  /** Delete a comment. */
  const removeComment = useCallback(
    async (commentId: string) => {
      if (!commentKey || !storageRoot) return;
      deleteComment(commentKey, commentId);
      await saveComments(commentKey, storageRoot);
    },
    [commentKey, storageRoot, deleteComment, saveComments]
  );

  /** Get the active comment object. */
  const getActiveComment = useCallback((): Comment | null => {
    if (!activeCommentId || !commentKey) return null;
    const comments = commentsByDocument[commentKey] ?? [];
    return comments.find((c) => c.id === activeCommentId) ?? null;
  }, [activeCommentId, commentKey, commentsByDocument]);

  /** Get the pending create request (from Cmd+Shift+M or bubble menu click). */
  const consumePendingCreate = useCallback((): { from: number; to: number } | null => {
    const pending = pendingCreateRef.current;
    pendingCreateRef.current = null;
    return pending;
  }, []);

  return {
    documentId,
    commentKey,
    isProjectFile,
    comments: commentKey ? (commentsByDocument[commentKey] ?? []) : [],
    activeCommentId,
    activeComment: getActiveComment(),
    ensureUUID,
    createComment,
    editComment,
    removeComment,
    setActiveComment,
    consumePendingCreate,
    clearDocument,
  };
}
