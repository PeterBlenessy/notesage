import { File, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ContextItem } from '@/hooks/useChatContext';

interface ContextPillProps {
  item: ContextItem;
  onDismiss: (id: string) => void;
}

export function ContextPill({ item, onDismiss }: ContextPillProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="group inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground text-xs px-1.5 py-0.5 max-w-[180px] transition-all duration-150">
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="truncate">{item.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(item.id);
              }}
              className="shrink-0 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-accent-foreground/10 p-px"
              aria-label={`Remove ${item.label} from context`}
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-80">
          <p className="text-xs font-mono break-all">{item.path}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
