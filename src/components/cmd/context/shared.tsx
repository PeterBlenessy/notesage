import { Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Divider() {
  return <div className="h-4 w-px bg-border shrink-0" aria-hidden />;
}

interface IconButtonProps {
  ariaLabel: string;
  icon: typeof Clock;
  onClick: () => void;
  /** Tooltip text shown on hover/focus. Defaults to `ariaLabel`. */
  tooltip?: string;
}

export function IconButton({ ariaLabel, icon: Icon, onClick, tooltip }: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded-md shrink-0",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          {tooltip ?? ariaLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
