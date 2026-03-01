import {
  Loader2,
  Check,
  X,
  BotMessageSquare,
  MessageCircle,
  Slash,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { ActivityTaskCard } from './ActivityTaskCard';

export const STRIP_WIDTH = 40;

interface ActivityStripProps {
  onCancelTask?: (taskId: string) => void;
  onClickTask?: (task: AgentTask) => void;
}

function RailIcon({ task }: { task: AgentTask }) {
  const TypeIcon = task.type === 'comment' ? BotMessageSquare : MessageCircle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative flex items-center justify-center w-10 h-10">
          <TypeIcon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          {/* Status badge */}
          <span className="absolute bottom-1.5 right-1.5">
            {task.status === 'running' ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
            ) : task.status === 'done' ? (
              <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={2} />
            ) : task.status === 'error' ? (
              <X className="h-2.5 w-2.5 text-destructive" strokeWidth={2} />
            ) : (
              <Slash className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={2} />
            )}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={4}>
        <p className="text-xs">{task.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Narrow 40px rail — always visible, shows icon per task */
export function ActivityRail() {
  const tasks = useActivityStore((s) => s.tasks);

  return (
    <div
      className="flex flex-col h-full border-l border-border bg-background shrink-0 overflow-hidden"
      style={{ width: STRIP_WIDTH }}
    >
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <TooltipProvider delayDuration={300}>
          <div className="flex flex-col items-center pt-1">
            {tasks.map((task) => (
              <RailIcon key={task.id} task={task} />
            ))}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** Expanded agent panel content — rendered inside a ResizablePanel */
export function ActivityPanel({ onCancelTask, onClickTask }: ActivityStripProps) {
  const tasks = useActivityStore((s) => s.tasks);
  const removeTask = useActivityStore((s) => s.removeTask);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-foreground whitespace-nowrap">Agent Tasks</span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <span className="text-xs text-muted-foreground">
              No agent tasks yet
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
