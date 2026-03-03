import { RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncedIconProps {
  icon: LucideIcon;
  synced: boolean;
  folder?: boolean;
  className?: string;
}

/**
 * Renders a file/folder icon with sync indication.
 * Folders: swaps to FolderSync icon when synced.
 * Files: overlays a small RefreshCw badge in the bottom-right corner.
 */
export function SyncedIcon({ icon: Icon, synced, folder, className }: SyncedIconProps) {
  if (!synced) {
    return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/70", className)} strokeWidth={1.5} />;
  }

  if (folder) {
    return (
      <span className="relative shrink-0 h-3.5 w-3.5" title="Synced to iCloud">
        <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70", className)} strokeWidth={1.5} />
        <span className="absolute -right-[3px] -bottom-[1px] flex items-center justify-center h-[11px] w-[11px] rounded-full bg-background">
          <RefreshCw className="h-[8px] w-[8px] text-muted-foreground" strokeWidth={2} />
        </span>
      </span>
    );
  }

  return (
    <span className="relative shrink-0 h-3.5 w-3.5" title="Synced to iCloud">
      <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70", className)} strokeWidth={1.5} />
      <span className="absolute -right-[3px] -bottom-[2px] flex items-center justify-center h-[11px] w-[11px] rounded-full bg-background">
        <RefreshCw className="h-[8px] w-[8px] text-muted-foreground" strokeWidth={2} />
      </span>
    </span>
  );
}
