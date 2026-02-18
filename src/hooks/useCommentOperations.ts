import { useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorStore } from '@/stores/editor-store';
import { useCommentStore, type Comment } from '@/stores/comment-store';
import { useActiveProject } from '@/hooks/useActiveProject';
import { ensureDocumentId } from '@/lib/frontmatter';
import { updateDocumentIndex } from '@/lib/document-index';
import {
  setCommentDecorations,
  clearCommentDecorations,
  setActiveCommentDecoration,
  CommentMarkPluginKey,
} from '@/components/editor/extensions';

/**
 * Orchestrates the full comment lifecycle: load, create, edit, delete, save.
 * Connects comment-store ↔ editor decorations ↔ sidecar JSON persistence.
 */
export function useCommentOperations(editor: Editor | null) {
  const { projectPath } = useActiveProject();
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

  const lastLoadedDocRef = useRef<string | null>(null);

  // Get document ID from current tab's frontmatter (if it has one)
  const documentId = (activeTab?.frontmatter?.id as string) ?? null;

  // Load comments when opening a file with a UUID
  useEffect(() => {
    if (!documentId || !projectPath) {
      // Clear decorations if no document ID
      if (editor && lastLoadedDocRef.current) {
        clearCommentDecorations(editor);
        lastLoadedDocRef.current = null;
      }
      return;
    }

    if (documentId === lastLoadedDocRef.current) return;
    lastLoadedDocRef.current = documentId;

    loadComments(documentId, projectPath);
  }, [documentId, projectPath, editor, loadComments]);

  // Sync decorations when comments change
  useEffect(() => {
    if (!editor || !documentId) return;
    const comments = commentsByDocument[documentId] ?? [];
    setCommentDecorations(editor, comments, activeCommentId);
  }, [editor, documentId, commentsByDocument, activeCommentId]);

  // Sync active comment decoration
  useEffect(() => {
    if (!editor) return;
    setActiveCommentDecoration(editor, activeCommentId);
  }, [editor, activeCommentId]);

  // Listen for comment creation requests and click-to-select from the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = ({ transaction }: { transaction: any }) => {
      const meta = transaction.getMeta(CommentMarkPluginKey);
      if (!meta) return;

      if (meta.requestCreateComment) {
        // Signal to the UI that a comment creation was requested
        // We store the range in a ref so the popover can pick it up
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

  /** Create a comment on a text range. Handles lazy UUID generation. */
  const createComment = useCallback(
    async (body: string, from: number, to: number) => {
      if (!editor || !activeTab || !projectPath) return null;

      let docId = documentId;

      // Lazy UUID generation
      if (!docId) {
        const { frontmatter: updatedFm, id } = ensureDocumentId(activeTab.frontmatter);
        docId = id;
        updateFrontmatter(activeTab.id, updatedFm);
        // Update document index
        updateDocumentIndex(projectPath, id, activeTab.filePath).catch((err) =>
          console.error('Failed to update document index:', err)
        );
      }

      // Get anchor text
      const anchorText = editor.state.doc.textBetween(from, to, '\n');

      const comment = addComment({
        documentId: docId,
        anchorText,
        from,
        to,
        body,
        author: 'You',
      });

      // Persist
      await saveComments(docId, projectPath);
      setActiveComment(comment.id);

      return comment;
    },
    [editor, activeTab, documentId, projectPath, addComment, saveComments, setActiveComment, updateFrontmatter]
  );

  /** Edit a comment's body. */
  const editComment = useCallback(
    async (commentId: string, body: string) => {
      if (!documentId || !projectPath) return;
      updateComment(documentId, commentId, body);
      await saveComments(documentId, projectPath);
    },
    [documentId, projectPath, updateComment, saveComments]
  );

  /** Delete a comment. */
  const removeComment = useCallback(
    async (commentId: string) => {
      if (!documentId || !projectPath) return;
      deleteComment(documentId, commentId);
      await saveComments(documentId, projectPath);
    },
    [documentId, projectPath, deleteComment, saveComments]
  );

  /** Get the active comment object. */
  const getActiveComment = useCallback((): Comment | null => {
    if (!activeCommentId || !documentId) return null;
    const comments = commentsByDocument[documentId] ?? [];
    return comments.find((c) => c.id === activeCommentId) ?? null;
  }, [activeCommentId, documentId, commentsByDocument]);

  /** Get the pending create request (from Cmd+Shift+M or bubble menu click). */
  const consumePendingCreate = useCallback((): { from: number; to: number } | null => {
    const pending = pendingCreateRef.current;
    pendingCreateRef.current = null;
    return pending;
  }, []);

  return {
    documentId,
    comments: documentId ? (commentsByDocument[documentId] ?? []) : [],
    activeCommentId,
    activeComment: getActiveComment(),
    createComment,
    editComment,
    removeComment,
    setActiveComment,
    consumePendingCreate,
    clearDocument,
  };
}
