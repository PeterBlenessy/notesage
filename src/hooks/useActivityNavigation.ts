import { useCallback } from 'react';
import { toast } from 'sonner';
import { useFileOperations } from '@/hooks/useFileOperations';
import { useEditorStore } from '@/stores/editor-store';
import { useCommentStore } from '@/stores/comment-store';
import type { AgentTask } from '@/stores/activity-store';

/**
 * Provides a click handler for ActivityTaskCard that navigates to the
 * source file and activates the associated comment (if any).
 */
export function useActivityNavigation() {
  const { openFile } = useFileOperations();

  const handleClickTask = useCallback(
    async (task: AgentTask) => {
      // Only navigate for completed tasks
      if (task.status === 'running') return;

      if (!task.sourceFile) return;

      const fileName = task.sourceFile.split('/').pop() ?? task.sourceFile;

      // Check if the file is already the active tab
      const { tabs, activeTabId } = useEditorStore.getState();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const alreadyActive = activeTab?.filePath === task.sourceFile;

      if (!alreadyActive) {
        try {
          await openFile(task.sourceFile, fileName);
        } catch {
          // Expected: file may have been deleted or moved since task was created
          toast.error('Failed to open file');
          return;
        }
      }

      // For comment tasks, scroll to the comment and activate it after a delay (let editor mount)
      if (task.type === 'comment' && task.commentId && task.documentId) {
        const delay = alreadyActive ? 50 : 300;
        setTimeout(() => {
          const comments = useCommentStore.getState().commentsByDocument[task.documentId!] ?? [];
          const exists = comments.some((c) => c.id === task.commentId);
          if (exists) {
            useCommentStore.getState().requestScrollToComment(task.commentId!);
          } else {
            toast('Comment not found — it may have been deleted');
          }
        }, delay);
      }
    },
    [openFile]
  );

  return { handleClickTask };
}
