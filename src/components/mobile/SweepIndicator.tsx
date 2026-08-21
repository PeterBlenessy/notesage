import { Island } from "./Chrome";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import type { SweepProgress } from "./useInlineSweep";

/**
 * Passive progress for the background image sweep (task #1.6).
 *
 * Deliberately the quietest possible surface: a bottom-centre island that
 * appears while a sweep runs and disappears when it finishes. No modal, no
 * blocking, no overlay on the content, and nothing to dismiss — the library
 * stays entirely usable, which is the point of doing this work in the
 * background at all.
 *
 * It exists because silence is worse than a whisper here. Without it, a user
 * who shares an article and immediately opens the app sees a document quietly
 * change under them — the thumbnail redraws, the file grows — with no
 * explanation. One line makes it legible.
 *
 * The wording says what the work is FOR ("saving for offline") rather than
 * what it mechanically does ("embedding images"). Nobody wants images
 * embedded; they want the article to work on a plane.
 */
export function SweepIndicator({ progress }: { progress: SweepProgress }) {
  // Re-render on a language change so t() below re-evaluates.
  useLocale();

  if (!progress.active) return null;

  // Only count once there is more than one document — "1 of 1" is noise that
  // reads as a progress bar for something already finished.
  const label =
    progress.total > 1
      ? t("sweep.savingCount", { done: progress.done + 1, total: progress.total })
      : t("sweep.saving");

  return (
    <Island corner="bottom-center">
      {/* `role="status"` + polite: announced to VoiceOver once, without
          stealing focus or interrupting what is being read. */}
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-2 py-0.5 text-xs text-muted-foreground"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-muted)" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--color-foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="9.4 28.3"
          />
        </svg>
        {label}
      </span>
    </Island>
  );
}
