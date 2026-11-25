import { RefreshCw } from "lucide-react";
import { useBackgroundActivity } from "./status/use-background-activity";
import { indexingDetail } from "@/lib/indexing-label";
import { useIndexProgressStore } from "@/stores/index-progress-store";

/**
 * The status tray's line for what is running in the background: the same
 * sentence as the sidebar footer bar's label, and for indexing a second line
 * saying which projects are being read and how many have yet to start.
 * Renders nothing when idle.
 */
export function BackgroundActivityLine() {
  const activity = useBackgroundActivity();
  const indexing = useIndexProgressStore((s) => s.status);
  if (!activity.active || !activity.label) return null;
  const detail = activity.kind === "indexing" ? indexingDetail(indexing) : null;

  return (
    <div role="status" data-background-activity={activity.kind} className="flex items-start gap-2">
      <RefreshCw
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs">{activity.label}</p>
        {detail ? (
          <p className="truncate text-[11px] text-muted-foreground" title={detail}>
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
