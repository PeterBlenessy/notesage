import type { Editor } from "@tiptap/core";
import type { useCommentEditorSync } from "@/hooks/useCommentEditorSync";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useCommentStore } from "@/stores/comment-store";
import { useChatStore } from "@/stores/chat-store";
import { getThreadResilient } from "@/lib/chat-tree";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import {
  setPendingCommentRange as setPendingRangeDecoration,
  setSuggestion,
  hasActiveSuggestion,
} from "@/components/editor/extensions";
import { extractReplacementText, resolveAnchorRange } from "@/lib/pm-replace";
import type { Frontmatter } from "@/lib/frontmatter";
import { CommentPopover } from "./CommentPopover";
import { toast } from "sonner";

interface EditorCommentPopoverProps {
  editor: Editor | null;
  sync: ReturnType<typeof useCommentEditorSync>;
  activeTab: { id: string; frontmatter: Frontmatter | null } | undefined;
  commentStorageRoot: string | null;
  setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => void;
}

/**
 * Comment creation / delegation / reply popover, extracted verbatim from
 * Editor.tsx (deep-review refactor). Renders the same `<CommentPopover>` DOM;
 * all handler logic is unchanged — it just lives next to the comment-sync
 * bundle it consumes instead of inline in the editor orchestrator.
 */
export function EditorCommentPopover({
  editor,
  sync,
  activeTab,
  commentStorageRoot,
  setFrontmatter,
}: EditorCommentPopoverProps) {
  const {
    commentOps,
    delegateComment,
    delegateReply,
    cancelDelegation,
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
    suggestionActive,
  } = sync;

  return (
    <CommentPopover
      comment={commentOps.activeComment}
      open={commentPopoverOpen}
      anchorPosition={commentAnchorPos}
      canDelegate={canDelegate}
      activities={activeCommentActivities}
      onCancelDelegation={async () => {
        if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
          await cancelDelegation(commentOps.activeComment, commentOps.commentKey, commentStorageRoot);
        }
      }}
      onOpenChange={(open) => {
        setCommentPopoverOpen(open);
        if (!open) {
          commentOps.setActiveComment(null);
          if (pendingCommentRange && editor) {
            setPendingRangeDecoration(editor, null);
          }
          // If we generated a UUID for this popover but the user cancelled, revert it
          if (pendingCommentRange && generatedUUIDRef.current && activeTab) {
            const { id: _id, ...rest } = activeTab.frontmatter ?? {};
            setFrontmatter(activeTab.id, Object.keys(rest).length > 0 ? rest : null);
          }
          generatedUUIDRef.current = false;
          setPendingCommentRange(null);
        }
      }}
      onCreate={async (body) => {
        if (pendingCommentRange) {
          generatedUUIDRef.current = false;
          await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
          if (editor) setPendingRangeDecoration(editor, null);
          setPendingCommentRange(null);
        }
      }}
      onChat={async (body) => {
        if (pendingCommentRange && editor && commentOps.commentKey && commentStorageRoot) {
          generatedUUIDRef.current = false;
          const comment = await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
          if (editor) setPendingRangeDecoration(editor, null);
          setPendingCommentRange(null);
          if (comment) {
            commentOps.setActiveComment(comment.id);
            await delegateComment(comment, commentOps.commentKey, commentStorageRoot, 'chat');
          }
        }
      }}
      onDelegate={async (body) => {
        if (pendingCommentRange && editor && commentOps.commentKey && commentStorageRoot) {
          generatedUUIDRef.current = false;
          const comment = await commentOps.createComment(body, pendingCommentRange.from, pendingCommentRange.to);
          if (editor) setPendingRangeDecoration(editor, null);
          setPendingCommentRange(null);
          if (comment) {
            await delegateComment(comment, commentOps.commentKey, commentStorageRoot, 'delegate');
          }
        }
      }}
      onDelegateExisting={() => {
        const comment = commentOps.activeComment;
        const key = commentOps.commentKey;
        if (comment && key && commentStorageRoot) {
          // Close popover and clear active comment BEFORE delegation starts
          setCommentPopoverOpen(false);
          commentOps.setActiveComment(null);
          // Delegate async after popover is closed
          delegateComment(comment, key, commentStorageRoot, 'delegate');
        }
      }}
      onChatExisting={async () => {
        if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
          await delegateComment(commentOps.activeComment, commentOps.commentKey, commentStorageRoot, 'chat');
        }
      }}
      suggestionActive={suggestionActive}
      onMoveToChat={() => {
        if (commentOps.activeComment) {
          // Find project path for this document
          const ws = useWorkspaceStore.getState();
          const tab = useEditorStore.getState().openDocuments.find((t) => t.id === useEditorStore.getState().activeTabId);
          const projectPath = ws.projects.find((p) => tab?.filePath?.startsWith(p.path + '/'))?.path;
          moveToChat(commentOps.activeComment, projectPath, commentStorageRoot ?? undefined);
        }
      }}
      onReply={async (text) => {
        if (!commentOps.activeComment) return;

        // If comment is linked to a chat conversation, route reply through chat
        const freshComments = useCommentStore.getState().commentsByDocument[commentOps.commentKey ?? ''] ?? [];
        const freshComment = freshComments.find((c) => c.id === commentOps.activeComment!.id);

        if (freshComment?.linkedConversationId) {
          const chatStore = useChatStore.getState();
          const conv = chatStore.conversations.find((c) => c.id === freshComment.linkedConversationId);
          if (conv) {
            chatStore.setActiveConversation(conv.id);
            const threadMessages = getThreadResilient(conv.messages, conv.activeLeafId).thread;
            await sendChatMessage(text, threadMessages);
            emitCmdBarEvent({ type: 'focus' });
            return;
          }
        }

        // Fallback: existing delegation reply flow
        if (commentOps.commentKey && commentStorageRoot && freshComment) {
          await delegateReply(freshComment, text, commentOps.commentKey, commentStorageRoot, 'chat');
        }
      }}
      onDelegateReply={async (text) => {
        if (commentOps.activeComment && commentOps.commentKey && commentStorageRoot) {
          const freshComments = useCommentStore.getState().commentsByDocument[commentOps.commentKey] ?? [];
          const freshComment = freshComments.find((c) => c.id === commentOps.activeComment!.id);
          if (freshComment) {
            await delegateReply(freshComment, text, commentOps.commentKey, commentStorageRoot, 'delegate');
          }
        }
      }}
      onApply={(reply) => {
        if (!editor || !commentOps.activeComment) return;
        if (hasActiveSuggestion(editor)) {
          toast.info('Another suggestion is already active. Accept or reject it first.');
          return;
        }
        const range = resolveAnchorRange(editor, commentOps.activeComment);
        if (!range) {
          toast.error('Cannot find the commented text in the document. It may have been deleted.');
          return;
        }
        const replacementText = extractReplacementText(reply.body);
        const currentText = editor.state.doc.textBetween(range.from, range.to, '\n');
        setSuggestion(editor, range.from, range.to, currentText, replacementText);
      }}
      onResolve={async (commentId) => {
        if (commentOps.commentKey && commentStorageRoot) {
          useCommentStore.getState().setCommentStatus(commentOps.commentKey, commentId, 'resolved');
          await useCommentStore.getState().saveComments(commentOps.commentKey, commentStorageRoot);
        }
      }}
      onEdit={async (commentId, body) => {
        await commentOps.editComment(commentId, body);
      }}
      onDelete={async (commentId) => {
        await commentOps.removeComment(commentId);
      }}
    />
  );
}
