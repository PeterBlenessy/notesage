import { useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
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

  // Sync decorations when comments change
  useEffect(() => {
    if (!editor || !commentKey) return;
    const comments = commentsByDocument[commentKey] ?? [];
    setCommentDecorations(editor, comments, activeCommentId);
  }, [editor, commentKey, commentsByDocument, activeCommentId]);

  // Listen for comment creation requests and click-to-select from the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = ({ transaction }: { transaction: any }) => {
      const meta = transaction.getMeta(CommentMarkPluginKey);
      if (!meta) return;

      if (meta.requestCreateComment) {
        pendingCreateRef.current = meta.requestCreateComment;
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
