import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAgentTaskOperations } from '@/hooks/useAgentTaskOperations';
import { useCommentStore, type Comment } from '@/stores/comment-store';

/**
 * Encapsulates the comment -> agent delegation flow.
 * Uses the `agent_tasks` routing slot via useAgentTaskOperations.
 */
export function useCommentDelegation() {
  const { startTask, cancelTask, taskConnection } = useAgentTaskOperations();

  const delegateComment = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string) => {
      if (!taskConnection) {
        toast.error('No agent configured for tasks. Set up agent routing in Settings.');
        return;
      }

      const store = useCommentStore.getState();

      // Set status to delegated
      store.setCommentStatus(documentId, comment.id, 'delegated');
      store.clearActivities(comment.id);
      await store.saveComments(documentId, projectRoot);

      // Build prompt with document context
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
      store.addActivity(comment.id, {
        label: `Sending to ${agentName}`,
        detail: `"${comment.body}" on "${truncatedAnchor}"`,
        status: 'info',
        timestamp: Date.now(),
      });

      try {
        const taskId = await startTask(
          prompt,
          // onComplete
          (output) => {
            const s = useCommentStore.getState();
            const responseText = output || '(No response from agent)';
            s.addReply(documentId, comment.id, responseText, agentName);
            s.setCommentStatus(documentId, comment.id, 'done');
            s.saveComments(documentId, projectRoot);
          },
          // onActivity
          (activity) => {
            const s = useCommentStore.getState();
            if (activity.event === 'tool_call') {
              s.addActivity(comment.id, {
                label: activity.label,
                detail: activity.detail,
                status: 'running',
                timestamp: Date.now(),
              });
            } else if (activity.event === 'tool_result') {
              s.completeLastActivity(comment.id);
            } else if (activity.event === 'agent_responding') {
              s.addActivity(comment.id, {
                label: 'Agent responding',
                status: 'running',
                timestamp: Date.now(),
              });
            } else if (activity.event === 'agent_complete') {
              // Mark any remaining running activities as done
              s.completeLastActivity(comment.id);
              s.addActivity(comment.id, {
                label: 'Agent finished',
                status: 'done',
                timestamp: Date.now(),
              });
            } else if (activity.event === 'permission_auto_approved') {
              s.addActivity(comment.id, {
                label: activity.label,
                status: 'info',
                timestamp: Date.now(),
              });
            }
          },
          // onError
          (errorMsg) => {
            const s = useCommentStore.getState();
            s.addActivity(comment.id, {
              label: `Error: ${errorMsg}`,
              status: 'error',
              timestamp: Date.now(),
            });
            s.setCommentStatus(documentId, comment.id, 'open');
            s.saveComments(documentId, projectRoot);
            toast.error(`Agent failed: ${errorMsg}`);
          },
        );

        // Log successful task start
        store.addActivity(comment.id, {
          label: 'Agent session started',
          detail: `Task ${taskId}`,
          status: 'info',
          timestamp: Date.now(),
        });

        // Store taskId on the comment for cancellation
        store.setTaskId(documentId, comment.id, taskId);
        await store.saveComments(documentId, projectRoot);
      } catch (error) {
        // startTask itself threw (e.g. agent spawn failed)
        const errMsg = error instanceof Error ? error.message : String(error);
        store.addActivity(comment.id, {
          label: `Spawn failed: ${errMsg}`,
          status: 'error',
          timestamp: Date.now(),
        });
        store.setCommentStatus(documentId, comment.id, 'open');
        await store.saveComments(documentId, projectRoot);
        toast.error(`Agent delegation failed: ${errMsg}`);
      }
    },
    [startTask, taskConnection]
  );

  const cancelDelegation = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string) => {
      const s = useCommentStore.getState();

      // Mark all running activities as done before adding cancel message
      s.completeAllActivities(comment.id);

      if (comment.taskId) {
        const wasCancelled = await cancelTask(comment.taskId);
        s.addActivity(comment.id, {
          label: wasCancelled ? 'Cancelled — agent session stopped' : 'Cancelled — agent had already finished',
          status: 'info',
          timestamp: Date.now(),
        });
      } else {
        s.addActivity(comment.id, {
          label: 'Cancelled — no active task',
          status: 'info',
          timestamp: Date.now(),
        });
      }

      s.setCommentStatus(documentId, comment.id, 'open');
      await s.saveComments(documentId, projectRoot);
      toast('Delegation cancelled');
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
        await delegateComment(comment, documentId, projectRoot);
      }
    },
    [delegateComment, taskConnection]
  );

  const canDelegate = !!taskConnection;

  return { delegateComment, cancelDelegation, delegateAll, canDelegate };
}
