/**
 * Shared formatter for the "saved Xs ago" indicator used by `DocHead` and
 * the quiet `StatusBar` (tasks #48 and #52 in the 2026-04-21 UI refresh).
 *
 * Buckets:
 *   < 60s  → "saved Ns ago"
 *   < 60m  → "saved Nm ago"
 *   < 24h  → "saved Nh ago"
 *   else   → "saved Nd ago"
 *
 * `pickTimerInterval` returns an appropriate polling interval so the visible
 * label never lies and the `setInterval` doesn't waste wakeups on a label
 * that has stabilised into a coarser bucket.
 */

export function formatSavedLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `saved ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `saved ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `saved ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `saved ${days}d ago`;
}

export function pickTimerInterval(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 5_000;
  if (elapsedMs < 3_600_000) return 30_000;
  if (elapsedMs < 86_400_000) return 5 * 60_000;
  return 30 * 60_000;
}
