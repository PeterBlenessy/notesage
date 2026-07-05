import { cn } from "@/lib/utils";
import { type ActivePrefix } from "@/components/cmd/prefix-modes";

interface PrefixModeBadgeProps {
  prefix: ActivePrefix;
}

/**
 * Visual indicator that a prefix mode is active. The actual mode picker
 * dropdown (file/skill/tag list, keyboard nav) is built in #14–#19; this
 * badge is just the signal that detection works and previews the mode
 * metadata until the pickers land.
 */
export function PrefixModeBadge({ prefix }: PrefixModeBadgeProps) {
  return (
    <div
      data-cmd-bar-prefix-badge
      role="status"
      aria-live="polite"
      className={cn(
        "border-t border-border px-3 py-2",
        "flex items-center gap-2 text-xs text-muted-foreground",
      )}
    >
      <span className="font-medium text-foreground">{prefix.mode.label}</span>
      <span className="text-muted-foreground/70">·</span>
      <kbd className="rounded bg-muted px-1 py-px text-[11px] text-foreground">
        {prefix.mode.prefix}
      </kbd>
      <span>{prefix.mode.description}</span>
    </div>
  );
}

export default PrefixModeBadge;
