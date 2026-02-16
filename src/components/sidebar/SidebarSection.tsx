import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  title: string;
  actions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function SidebarSection({
  title,
  actions,
  open,
  onOpenChange,
  children,
}: SidebarSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className="mx-2 mt-1.5 rounded-lg border overflow-hidden transition-colors"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Title bar */}
        <div
          className="group flex items-center justify-between h-8 px-2.5 transition-colors"
          style={{ backgroundColor: "var(--color-muted)" }}
        >
          <CollapsibleTrigger className="flex items-center gap-1.5 cursor-pointer select-none flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 transition-transform duration-150",
                open ? "rotate-90 text-foreground/60" : "text-muted-foreground"
              )}
            />
            <span
              className={cn(
                "text-[11px] font-semibold tracking-wider uppercase transition-colors duration-150",
                open ? "text-foreground/70" : "text-muted-foreground"
              )}
            >
              {title}
            </span>
          </CollapsibleTrigger>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {actions}
          </div>
        </div>

        {/* Content area */}
        <CollapsibleContent>
          <div
            className="border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
