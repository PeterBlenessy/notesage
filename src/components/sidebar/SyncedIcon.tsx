import { Cloud, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncedIconProps {
  icon: LucideIcon;
  synced: boolean;
  className?: string;
}

/**
 * Renders a lucide icon with an optional cloud badge in the bottom-right corner.
 * Used in the sidebar to indicate files/folders synced to iCloud.
 */
export function SyncedIcon({ icon: Icon, synced, className }: SyncedIconProps) {
  if (!synced) {
    return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/70", className)} strokeWidth={1.5} />;
  }

  return (
    <span className="relative shrink-0 h-3.5 w-3.5" title="Synced to iCloud">
      <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70", className)} strokeWidth={1.5} />
      <Cloud
        className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-muted-foreground/60"
        strokeWidth={2}
      />
    </span>
  );
}
