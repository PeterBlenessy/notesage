import { useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useCommentOperations } from "@/hooks/useCommentOperations";
import { useCommentDelegation } from "@/hooks/useCommentDelegation";
import { useAIOperations } from "@/hooks/useAIOperations";
import { useCommentStore, type DelegationActivity } from "@/stores/comment-store";
import {
  setPendingCommentRange as setPendingRangeDecoration,
  hasActiveSuggestion,
} from "@/components/editor/extensions";
import type { AISuggestionType } from "@/components/editor/extensions";

// Stable empty array for Zustand selector fallback (avoids infinite re-render loop)
const EMPTY_ACTIVITIES: DelegationActivity[] = [];

export function useCommentEditorSync(editor: TiptapEditor | null) {
  const commentOps = useCommentOperations(editor);
  const { delegateComment, delegateReply, cancelDelegation, delegateAll, moveToChat, canDelegate } = useCommentDelegation();
  const { sendChatMessage } = useAIOperations();
  const activeCommentId = commentOps.activeComment?.id ?? null;
  const activeCommentActivities = useCommentStore((s) =>
    activeCommentId ? s.activitiesByComment[activeCommentId] : undefined
  ) ?? EMPTY_ACTIVITIES;
  const [commentPopoverOpen, setCommentPopoverOpen] = useState(false);
  const [pendingCommentRange, setPendingCommentRange] = useState<{ from: number; to: number } | null>(null);
  const [commentAnchorPos, setCommentAnchorPos] = useState<{ top: number; left: number } | null>(null);
  // Track if we generated a UUID for this popover session (to revert on cancel)
  const generatedUUIDRef = useRef(false);
  // Track whether an AI suggestion decoration is active (for Apply collision prevention)
  const savedSuggestionsRef = useRef<Map<string, AISuggestionType>>(new Map());
  const [suggestionActive, setSuggestionActiveState] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const check = () => setSuggestionActiveState(hasActiveSuggestion(editor));
    check();
    editor.on('transaction', check);
    return () => { editor.off('transaction', check); };
  }, [editor]);

  // Listen for comment creation requests (Cmd+Shift+M or bubble menu)
  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const pending = commentOps.consumePendingCreate();
      if (pending) {
        setPendingCommentRange(pending);
        commentOps.setActiveComment(null);
        // For project files, ensure document has a UUID before the popover opens.
        // Non-project files use a path hash — no frontmatter modification needed.
        if (commentOps.isProjectFile) {
          generatedUUIDRef.current = !commentOps.documentId;
          commentOps.ensureUUID();
        }
        // Show pending range decoration in the editor
        setPendingRangeDecoration(editor, pending);
        // Position popover at the selection
        const coords = editor.view.coordsAtPos(pending.from);
        setCommentAnchorPos({ top: coords.bottom, left: coords.left });
        setCommentPopoverOpen(true);
      }
    };
    editor.on('transaction', check);
    return () => { editor.off('transaction', check); };
  }, [editor, commentOps]);

  // Listen for comment click (active comment changed).
  // Only depend on activeCommentId — not the full activeComment object, which changes
  // on status/reply updates and would re-open the popover during delegation.
  useEffect(() => {
    if (commentOps.activeCommentId && commentOps.activeComment && editor) {
      setPendingCommentRange(null);
      setPendingRangeDecoration(editor, null);
      // Position popover at the comment's start
      const coords = editor.view.coordsAtPos(commentOps.activeComment.from);
      setCommentAnchorPos({ top: coords.bottom, left: coords.left });
      setCommentPopoverOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentOps.activeCommentId, editor]);

  // Scroll-to-comment: triggered by external navigation (e.g. activity panel click)
  const scrollToCommentId = useCommentStore((s) => s.scrollToCommentId);
  useEffect(() => {
    if (!scrollToCommentId || !editor) return;
    useCommentStore.getState().clearScrollToComment();
    const docId = commentOps.documentId;
    if (!docId) return;
    const comments = useCommentStore.getState().commentsByDocument[docId] ?? [];
    const comment = comments.find((c) => c.id === scrollToCommentId);
    if (!comment) return;
    try {
      const dom = editor.view.domAtPos(comment.from);
      const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch { /* position may be invalid */ }
    // Delay activation so scroll completes and coordsAtPos returns correct position
    setTimeout(() => commentOps.setActiveComment(scrollToCommentId), 300);
  }, [scrollToCommentId, editor, commentOps]);

  return {
    commentOps,
    delegateComment,
    delegateReply,
    cancelDelegation,
    delegateAll,
    moveToChat,
    canDelegate,
    sendChatMessage,
    activeCommentActivities,
    commentPopoverOpen,
    setCommentPopoverOpen,
    pendingCommentRange,
    setPendingCommentRange,
    commentAnchorPos,
    generatedUUIDRef,
    savedSuggestionsRef,
    suggestionActive,
  };
}
