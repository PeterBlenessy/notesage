/**
 * Content hashing + LRU seen-set for the ambient action-refinement engine.
 *
 * Lines are keyed by a content hash so already-analyzed lines aren't
 * re-analyzed, and a bounded "seen-set" remembers lines the engine looked at
 * and had nothing to refine.
 *
 * PRD: docs/prds/2026-06-13-ambient-action-refinement.md (Task #2)
 */

/**
 * Normalize a line so cosmetic whitespace edits don't bust the hash:
 * trim the ends, then collapse any internal run of whitespace to a single
 * space.
 */
function normalizeLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Compute a fast, deterministic, non-cryptographic hash of a line.
 *
 * The line is normalized first (see {@link normalizeLine}) so that the same
 * visible content always produces the same key regardless of cosmetic
 * whitespace. The hash uses FNV-1a (32-bit) and is returned as a short hex
 * string.
 *
 * This is a dedup / watermark key, NOT a security primitive — do not rely on
 * it for anything that needs collision resistance against an adversary.
 *
 * @param text The raw line text.
 * @returns A short hex string. Same normalized text → identical hash;
 *   different text → (practically) different hash.
 */
export function hashLine(text: string): string {
  const normalized = normalizeLine(text);

  // FNV-1a (32-bit).
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    // Multiply by the FNV prime using Math.imul for correct 32-bit overflow.
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Coerce to an unsigned 32-bit integer, then to a fixed-width hex string.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A bounded least-recently-used set of content hashes.
 *
 * Recency policy: BOTH `add` and `has` refresh recency — touching a key (by
 * adding it again or by checking for its presence) moves it to the
 * most-recent position, so frequently-referenced keys survive eviction. When
 * the size exceeds `capacity`, the oldest (least-recently-touched) key is
 * evicted.
 *
 * Not persisted — this lives only for the duration of an engine session.
 */
export interface SeenSet {
  /**
   * Whether a hash is present. Refreshes the hash's recency when found.
   */
  has(hash: string): boolean;
  /**
   * Record a hash as seen. Refreshes recency if already present; evicts the
   * oldest entry when capacity is exceeded.
   */
  add(hash: string): void;
  /** Current number of tracked hashes. */
  readonly size: number;
  /** Drop every tracked hash. */
  clear(): void;
}

/**
 * Create a bounded LRU seen-set.
 *
 * @param capacity Maximum number of hashes to retain (default 2000).
 *   Must be a positive integer.
 */
export function createSeenSet(capacity = 2000): SeenSet {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(
      `createSeenSet: capacity must be a positive integer, got ${capacity}`,
    );
  }

  // A Map preserves insertion order, which we use as recency order:
  // the first key is the oldest (least-recently-touched), the last is the
  // most-recent.
  const entries = new Map<string, true>();

  return {
    has(hash: string): boolean {
      if (!entries.has(hash)) {
        return false;
      }
      // Refresh recency: delete then re-insert to move to the most-recent
      // position.
      entries.delete(hash);
      entries.set(hash, true);
      return true;
    },

    add(hash: string): void {
      // If present, drop it first so re-insertion moves it to most-recent.
      if (entries.has(hash)) {
        entries.delete(hash);
      }
      entries.set(hash, true);

      // Evict oldest entries until within capacity. A single add can only
      // exceed by one, but the loop is robust regardless.
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },

    get size(): number {
      return entries.size;
    },

    clear(): void {
      entries.clear();
    },
  };
}
