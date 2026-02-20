import { Cloud, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncedIconProps {
  icon: LucideIcon;
  synced: boolean;
  folder?: boolean;
  className?: string;
}

/**
 * Renders a lucide icon with an optional cloud badge in the bottom-right corner.
 * Used in the sidebar to indicate files/folders synced to iCloud.
 */
export function SyncedIcon({ icon: Icon, synced, folder, className }: SyncedIconProps) {
  if (!synced) {
    return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/70", className)} strokeWidth={1.5} />;
  }

  return (
    <span className="relative shrink-0 h-3.5 w-3.5" title="Synced to iCloud">
      <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70", className)} strokeWidth={1.5} />
      <span className={cn("absolute -right-[3px] flex items-center justify-center h-[11px] w-[11px] rounded-full bg-white dark:bg-white", folder ? "-bottom-[1px]" : "-bottom-[2px]")}>
        <Cloud
          className="h-[9px] w-[9px] fill-muted-foreground/70 text-muted-foreground/70"
          strokeWidth={0}
        />
      </span>
    </span>
  );
}
