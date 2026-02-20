/**
 * Tracks files recently written by this app to prevent the file watcher
 * from mistaking our own saves as external changes.
 */
const recentWrites = new Map<string, number>();

function normalize(p: string): string {
  let r = p.endsWith("/") ? p.slice(0, -1) : p;
  if (r.startsWith("/private/")) {
    const w = r.slice("/private".length);
    if (w.startsWith("/var/") || w.startsWith("/tmp/") || w.startsWith("/etc/")) r = w;
  }
  return r;
}

/** Call before writing a file to suppress the next file-watcher event for this path. */
export function markSelfWrite(path: string): void {
  const key = normalize(path);
  recentWrites.set(key, Date.now());
  setTimeout(() => recentWrites.delete(key), 2000);
}

/**
 * Returns true if the given (normalized) path was recently written by this app.
 * Consumes the entry so subsequent events are not suppressed.
 */
export function isSelfWrite(normalizedPath: string): boolean {
  const key = normalize(normalizedPath);
  const ts = recentWrites.get(key);
  if (!ts) return false;
  recentWrites.delete(key);
  return Date.now() - ts < 2000;
}
