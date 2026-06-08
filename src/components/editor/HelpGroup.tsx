import { HelpCircle, Command as CommandIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function HelpGroup({ onShortcutsOpen }: { onShortcutsOpen?: () => void }) {
  return (
    <section className="space-y-2" aria-label="Help">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Help</span>
      </div>
      {onShortcutsOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onShortcutsOpen}
              className={cn(
                "w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors",
                "rounded-sm px-2 py-1 hover:bg-muted/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <CommandIcon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 text-left">Keyboard shortcuts</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {"⌘7"}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Show all keyboard shortcuts
          </TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}
