/**
 * A small, bounded most-recently-used cache for prepared HTML-viewer
 * documents, so stepping back and forth between saved pages does not
 * sanitise the same megabytes again.
 *
 * An entry is only ever returned for the exact text it was built from: the
 * source string is kept and compared (`===`, a pointer check or one memcmp),
 * not hashed or sampled, because a same-length edit made in source mode must
 * never be answered with the previous render.
 *
 * Captures are large, so the cache is capped by total characters as well as
 * by entry count, and an entry too big to fit is not kept at all.
 */
export interface HtmlSanitiseCacheLimits {
  /** Upper bound on the summed `cost` of all entries. */
  maxChars: number;
  maxEntries: number;
}

interface Entry<T> {
  content: string;
  value: T;
  cost: number;
}

export interface HtmlSanitiseCache<T> {
  get(path: string, variant: string, content: string): T | null;
  /** `cost` is the caller's estimate of the characters the entry retains. */
  set(path: string, variant: string, content: string, value: T, cost: number): void;
  clear(): void;
  readonly size: number;
  readonly totalChars: number;
}

export function createHtmlSanitiseCache<T>(limits: HtmlSanitiseCacheLimits): HtmlSanitiseCache<T> {
  // Map iteration order is insertion order: the first key is the oldest.
  const entries = new Map<string, Entry<T>>();
  let total = 0;
  const keyOf = (path: string, variant: string) => `${variant}\u0000${path}`;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    total -= entry.cost;
    entries.delete(key);
  };

  return {
    get(path, variant, content) {
      const key = keyOf(path, variant);
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.content.length !== content.length || entry.content !== content) {
        // The file changed since: the entry can never be right again.
        drop(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(path, variant, content, value, cost) {
      const key = keyOf(path, variant);
      drop(key);
      if (cost > limits.maxChars || limits.maxEntries < 1) return;
      entries.set(key, { content, value, cost });
      total += cost;
      while (total > limits.maxChars || entries.size > limits.maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        drop(oldest.value);
      }
    },
    clear() {
      entries.clear();
      total = 0;
    },
    get size() {
      return entries.size;
    },
    get totalChars() {
      return total;
    },
  };
}
