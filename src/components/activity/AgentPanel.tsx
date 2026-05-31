import { Bot } from 'lucide-react';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { ActivityTaskCard } from './ActivityTaskCard';

interface AgentPanelProps {
  onCancelTask?: (taskId: string) => void;
  onClickTask?: (task: AgentTask) => void;
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
export function AgentPanel({ onCancelTask, onClickTask }: AgentPanelProps) {
  const tasks = useActivityStore((s) => s.tasks);
  const removeTask = useActivityStore((s) => s.removeTask);

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

      {/* Task list or empty state */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar">
        {tasks.length === 0 ? (
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
      </div>
    </div>
  );
}

export default AgentPanel;
