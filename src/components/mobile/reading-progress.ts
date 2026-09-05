import { t } from "@/lib/i18n";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";

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

/**
 * Does this row still read as unopened? (Peter, device, build 50: "I cannot
 * tell which docs in the inbox are unread and read.")
 *
 * The rule is the sidecar's, shared with the badge and the Mac: an Inbox item
 * is unread until it has been OPENED. Progress alone cannot answer it —
 * opening an article and closing it at the first paragraph leaves a fraction
 * of 0, exactly like never touching it — so the store's `inboxOpened` is the
 * primary signal, with any recorded progress as a fallback for state written
 * before that field existed.
 *
 * Scoped to the Inbox on purpose. Everywhere else there is no read-later
 * contract, and marking every note in a folder "unread" would be noise.
 */
export function isUnreadRow(
  relPath: string,
  opened: Record<string, true>,
  progress: number,
): boolean {
  if (!relPath.startsWith(`${INBOX_FOLDER_NAME}/`)) return false;
  return !opened[relPath] && progress <= 0;
}
