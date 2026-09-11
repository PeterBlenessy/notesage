import { useEffect } from "react";
import { Island } from "./Chrome";
import { setChromeStatus } from "./chrome-status";
import { nativeChromeStatus } from "./useNativeChrome";
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
 *
 * # Where it draws, and why that took two goes
 *
 * On a native build this component renders NOTHING. It publishes the line to
 * `chrome-status`, `useNativeChrome` folds that into the next chrome push,
 * and `ChromeOverlay.layoutBottomColumn` — the single owner of the
 * bottom-centre slot — stacks it above the search pill and the transport.
 *
 * It used to draw its own `<Island corner="bottom-center">`, which is the
 * same strip of screen the native search island occupies. Neither knew the
 * other existed, so the pill appeared under the search island and was gone
 * before it could be read: "some kind of status indication behind the search
 * island … looked like some kind of mini notification or pill, I don't know
 * exactly" (Peter, device, build 60, #995).
 *
 * The web island survives for builds with no native layer — desktop dev and
 * tests — where nothing else is drawing in that strip and it is the only
 * chrome there will be.
 */
export function SweepIndicator({ progress }: { progress: SweepProgress }) {
  // Re-render on a language change so t() below re-evaluates.
  useLocale();

  // Only count once there is more than one document — "1 of 1" is noise that
  // reads as a progress bar for something already finished.
  const label = !progress.active
    ? null
    : progress.total > 1
      ? t("sweep.savingCount", { done: progress.done + 1, total: progress.total })
      : t("sweep.saving");

  // Published unconditionally: on a build with no native layer the field is
  // simply never read, and gating the publish on `nativeChromeStatus()` would
  // race the first screen's answer.
  useEffect(() => {
    setChromeStatus(label === null ? null : { label, busy: true });
  }, [label]);

  // Clearing belongs to UNMOUNT, not to a label change. As a cleanup on the
  // effect above it would publish `null` and then the new label on every
  // swept document — two store writes where one is meant, relying on React's
  // batching to coalesce them back into a single chrome push.
  useEffect(() => () => setChromeStatus(null), []);

  // `false` — no native layer, so this is the only chrome in that strip.
  // `true` — the native column has it; a web island here would collide.
  // `null` — nobody has asked yet; draw nothing rather than draw it twice.
  if (label === null || nativeChromeStatus() !== false) return null;

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
