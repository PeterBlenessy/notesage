import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAgentTaskOperations } from '@/hooks/useAgentTaskOperations';
import { useCommentStore, appendPartialReply, clearPartialReply, type Comment, type DelegationMode } from '@/stores/comment-store';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';

/**
 * Encapsulates the comment -> agent delegation flow.
 * Uses the `agent_tasks` routing slot via useAgentTaskOperations.
 */
export function useCommentDelegation() {
  const { startTask, cancelTask, taskConnection } = useAgentTaskOperations();

  const delegateComment = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string, mode: DelegationMode = 'delegate') => {
      if (!taskConnection) {
        toast.error('No agent configured for tasks. Set up agent routing in Settings.');
        return;
      }

      const store = useCommentStore.getState();

      // Set status to delegated and track delegation mode
      store.setCommentStatus(documentId, comment.id, 'delegated');
      store.setDelegationMode(comment.id, mode);
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

      // Resolve source file path for the activity strip
      const activeTab = useEditorStore.getState().tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId
      );

      try {
        const taskId = await startTask(
          prompt,
          {
            onComplete: (output) => {
              clearPartialReply(documentId, comment.id);
              const s = useCommentStore.getState();
              const responseText = output || '(No response from agent)';
              s.addReply(documentId, comment.id, responseText, agentName);
              s.setCommentStatus(documentId, comment.id, 'done');
              s.clearDelegationMode(comment.id);
              s.saveComments(documentId, projectRoot);
            },
            onActivity: (activity) => {
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
            onError: (errorMsg) => {
              clearPartialReply(documentId, comment.id);
              const s = useCommentStore.getState();
              s.addActivity(comment.id, {
                label: `Error: ${errorMsg}`,
                status: 'error',
                timestamp: Date.now(),
              });
              s.setCommentStatus(documentId, comment.id, 'open');
              s.clearDelegationMode(comment.id);
              s.saveComments(documentId, projectRoot);
              toast.error(`Agent failed: ${errorMsg}`);
            },
            onChunk: (chunk) => {
              appendPartialReply(documentId, comment.id, chunk);
            },
          },
          {
            type: 'comment',
            label: comment.body.length > 50 ? comment.body.slice(0, 50) + '\u2026' : comment.body,
            sourceFile: activeTab?.filePath,
            commentId: comment.id,
            documentId,
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
        clearPartialReply(documentId, comment.id);
        const errMsg = error instanceof Error ? error.message : String(error);
        store.addActivity(comment.id, {
          label: `Spawn failed: ${errMsg}`,
          status: 'error',
          timestamp: Date.now(),
        });
        store.setCommentStatus(documentId, comment.id, 'open');
        store.clearDelegationMode(comment.id);
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

      const store = useCommentStore.getState();

      // Add user reply to thread
      store.addReply(documentId, comment.id, replyText, 'You');

      // Set status back to delegated and track delegation mode
      store.setCommentStatus(documentId, comment.id, 'delegated');
      store.setDelegationMode(comment.id, mode);
      store.clearActivities(comment.id);
      await store.saveComments(documentId, projectRoot);

      // Build prompt with full conversation history
      // Note: `comment` is a snapshot from before addReply, so we read fresh replies
      const freshComments = useCommentStore.getState().commentsByDocument[documentId] ?? [];
      const freshComment = freshComments.find((c) => c.id === comment.id);
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

      store.addActivity(comment.id, {
        label: `Sending reply to ${agentName}`,
        detail: `"${replyText.length > 50 ? replyText.slice(0, 50) + '\u2026' : replyText}"`,
        status: 'info',
        timestamp: Date.now(),
      });

      const activeTab = useEditorStore.getState().tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId
      );

      try {
        const taskId = await startTask(
          prompt,
          {
            onComplete: (output) => {
              clearPartialReply(documentId, comment.id);
              const s = useCommentStore.getState();
              const responseText = output || '(No response from agent)';
              s.addReply(documentId, comment.id, responseText, agentName);
              s.setCommentStatus(documentId, comment.id, 'done');
              s.clearDelegationMode(comment.id);
              s.saveComments(documentId, projectRoot);
            },
            onActivity: (activity) => {
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
            onError: (errorMsg) => {
              clearPartialReply(documentId, comment.id);
              const s = useCommentStore.getState();
              s.addActivity(comment.id, {
                label: `Error: ${errorMsg}`,
                status: 'error',
                timestamp: Date.now(),
              });
              // Revert to done (not open) — thread already has replies
              s.setCommentStatus(documentId, comment.id, 'done');
              s.clearDelegationMode(comment.id);
              s.saveComments(documentId, projectRoot);
              toast.error(`Agent failed: ${errorMsg}`);
            },
            onChunk: (chunk) => {
              appendPartialReply(documentId, comment.id, chunk);
            },
          },
          {
            type: 'comment',
            label: comment.body.length > 50 ? comment.body.slice(0, 50) + '\u2026' : comment.body,
            sourceFile: activeTab?.filePath,
            commentId: comment.id,
            documentId,
            existingTaskId: comment.taskId,
          },
        );

        // Only update taskId if this is a new task (first delegation had no taskId)
        if (!comment.taskId) {
          store.setTaskId(documentId, comment.id, taskId);
          await store.saveComments(documentId, projectRoot);
        }
      } catch (error) {
        clearPartialReply(documentId, comment.id);
        const errMsg = error instanceof Error ? error.message : String(error);
        store.addActivity(comment.id, {
          label: `Spawn failed: ${errMsg}`,
          status: 'error',
          timestamp: Date.now(),
        });
        // Revert to done — thread already has replies
        store.setCommentStatus(documentId, comment.id, 'done');
        store.clearDelegationMode(comment.id);
        await store.saveComments(documentId, projectRoot);
        toast.error(`Agent delegation failed: ${errMsg}`);
      }
    },
    [startTask, taskConnection]
  );

  const cancelDelegation = useCallback(
    async (comment: Comment, documentId: string, projectRoot: string) => {
      clearPartialReply(documentId, comment.id);
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
      s.clearDelegationMode(comment.id);
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
        await delegateComment(comment, documentId, projectRoot, 'delegate');
      }
    },
    [delegateComment, taskConnection]
  );

  /** Move a comment conversation to the chat panel for more room. */
  const moveToChat = useCallback(
    (comment: Comment) => {
      const anchorSnippet = comment.anchorText.length > 80
        ? comment.anchorText.slice(0, 80) + '\u2026'
        : comment.anchorText;

      // Build context message from the full thread
      const contextParts = [
        'Continuing a conversation about the following text:',
        '',
        `> ${comment.anchorText}`,
        '',
        `Original comment: ${comment.body}`,
      ];

      for (const reply of comment.replies ?? []) {
        contextParts.push('');
        contextParts.push(`${reply.author}: ${reply.body}`);
      }

      const contextMessage = contextParts.join('\n');

      // Inject into chat panel
      const chatStore = useChatStore.getState();
      chatStore.addMessage({ role: 'system', content: contextMessage });
      chatStore.addMessage({ role: 'user', content: `Continue the conversation about: "${anchorSnippet}"` });

      // Open chat panel
      useSettingsStore.getState().setChatPanelOpen(true);
    },
    []
  );

  const canDelegate = !!taskConnection;

  return { delegateComment, delegateReply, cancelDelegation, delegateAll, moveToChat, canDelegate };
}
