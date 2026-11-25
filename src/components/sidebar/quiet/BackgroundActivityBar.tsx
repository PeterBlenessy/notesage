import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface BackgroundActivityBarProps {
  /** The accessible name, e.g. "Indexing your library, 1,200 of 3,000 files". */
  label: string;
  /** 0–1, or `null` while the total is not known (indeterminate). */
  fraction: number | null;
}

/**
 * The 2px progress line along the sidebar footer's top border, shown while
 * the library is being indexed (or a model is downloading).
 *
 * It is laid over the border, out of the flow, so the footer keeps its
 * height; it takes no pointer events; and it ends 7px above the Settings
 * button and the status strip, which it must never cover (see
 * `e2e/tests/sidebar/settings-button.spec.ts`). The parent must be
 * `position: relative`.
 *
 * The indeterminate sweep and its reduced-motion fallback are in
 * `globals.css` under `[data-activity-bar]`.
 */
export function BackgroundActivityBar({ label, fraction }: BackgroundActivityBarProps) {
  const value = fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <Progress
      data-activity-bar
      aria-label={label}
      value={value}
      max={100}
      className={cn(
        "absolute inset-x-0 -top-px h-0.5 rounded-none bg-transparent",
        "pointer-events-none",
        "[&>[data-slot=progress-indicator]]:bg-[var(--color-accent-primary)]",
        "[&>[data-slot=progress-indicator]]:opacity-70",
        "[&>[data-slot=progress-indicator]]:transition-transform",
        "[&>[data-slot=progress-indicator]]:duration-300",
        "motion-reduce:[&>[data-slot=progress-indicator]]:transition-none",
      )}
    />
  );
}
