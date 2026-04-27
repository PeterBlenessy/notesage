import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAgentTaskOperations } from '@/hooks/useAgentTaskOperations';
import { useCommentStore, appendPartialReply, clearPartialReply, type Comment, type DelegationMode } from '@/stores/comment-store';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

/** Resolve the sandbox scope for a file — its containing project or explorer folder. */
function resolveSandboxRoot(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const ws = useWorkspaceStore.getState();
  const project = ws.projects.find((p) => filePath.startsWith(p.path + '/'));
  if (project) return project.path;
  const folder = ws.explorerFolders.find((f) => filePath.startsWith(f.path + '/'));
  if (folder) return folder.path;
  return undefined;
}

export interface UseCommentDelegationReturn {
  delegateComment: (comment: Comment, documentId: string, projectRoot: string, mode?: DelegationMode) => Promise<void>;
  delegateReply: (comment: Comment, replyText: string, documentId: string, projectRoot: string, mode?: DelegationMode) => Promise<void>;
  cancelDelegation: (comment: Comment, documentId: string, projectRoot: string) => Promise<void>;
  delegateAll: (documentId: string, projectRoot: string) => Promise<void>;
  moveToChat: (comment: Comment, projectPath?: string, storageRoot?: string) => void;
  canDelegate: boolean;
}

/**
 * Encapsulates the comment -> agent delegation flow.
 * Uses the `agent_tasks` routing slot via useAgentTaskOperations.
 */
export function useCommentDelegation(): UseCommentDelegationReturn {
  const { startTask, cancelTask, taskConnection } = useAgentTaskOperations();

  const delegateComment = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string, mode: DelegationMode = 'delegate') => {
      if (!taskConnection) {
        toast.error('No agent configured for tasks. Set up agent routing in Settings.');
        return;
      }

      // Capture stable IDs at the top of the callback chain to avoid stale closure
      // over the full `comment` object. If the comment is edited between task start
      // and completion, callbacks must still target the correct comment by ID.
      const commentId = comment.id;

      const store = useCommentStore.getState();

      // Set status to delegated and track delegation mode
      store.setCommentStatus(documentId, commentId, 'delegated');
      store.setDelegationMode(commentId, mode);
      store.clearActivities(commentId);
      await store.saveComments(documentId, projectRoot);

      // Build prompt with document context (snapshot values at delegation time)
      const prompt = [
        'I have a comment on the following text in my document:',
        '',
        `> ${comment.anchorText}`,
        '',
        `Comment: ${comment.body}`,
        '',
        'Please help me address this comment. Provide a clear, actionable response.',
      ].join('\n');

      // Log the prompt being sent — include agent name so user knows which connection is used
      const agentName = taskConnection.label || taskConnection.provider || 'Unknown agent';
      const truncatedAnchor = comment.anchorText.length > 50
        ? comment.anchorText.slice(0, 50) + '\u2026'
        : comment.anchorText;
      store.addActivity(commentId, {
        label: `Sending to ${agentName}`,
        detail: `"${comment.body}" on "${truncatedAnchor}"`,
        status: 'info',
        timestamp: Date.now(),
      });

      // Resolve source file path for the activity strip and sandbox scope
      const editorState = useEditorStore.getState();
      const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
      const sandboxRoot = resolveSandboxRoot(activeTab?.filePath) ?? projectRoot;

      // Snapshot label for meta (uses body at delegation time)
      const metaLabel = comment.body.length > 50 ? comment.body.slice(0, 50) + '\u2026' : comment.body;

      try {
        const taskId = await startTask(
          prompt,
          {
            onComplete: (output) => {
              clearPartialReply(documentId, commentId);
              const s = useCommentStore.getState();
              s.completeAllActivities(commentId);
              // Snapshot activities — force all to terminal status for persistence
              const replyActivities = (useCommentStore.getState().activitiesByComment[commentId] ?? [])
                .map((a) => a.status === 'running' ? { ...a, status: 'done' as const } : a);
              const responseText = output || '(No response from agent)';
              s.addReply(documentId, commentId, responseText, agentName, replyActivities);
              s.setCommentStatus(documentId, commentId, 'done');
              s.clearDelegationMode(commentId);
              s.saveComments(documentId, projectRoot);
              if (mode === 'delegate') {
                // `closeButton: true` adds an explicit X so the user can dismiss
                // the toast immediately. The Toaster sits in `bottom-right` —
                // same corner as the AgentOrb (`fixed bottom-6 right-6`) — so
                // the default 5s auto-dismiss otherwise blocks the orb's hit
                // target until it expires (audit 2026-04-27 finding #16).
                toast.success('Agent finished working on your comment. Click it to review.', {
                  id: `delegation-done-${commentId}`,
                  duration: 5000,
                  closeButton: true,
                });
              }
            },
            onActivity: (activity) => {
              const s = useCommentStore.getState();
              if (activity.event === 'tool_call') {
                s.addActivity(commentId, {
                  label: activity.label,
                  detail: activity.detail,
                  status: 'running',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'tool_result') {
                s.completeLastActivity(commentId);
              } else if (activity.event === 'agent_responding') {
                s.addActivity(commentId, {
                  label: 'Agent responding',
                  status: 'running',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'agent_complete') {
                s.completeAllActivities(commentId);
                s.addActivity(commentId, {
                  label: 'Agent finished',
                  status: 'done',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'tool_denied') {
                s.addActivity(commentId, {
                  label: activity.label,
                  detail: activity.detail,
                  status: 'error',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'permission_auto_approved') {
                s.addActivity(commentId, {
                  label: activity.label,
                  status: 'info',
                  timestamp: Date.now(),
                });
              }
            },
            onError: (errorMsg) => {
              clearPartialReply(documentId, commentId);
              const s = useCommentStore.getState();
              s.completeAllActivities(commentId);
              s.addActivity(commentId, {
                label: `Error: ${errorMsg}`,
                status: 'error',
                timestamp: Date.now(),
              });
              s.setCommentStatus(documentId, commentId, 'open');
              s.clearDelegationMode(commentId);
              s.saveComments(documentId, projectRoot);
              toast.error(`Agent failed: ${errorMsg}`);
            },
            onChunk: (chunk) => {
              appendPartialReply(documentId, commentId, chunk);
            },
          },
          {
            type: 'comment',
            label: metaLabel,
            sourceFile: activeTab?.filePath,
            commentId,
            documentId,
            projectRoot: sandboxRoot,
            trackInActivityStore: mode === 'delegate',
          },
        );

        // Log successful task start
        store.addActivity(commentId, {
          label: 'Agent session started',
          detail: `Task ${taskId}`,
          status: 'info',
          timestamp: Date.now(),
        });

        // Store taskId on the comment for cancellation
        store.setTaskId(documentId, commentId, taskId);
        await store.saveComments(documentId, projectRoot);
      } catch (error) {
        // startTask itself threw (e.g. agent spawn failed)
        clearPartialReply(documentId, commentId);
        store.completeAllActivities(commentId);
        const errMsg = error instanceof Error ? error.message : String(error);
        store.addActivity(commentId, {
          label: `Spawn failed: ${errMsg}`,
          status: 'error',
          timestamp: Date.now(),
        });
        store.setCommentStatus(documentId, commentId, 'open');
        store.clearDelegationMode(commentId);
        await store.saveComments(documentId, projectRoot);
        toast.error(`Agent delegation failed: ${errMsg}`);
      }
    },
    [startTask, taskConnection]
  );

  const delegateReply = useCallback(
    async (comment: Comment, replyText: string, documentId: string, projectRoot: string, mode: DelegationMode = 'chat') => {
      if (!taskConnection) {
        toast.error('No agent configured for tasks. Set up agent routing in Settings.');
        return;
      }

      // Capture stable IDs to avoid stale closure over the full `comment` object.
      const commentId = comment.id;
      const existingTaskId = comment.taskId;

      const store = useCommentStore.getState();

      // Add user reply to thread
      store.addReply(documentId, commentId, replyText, 'You');

      // Set status back to delegated and track delegation mode
      store.setCommentStatus(documentId, commentId, 'delegated');
      store.setDelegationMode(commentId, mode);
      store.clearActivities(commentId);
      await store.saveComments(documentId, projectRoot);

      // Build prompt with full conversation history
      // Note: `comment` is a snapshot from before addReply, so we read fresh replies
      const freshComments = useCommentStore.getState().commentsByDocument[documentId] ?? [];
      const freshComment = freshComments.find((c) => c.id === commentId);
      const replies = freshComment?.replies ?? comment.replies ?? [];

      const promptParts = [
        'I have an ongoing conversation about the following text in my document:',
        '',
        `> ${comment.anchorText}`,
        '',
        `Original comment: ${comment.body}`,
      ];

      for (const reply of replies) {
        promptParts.push('');
        promptParts.push(`${reply.author}: ${reply.body}`);
      }

      promptParts.push('');
      promptParts.push('Please respond to my latest message. Provide a clear, actionable response.');

      const prompt = promptParts.join('\n');

      const agentName = taskConnection.label || taskConnection.provider || 'Unknown agent';

      store.addActivity(commentId, {
        label: `Sending reply to ${agentName}`,
        detail: `"${replyText.length > 50 ? replyText.slice(0, 50) + '\u2026' : replyText}"`,
        status: 'info',
        timestamp: Date.now(),
      });

      const editorState = useEditorStore.getState();
      const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
      const sandboxRoot = resolveSandboxRoot(activeTab?.filePath) ?? projectRoot;

      // Snapshot label for meta (uses body at delegation time)
      const metaLabel = comment.body.length > 50 ? comment.body.slice(0, 50) + '\u2026' : comment.body;

      try {
        const taskId = await startTask(
          prompt,
          {
            onComplete: (output) => {
              clearPartialReply(documentId, commentId);
              const s = useCommentStore.getState();
              s.completeAllActivities(commentId);
              // Snapshot activities — force all to terminal status for persistence
              const replyActivities = (useCommentStore.getState().activitiesByComment[commentId] ?? [])
                .map((a) => a.status === 'running' ? { ...a, status: 'done' as const } : a);
              const responseText = output || '(No response from agent)';
              s.addReply(documentId, commentId, responseText, agentName, replyActivities);
              s.setCommentStatus(documentId, commentId, 'done');
              s.clearDelegationMode(commentId);
              s.saveComments(documentId, projectRoot);
              if (mode === 'delegate') {
                // `closeButton: true` adds an explicit X so the user can dismiss
                // the toast immediately. The Toaster sits in `bottom-right` —
                // same corner as the AgentOrb (`fixed bottom-6 right-6`) — so
                // the default 5s auto-dismiss otherwise blocks the orb's hit
                // target until it expires (audit 2026-04-27 finding #16).
                toast.success('Agent finished working on your comment. Click it to review.', {
                  id: `delegation-done-${commentId}`,
                  duration: 5000,
                  closeButton: true,
                });
              }
            },
            onActivity: (activity) => {
              const s = useCommentStore.getState();
              if (activity.event === 'tool_call') {
                s.addActivity(commentId, {
                  label: activity.label,
                  detail: activity.detail,
                  status: 'running',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'tool_result') {
                s.completeLastActivity(commentId);
              } else if (activity.event === 'agent_responding') {
                s.addActivity(commentId, {
                  label: 'Agent responding',
                  status: 'running',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'agent_complete') {
                s.completeAllActivities(commentId);
                s.addActivity(commentId, {
                  label: 'Agent finished',
                  status: 'done',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'tool_denied') {
                s.addActivity(commentId, {
                  label: activity.label,
                  detail: activity.detail,
                  status: 'error',
                  timestamp: Date.now(),
                });
              } else if (activity.event === 'permission_auto_approved') {
                s.addActivity(commentId, {
                  label: activity.label,
                  status: 'info',
                  timestamp: Date.now(),
                });
              }
            },
            onError: (errorMsg) => {
              clearPartialReply(documentId, commentId);
              const s = useCommentStore.getState();
              s.completeAllActivities(commentId);
              s.addActivity(commentId, {
                label: `Error: ${errorMsg}`,
                status: 'error',
                timestamp: Date.now(),
              });
              // Revert to done (not open) — thread already has replies
              s.setCommentStatus(documentId, commentId, 'done');
              s.clearDelegationMode(commentId);
              s.saveComments(documentId, projectRoot);
              toast.error(`Agent failed: ${errorMsg}`);
            },
            onChunk: (chunk) => {
              appendPartialReply(documentId, commentId, chunk);
            },
          },
          {
            type: 'comment',
            label: metaLabel,
            sourceFile: activeTab?.filePath,
            commentId,
            documentId,
            projectRoot: sandboxRoot,
            existingTaskId,
            trackInActivityStore: mode === 'delegate',
          },
        );

        // Only update taskId if this is a new task (first delegation had no taskId)
        if (!existingTaskId) {
          store.setTaskId(documentId, commentId, taskId);
          await store.saveComments(documentId, projectRoot);
        }
      } catch (error) {
        clearPartialReply(documentId, commentId);
        store.completeAllActivities(commentId);
        const errMsg = error instanceof Error ? error.message : String(error);
        store.addActivity(commentId, {
          label: `Spawn failed: ${errMsg}`,
          status: 'error',
          timestamp: Date.now(),
        });
        // Revert to done — thread already has replies
        store.setCommentStatus(documentId, commentId, 'done');
        store.clearDelegationMode(commentId);
        await store.saveComments(documentId, projectRoot);
        toast.error(`Agent delegation failed: ${errMsg}`);
      }
    },
    [startTask, taskConnection]
  );

  const cancelDelegation = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string) => {
      // Capture stable IDs to avoid stale closure over the full `comment` object.
      const commentId = comment.id;
      const taskIdToCancel = comment.taskId;

      clearPartialReply(documentId, commentId);
      const s = useCommentStore.getState();

      // Mark all running activities as done before adding cancel message
      s.completeAllActivities(commentId);

      if (taskIdToCancel) {
        const wasCancelled = await cancelTask(taskIdToCancel);
        s.addActivity(commentId, {
          label: wasCancelled ? 'Cancelled — agent session stopped' : 'Cancelled — agent had already finished',
          status: 'info',
          timestamp: Date.now(),
        });
      } else {
        s.addActivity(commentId, {
          label: 'Cancelled — no active task',
          status: 'info',
          timestamp: Date.now(),
        });
      }

      const mode = s.delegationModeByComment[commentId];
      // If comment already has replies, set to 'done' so the reply input reappears.
      // Setting to 'open' hides the reply input (it requires status === 'done').
      const freshComment = s.commentsByDocument[documentId]?.find((c) => c.id === commentId);
      const hasReplies = (freshComment?.replies?.length ?? comment.replies?.length ?? 0) > 0;
      s.setCommentStatus(documentId, commentId, hasReplies ? 'done' : 'open');
      s.clearDelegationMode(commentId);
      await s.saveComments(documentId, projectRoot);
      if (mode === 'chat') {
        toast('Agent stopped');
      } else {
        toast('Delegation cancelled');
      }
    },
    [cancelTask]
  );

  /** Delegate all open (non-delegated, non-done) comments for a document. */
  const delegateAll = useCallback(
    async (documentId: string, projectRoot: string) => {
      if (!taskConnection) {
        toast.error('No agent configured for tasks. Set up agent routing in Settings.');
        return;
      }

      const comments = useCommentStore.getState().commentsByDocument[documentId] ?? [];
      const delegatable = comments.filter(
        (c) => c.status !== 'delegated' && c.status !== 'done' && c.status !== 'resolved'
      );

      if (delegatable.length === 0) {
        toast('No comments to delegate');
        return;
      }

      toast(`Delegating ${delegatable.length} comment${delegatable.length === 1 ? '' : 's'} to agent...`);

      for (const comment of delegatable) {
        await delegateComment(comment, documentId, projectRoot, 'delegate');
      }
    },
    [delegateComment, taskConnection]
  );

  /** Move a comment conversation to the chat panel as a new conversation. */
  const moveToChat = useCallback(
    (comment: Comment, projectPath?: string, storageRoot?: string) => {
      const anchorSnippet = comment.anchorText.length > 50
        ? comment.anchorText.slice(0, 50) + '\u2026'
        : comment.anchorText;

      const chatStore = useChatStore.getState();
      const commentStore = useCommentStore.getState();

      // Create a new conversation with comment metadata
      const convId = chatStore.createConversation({
        title: `Comment: ${anchorSnippet}`,
        projectPaths: projectPath ? [projectPath] : [],
        sourceCommentId: comment.id,
        sourceDocumentId: comment.documentId,
      });

      // Link the comment to this conversation
      commentStore.setLinkedConversation(comment.documentId, comment.id, convId);
      if (storageRoot) {
        commentStore.saveComments(comment.documentId, storageRoot);
      }

      // Map original comment as the first user message
      chatStore.addMessage({
        role: 'user',
        content: `Comment on:\n> ${comment.anchorText}\n\n${comment.body}`,
      });

      // Map each reply (carry over per-reply activities)
      for (const reply of comment.replies ?? []) {
        chatStore.addMessage({
          role: reply.author === 'You' ? 'user' : 'assistant',
          content: reply.body,
          activities: reply.activities?.map((a) => ({
            kind: a.status,
            label: a.label,
            detail: a.detail,
            status: (a.status === 'running' ? 'done' : a.status === 'info' || a.status === 'error' ? 'done' : a.status) as 'running' | 'done',
            timestamp: a.timestamp,
          })),
        });
      }

      // Open chat panel
      useSettingsStore.getState().setChatPanelOpen(true);
    },
    []
  );

  const canDelegate = !!taskConnection;

  return { delegateComment, delegateReply, cancelDelegation, delegateAll, moveToChat, canDelegate };
}
