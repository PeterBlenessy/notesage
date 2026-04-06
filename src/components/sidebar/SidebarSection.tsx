import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SidebarSectionProps {
  icon: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** When true, section content is hidden so icons stack tightly in the rail. */
  panelCollapsed?: boolean;
  /** Called when the rail icon is hovered (used to trigger sidebar expansion). */
  onIconHover?: () => void;
  /** Called when the rail icon is clicked (used to expand sidebar + section). */
  onIconClick?: () => void;
}

export function SidebarSection({
  icon,
  title,
  actions,
  open,
  onOpenChange,
  children,
  panelCollapsed,
  onIconHover,
  onIconClick,
}: SidebarSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      {/* Section header — icon sits in fixed 40px column, visible when collapsed */}
      <div className="group flex items-center h-9">
        <div
          className="w-10 shrink-0 flex items-center justify-center cursor-pointer"
          onMouseEnter={onIconHover}
          onClick={onIconClick}
        >
          <div
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded-md transition-colors duration-150",
              open && !panelCollapsed ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {icon}
          </div>
        </div>

        <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer select-none">
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-150",
              open ? "rotate-90 text-foreground/60" : "text-muted-foreground"
            )}
            strokeWidth={1.5}
          />
          <span
            className={cn(
              "text-xs font-semibold tracking-wider uppercase whitespace-nowrap transition-colors duration-150",
              open ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            {title}
          </span>
        </CollapsibleTrigger>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0 pr-2">
          {actions}
        </div>
      </div>

      {/* Content — hidden when panel is collapsed so icons stack tightly */}
      {!panelCollapsed && (
        <CollapsibleContent>
          <div className="pl-10 pr-1 pb-1">
            {children}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
