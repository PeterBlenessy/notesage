import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useSessionRunStore, selectUnwatchedRunning } from '@/stores/session-run-store';
import { useChatStore } from '@/stores/chat-store';
import { SessionStatusBadge } from '@/components/cmd/SessionStatusBadge';
import { ActivityTaskCard } from './ActivityTaskCard';

interface AgentPanelProps {
  onCancelTask?: (taskId: string) => void;
  onClickTask?: (task: AgentTask) => void;
  /** Foreground an unwatched session (task #14) — brings it into the command
   *  bar and closes the orb popover. */
  onSelectSession?: (conversationId: string) => void;
}

/**
 * AgentPanel (#79) — panel content that appears when the user opens the
 * `AgentOrb` popover. Renders the same task list as `ActivityPanel` (the
 * resizable right-hand rail), but sized for a popover and without the outer
 * chrome the rail provides.
 *
 * Focus trap, Esc-to-close, and focus restoration to the trigger are handled
 * by the shadcn `Popover` (Radix UI) wrapping this component in
 * `AgentOrb.tsx` — this component is intentionally unaware of open state.
 */
export function AgentPanel({ onCancelTask, onClickTask, onSelectSession }: AgentPanelProps) {
  const tasks = useActivityStore((s) => s.tasks);
  const removeTask = useActivityStore((s) => s.removeTask);

  // Unwatched chat sessions (task #14) — running/awaiting sessions the user
  // isn't currently watching. Subscribe to the raw store slices and derive the
  // list with useMemo: `selectUnwatchedRunning` builds a fresh array each call,
  // so subscribing to it directly would re-render on every store tick (and loop).
  const runs = useSessionRunStore((s) => s.runs);
  const foregroundConversationId = useSessionRunStore((s) => s.foregroundConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const sessions = useMemo(
    () =>
      selectUnwatchedRunning({ runs, foregroundConversationId }).sort(
        (a, b) =>
          (a.status === 'awaiting_permission' ? 0 : 1) -
          (b.status === 'awaiting_permission' ? 0 : 1),
      ),
    [runs, foregroundConversationId],
  );
  const titleFor = (id: string) =>
    conversations.find((c) => c.id === id)?.title || 'New Chat';

  const isEmpty = tasks.length === 0 && sessions.length === 0;

  return (
    <div
      role="region"
      aria-labelledby="agent-panel-heading"
      className="flex flex-col max-h-[min(60vh,480px)] w-[340px] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-border shrink-0">
        <span
          id="agent-panel-heading"
          className="text-xs font-medium text-foreground whitespace-nowrap"
        >
          Activity
        </span>
      </div>

      {/* Session list + task list, or empty state */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar">
        {isEmpty ? (
          <div
            data-testid="agent-panel-empty"
            className="flex flex-col items-center justify-center px-4 py-8 text-center gap-2"
          >
            <Bot
              className="h-6 w-6 text-muted-foreground/40"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              Nothing happening yet
            </span>
            <span className="text-xs text-muted-foreground/60">
              Agent tasks, recordings, and transcriptions show up here
            </span>
          </div>
        ) : (
          <>
            {/* Unwatched chat sessions (task #14). Click foregrounds the
                session in the command bar. */}
            {sessions.length > 0 && (
              <div data-testid="agent-panel-sessions" className="divide-y divide-border border-b border-border">
                <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Sessions
                </div>
                {sessions.map((run) => (
                  <button
                    key={run.conversationId}
                    type="button"
                    data-testid="agent-panel-session-row"
                    onClick={() => onSelectSession?.(run.conversationId)}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                  >
                    <SessionStatusBadge conversationId={run.conversationId} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {titleFor(run.conversationId)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {run.status === 'awaiting_permission' ? 'Needs you' : 'Running'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {tasks.length > 0 && (
              <div className="divide-y divide-border">
                {tasks.map((task) => (
                  <ActivityTaskCard
                    key={task.id}
                    task={task}
                    onCancel={onCancelTask}
                    onRemove={removeTask}
                    onClick={onClickTask}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default AgentPanel;
