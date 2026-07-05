/**
 * Compact relative-time label used by the Quiet sidebar's Pinned and
 * Recent rows (mockup-d shows "2h", "1d", "3d" beside the file name).
 * Uses single-character unit suffixes — no leading "saved" prefix —
 * so the label fits in a tight right-side column without truncation.
 */
export function formatSavedShort(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}
