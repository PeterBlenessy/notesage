import { CheckSquare, MessageSquare, Bot, Target } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { ActionItem } from '@/stores/action-store';

const SOURCE_ICONS = {
  task: CheckSquare,
  comment: MessageSquare,
  agent: Bot,
  goal: Target,
} as const;

const SOURCE_LABELS = {
  task: 'task',
  comment: 'comment',
  agent: 'agent',
  goal: 'goal',
} as const;

interface ActionItemRowProps {
  action: ActionItem;
  projectRoot?: string;
  onClick?: (action: ActionItem) => void;
  onToggle?: (action: ActionItem) => void;
}

export function ActionItemRow({ action, projectRoot, onClick, onToggle }: ActionItemRowProps) {
  const Icon = SOURCE_ICONS[action.source_type as keyof typeof SOURCE_ICONS] ?? CheckSquare;
  const label = SOURCE_LABELS[action.source_type as keyof typeof SOURCE_LABELS] ?? action.source_type;
  const isDone = action.status === 'done' || action.status === 'completed';
  const isCheckable = action.source_type === 'task' || action.source_type === 'goal';
  const replyCount = (action.metadata as Record<string, unknown> | undefined)?.replyCount as number | undefined;

  // Build relative path for display
  let displayPath = action.file_path;
  if (projectRoot && displayPath.startsWith(projectRoot)) {
    displayPath = displayPath.slice(projectRoot.length + 1);
  }
  if (action.line_number) {
    displayPath = `${displayPath}:${action.line_number}`;
  }

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking the checkbox
    if ((e.target as HTMLElement).closest('[data-action-checkbox]')) return;
    onClick?.(action);
  };

  const handleCheckbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle?.(action);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex items-start gap-2 px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
          onClick={handleClick}
        >
          {/* Checkbox or icon */}
          <div className="mt-0.5 shrink-0" data-action-checkbox>
            {isCheckable ? (
              <Checkbox
                checked={isDone}
                onClick={handleCheckbox}
                className="h-4 w-4"
              />
            ) : (
              <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <p className={`text-sm break-words ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
              {action.text}
            </p>
            <p className="text-[11px] text-muted-foreground/60 break-words mt-0.5">
              {displayPath}
              {replyCount ? ` — ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : ''}
            </p>
          </div>

          {/* Badge */}
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full mt-0.5 ${
            isDone
              ? 'bg-muted text-muted-foreground'
              : action.status === 'delegated'
              ? 'bg-muted text-foreground/70'
              : action.status === 'running'
              ? 'bg-muted text-foreground/70'
              : action.status === 'error'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground'
          }`}>
            {action.status === 'delegated' ? 'delegated' : label}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onClick?.(action)}>
          Open file
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(action.text)}>
          Copy text
        </ContextMenuItem>
        {isCheckable && !isDone && (
          <ContextMenuItem onClick={() => onToggle?.(action)}>
            Mark done
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
