import { CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActionStore } from "@/stores/action-store";

export function ActionsGroup({ onOpenActions }: { onOpenActions?: () => void }) {
  const openCount = useActionStore((s) => s.getOpenCount());

  return (
    <section className="space-y-2" aria-label="Actions">
      <div className="flex items-center gap-2">
        <CheckSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Actions</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onOpenActions}
            disabled={!onOpenActions}
            className={cn(
              "w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
              "rounded-sm px-2 py-1 hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <CheckSquare className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 text-left">
              {openCount === 0
                ? "No open actions"
                : `${openCount} open ${openCount === 1 ? "action" : "actions"}`}
            </span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{"⌘!"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          Open the actions dashboard
        </TooltipContent>
      </Tooltip>
    </section>
  );
}
