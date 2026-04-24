import { useEffect, useState } from "react";
import { formatSavedLabel, pickTimerInterval } from "@/lib/saved-ago";

/**
 * "saved Xs ago" label — shared component used by the Quiet Composer
 * TitleBar (task #131) and originally the DocHead breadcrumb (deleted
 * with #131). The label is suppressed while the document is dirty
 * (because "saved Xs ago" would be misleading mid-edit) and also when
 * `lastSavedAt` is not yet known (a session-fresh tab that has never
 * been saved renders an em-dash).
 *
 * Polling cadence is adaptive via `pickTimerInterval` so the visible
 * label never lies: seconds refresh every 5 s, minutes every 30 s,
 * hours every 5 min, days every 30 min.
 */

interface SavedLabelProps {
  lastSavedAt: number | undefined;
  isDirty: boolean;
  /** Optional classname override so callers can tune size / colour. */
  className?: string;
}

export function SavedLabel({ lastSavedAt, isDirty, className }: SavedLabelProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isDirty) return;
    if (lastSavedAt === undefined) return;
    const tick = () => setNow(Date.now());
    tick();
    const elapsed = Date.now() - lastSavedAt;
    const interval = pickTimerInterval(elapsed);
    const id = window.setInterval(tick, interval);
    return () => window.clearInterval(id);
  }, [lastSavedAt, isDirty]);

  if (isDirty) return null;

  const baseClass = className ?? "text-xs text-muted-foreground tabular-nums";

  if (lastSavedAt === undefined) {
    return (
      <span
        className={baseClass}
        aria-live="polite"
        aria-label="Not yet saved this session"
      >
        &mdash;
      </span>
    );
  }

  const label = formatSavedLabel(now - lastSavedAt);
  return (
    <span className={baseClass} aria-live="polite">
      {label}
    </span>
  );
}

export default SavedLabel;
