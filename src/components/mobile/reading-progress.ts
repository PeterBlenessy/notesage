import { t } from "@/lib/i18n";

/** Progress at or past this reads as "Read" — the last few percent are the
 *  footer and the clipped-from line, not the article. */
export const READ_THRESHOLD = 0.97;

/**
 * The `site · …` line's reading part for a list row (#836).
 *
 * - no estimate → nothing
 * - never opened → "4 min"
 * - part-read → "2 of 4 min left" (never "0 of 4": a started article always
 *   has at least a minute left until it reads as done)
 * - ≥ READ_THRESHOLD → "Read"
 */
export function readingLine(minutes: number | null, progress: number): string | null {
  if (minutes == null) return null;
  if (progress >= READ_THRESHOLD) return t("list.read");
  if (progress <= 0) return t("list.minutes", { total: minutes });
  const left = Math.max(1, Math.ceil(minutes * (1 - progress)));
  return t("list.minutesLeft", { left, total: minutes });
}
