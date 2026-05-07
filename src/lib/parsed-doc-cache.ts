/**
 * In-memory cache of worker-parsed `ParseResult`s, keyed by file path.
 *
 * Purpose: when the user clicks a tab and a NEW click aborts the streaming
 * hydration mid-way, the worker has already done its 300 ms of parsing —
 * we'd be throwing that away. Instead we cache the `ParseResult` and reuse
 * it on the next click of the same file, skipping the worker entirely.
 *
 * Like an fs read cache: cheap to populate after a successful parse,
 * straight win on revisit (next click → no worker round-trip → straight to
 * streaming hydrate). Invalidated when the document's content changes
 * (save, external write, editor mutation), so cached parses can never be
 * served against stale source.
 *
 * Memory: bounded by `MAX_CACHE_BYTES`. Each entry's size is an estimate
 * (top-level node count × 1 KB heuristic, same shape as
 * `editor-state-cache`). When the budget is exceeded we evict by LRU
 * (Map insertion order, refreshed on `get`).
 *
 * Lost on app quit (in-memory only). For cross-session cache, the IDB
 * viewport cache (Phase 3b Layer 3b) is the appropriate layer.
 */

import type { ParseResult } from "@/workers/markdown-parse.types";

const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB

interface CachedParse {
  result: ParseResult;
  /** Heuristic byte estimate for LRU budgeting. */
  byteSize: number;
}

class ParsedDocCache {
  private entries = new Map<string, CachedParse>();
  private totalBytes = 0;

  /**
   * Read and refresh LRU position. Caller must verify content is still
   * the same — this cache trusts callers to invalidate via `delete` on
   * any mutation. We do NOT hash content on read because it would defeat
   * the latency win we're chasing here (hashing 500 KB is ~5–10 ms).
   */
  get(filePath: string): ParseResult | undefined {
    const entry = this.entries.get(filePath);
    if (!entry) return undefined;
    // Refresh LRU order
    this.entries.delete(filePath);
    this.entries.set(filePath, entry);
    return entry.result;
  }

  /**
   * Read WITHOUT refreshing LRU position. Useful for callers that need to
   * inspect the cache without affecting eviction order — e.g. checking
   * whether a parse result exists before deciding whether to re-parse,
   * without "touching" the entry and inadvertently keeping it alive over
   * a file that hasn't been revisited. Never use this as a replacement
   * for `get` when the caller is about to hydrate the result.
   */
  peek(filePath: string): ParseResult | undefined {
    return this.entries.get(filePath)?.result;
  }

  has(filePath: string): boolean {
    return this.entries.has(filePath);
  }

  set(filePath: string, result: ParseResult): void {
    const byteSize = estimateParseResultBytes(result);
    const prev = this.entries.get(filePath);
    if (prev) {
      this.totalBytes -= prev.byteSize;
      this.entries.delete(filePath);
    }
    this.entries.set(filePath, { result, byteSize });
    this.totalBytes += byteSize;
    this.evictIfOverCap();
  }

  delete(filePath: string): boolean {
    const prev = this.entries.get(filePath);
    if (!prev) return false;
    this.totalBytes -= prev.byteSize;
    return this.entries.delete(filePath);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  stats(): { totalBytes: number; entryCount: number } {
    return { totalBytes: this.totalBytes, entryCount: this.entries.size };
  }

  private evictIfOverCap(): void {
    if (this.totalBytes <= MAX_CACHE_BYTES) return;
    for (const key of Array.from(this.entries.keys())) {
      if (this.totalBytes <= MAX_CACHE_BYTES) break;
      if (this.entries.size === 1) break;
      const entry = this.entries.get(key)!;
      this.totalBytes -= entry.byteSize;
      this.entries.delete(key);
    }
  }
}

/** Singleton instance. */
export const parsedDocCache = new ParsedDocCache();

/**
 * Heuristic: top-level node count × 1 KB. Worker output's `doc.content`
 * is the array of top-level ProseMirror nodes (paragraphs, headings,
 * tables, etc.). For the 506 KB book this lands around 9 KB headline
 * nodes × 1 KB = 9 MB; including the side-channel maps and timings
 * brings it to ~10 MB per cached entry. Fits comfortably in 100 MB cap.
 */
function estimateParseResultBytes(result: ParseResult): number {
  const doc = result.doc as { content?: unknown[] } | null;
  const topLevelCount = Array.isArray(doc?.content) ? doc.content.length : 1;
  return topLevelCount * 1024;
}
