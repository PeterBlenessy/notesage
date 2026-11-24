import { useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCommentStore } from '@/stores/comment-store';
import type { Comment } from '@/stores/comment-store';
import { useActiveProject } from '@/hooks/useActiveProject';
import { ensureDocumentId, getDocumentId } from '@/lib/frontmatter';
import { updateDocumentIndex } from '@/lib/document-index';
import { findTextInDoc } from '@/lib/pm-text-search';
import { hashPath } from '@/lib/comment-storage';
import {
  setCommentDecorations,
  clearCommentDecorations,
  CommentMarkPluginKey,
} from '@/components/editor/extensions';
import { t } from '@/lib/i18n';

// Stable empty list for documents without comments (a fresh `[]` per render
// would look like a change to every consumer).
const NO_COMMENTS: Comment[] = [];

interface PluginComment {
  commentId: string;
  from: number;
  to: number;
  status?: string;
  delegationMode?: string;
}

interface PluginCommentState {
  comments: PluginComment[];
  activeCommentId: string | null;
}

/**
 * Whether dispatching `setCommentDecorations(comments, activeCommentId, modes)`
 * would leave the plugin exactly as it is. The plugin remaps positions through
 * every document change itself, so after a keystroke the store catches up with
 * positions the plugin already has — re-sending them is a second transaction
 * and a full decoration rebuild for nothing.
 */
function decorationsUpToDate(
  plugin: PluginCommentState,
  comments: Comment[],
  activeCommentId: string | null,
  delegationModes: Record<string, string>,
): boolean {
  // A null active id leaves the plugin's own untouched (see the plugin's `setComments`).
  if (activeCommentId !== null && activeCommentId !== plugin.activeCommentId) return false;
  const wanted = comments.filter((c) => c.from < c.to);
  if (wanted.length !== plugin.comments.length) return false;
  return wanted.every((c, i) => {
    const current = plugin.comments[i];
    return (
      current.commentId === c.id &&
      current.from === c.from &&
      current.to === c.to &&
      current.status === c.status &&
      current.delegationMode === delegationModes[c.id]
    );
  });
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
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const updateFrontmatter = useEditorStore((s) => s.updateFrontmatter);

  // Actions are stable; read them without subscribing.
  const {
    loadComments,
    addComment,
    updateComment,
    deleteComment,
    setActiveComment,
    saveComments,
    clearDocument,
    updateCommentPositions,
  } = useCommentStore.getState();

  const lastLoadedKeyRef = useRef<string | null>(null);

  // Get document ID from current tab's frontmatter (project files only)
  const documentId = getDocumentId(activeTab?.frontmatter);

  // Comment key: UUID for project files, path hash for non-project files
  const commentKey = isProjectFile ? documentId : (activeTab?.filePath ? hashPath(activeTab.filePath) : null);

  // Atomic selectors: this hook runs inside Editor, so a bare `useCommentStore()`
  // re-rendered the whole editor on every store write — each streamed
  // delegation chunk (`partialReplyVersion`), every activity, and comments in
  // other documents.
  const documentComments = useCommentStore((s) =>
    commentKey ? s.commentsByDocument[commentKey] : undefined,
  );
  const activeCommentId = useCommentStore((s) => s.activeCommentId);
  const delegationModeByComment = useCommentStore((s) => s.delegationModeByComment);

  // For non-project files, pass the actual file path so the sidecar embeds
  // originalPath for folder-rename reverse-lookup (issue #117).
  const originalFilePath = isProjectFile ? undefined : (activeTab?.filePath ?? undefined);

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

    loadComments(commentKey, storageRoot).then(() => {
      // Re-anchor comments with stale positions (e.g., created on non-active files).
      // Verifies that the text at stored from/to matches anchorText; if not, uses
      // findTextInDoc to compute correct ProseMirror positions.
      if (!editor) return;
      // The tab changed while the sidecar was loading: the editor no longer
      // shows this document, so its text must not be searched or decorated.
      if (lastLoadedKeyRef.current !== commentKey) return;
      const comments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
      const doc = editor.state.doc;
      const reanchored: Array<{ id: string; from: number; to: number; anchorText: string }> = [];

      for (const c of comments) {
        if (!c.anchorText || c.status === 'resolved') continue;
        // Check if stored positions are valid and match the anchor text
        const posValid = c.from >= 0 && c.to > c.from && c.to <= doc.content.size;
        const textMatches = posValid && doc.textBetween(c.from, c.to, '\n') === c.anchorText;
        if (textMatches) continue;

        // Positions are stale — re-anchor via text search
        const range = findTextInDoc(doc, c.anchorText);
        if (range) {
          reanchored.push({ id: c.id, from: range.from, to: range.to, anchorText: c.anchorText });
        }
      }

      if (reanchored.length > 0) {
        // Persist corrected positions
        const store = useCommentStore.getState();
        store.updateCommentPositions(commentKey, reanchored);
        // The decoration sync below treats positions the plugin already holds
        // as authoritative, so hand it the corrected ones explicitly.
        const corrected = (useCommentStore.getState().commentsByDocument[commentKey] ?? []).filter(
          (c) => c.status !== 'resolved',
        );
        setCommentDecorations(editor, corrected, store.activeCommentId, store.delegationModeByComment);
        saveComments(commentKey, storageRoot, originalFilePath);
      }
    });
  }, [commentKey, storageRoot, originalFilePath, editor, loadComments, saveComments]);

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

      // Debounce save to disk (2s after last edit).
      // Capture current values to avoid stale closure if tab switches during debounce.
      const currentKey = commentKey;
      const currentRoot = storageRoot;
      const currentOriginalFilePath = originalFilePath;
      if (positionSaveTimeoutRef.current) clearTimeout(positionSaveTimeoutRef.current);
      positionSaveTimeoutRef.current = setTimeout(() => {
        saveComments(currentKey, currentRoot, currentOriginalFilePath);
      }, 2000);
    };

    editor.on('transaction', handleDocChanged);
    return () => {
      editor.off('transaction', handleDocChanged);
      // Save immediately on cleanup (e.g., tab switch)
      if (positionSaveTimeoutRef.current) {
        clearTimeout(positionSaveTimeoutRef.current);
        positionSaveTimeoutRef.current = null;
        saveComments(commentKey, storageRoot, originalFilePath);
      }
    };
  }, [editor, commentKey, storageRoot, originalFilePath, updateCommentPositions, saveComments]);

  // Sync decorations when this document's comments change — filter out resolved
  // comments. Merge with plugin's authoritative remapped positions to prevent
  // overwriting. Keyed on this document's list only: a write to another
  // document's comments must not touch this editor.
  useEffect(() => {
    if (!editor || !commentKey) return;
    const storeComments = (documentComments ?? NO_COMMENTS).filter(
      (c) => c.status !== 'resolved'
    );

    // Use plugin's remapped positions as authoritative when available
    const pluginState = CommentMarkPluginKey.getState(editor.state) as PluginCommentState | undefined;
    const pluginPosMap = new Map<string, { from: number; to: number }>();
    if (pluginState) {
      for (const c of pluginState.comments) {
        pluginPosMap.set(c.commentId, { from: c.from, to: c.to });
      }
    }

    const mergedComments = storeComments.map((c) => {
      const pluginPos = pluginPosMap.get(c.id);
      return pluginPos ? { ...c, from: pluginPos.from, to: pluginPos.to } : c;
    });

    // Typing only moves positions, and the plugin has those already: skip the
    // dispatch unless something the plugin does not know about changed (a
    // comment added/removed, a status, a delegation mode, the active comment).
    if (pluginState && decorationsUpToDate(pluginState, mergedComments, activeCommentId, delegationModeByComment)) {
      return;
    }

    setCommentDecorations(editor, mergedComments, activeCommentId, delegationModeByComment);
  }, [editor, commentKey, documentComments, activeCommentId, delegationModeByComment]);

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
        toast.info(t("toast.agentWorkingComment"), {
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

      await saveComments(commentKey, storageRoot, originalFilePath);
      setActiveComment(comment.id);

      return comment;
    },
    [editor, commentKey, storageRoot, originalFilePath, addComment, saveComments, setActiveComment]
  );

  /** Edit a comment's body. */
  const editComment = useCallback(
    async (commentId: string, body: string) => {
      if (!commentKey || !storageRoot) return;
      updateComment(commentKey, commentId, body);
      await saveComments(commentKey, storageRoot, originalFilePath);
    },
    [commentKey, storageRoot, originalFilePath, updateComment, saveComments]
  );

  /** Delete a comment. */
  const removeComment = useCallback(
    async (commentId: string) => {
      if (!commentKey || !storageRoot) return;
      deleteComment(commentKey, commentId);
      await saveComments(commentKey, storageRoot, originalFilePath);
    },
    [commentKey, storageRoot, originalFilePath, deleteComment, saveComments]
  );

  /** Get the active comment object. */
  const getActiveComment = useCallback((): Comment | null => {
    if (!activeCommentId || !commentKey) return null;
    const comments = documentComments ?? NO_COMMENTS;
    return comments.find((c) => c.id === activeCommentId) ?? null;
  }, [activeCommentId, commentKey, documentComments]);

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
    comments: commentKey ? (documentComments ?? NO_COMMENTS) : NO_COMMENTS,
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
