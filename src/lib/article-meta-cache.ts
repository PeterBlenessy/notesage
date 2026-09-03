import { iosArticleCardMeta, type ArticleCardMeta } from "@/lib/ios-api";

/**
 * Session cache for a list row's article metadata (#836).
 *
 * Keyed by path AND modification time: a file rewritten in place (update from
 * source, the background image sweep) changes its mtime and so misses the
 * cache, while backing out of a folder and into it again — which remounts
 * every row — hits it and renders instantly. Rename/delete need no eviction:
 * the old key simply stops being asked for.
 */
const cache = new Map<string, Promise<ArticleCardMeta | null>>();
const MAX_ENTRIES = 1000;

export function articleMetaFor(relPath: string, modified: number | undefined): Promise<ArticleCardMeta | null> {
  const key = `${relPath}@${modified ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = iosArticleCardMeta(relPath).catch(() => null);
  cache.set(key, pending);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

/** Test seam. */
export function clearArticleMetaCache(): void {
  cache.clear();
}
