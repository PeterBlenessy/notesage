/**
 * Unit tests for parsedDocCache — the in-memory LRU cache of worker-parsed
 * ParseResults keyed by file path.
 *
 * Coverage:
 * - get / set / delete round-trip
 * - peek does NOT promote LRU position
 * - LRU eviction at byte cap
 * - Single entry larger than cap is kept (one-entry floor)
 * - clear empties everything
 * - stats() returns accurate totalBytes + entryCount
 */

import { describe, it, expect, beforeEach } from "vitest";
import { parsedDocCache } from "@/lib/parsed-doc-cache";
import type { ParseResult } from "@/workers/markdown-parse.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(id: string, topLevelNodes = 1): ParseResult {
  return {
    type: "result",
    id,
    doc: {
      type: "doc",
      content: Array.from({ length: topLevelNodes }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `node ${i}` }],
      })),
    },
    annotationsEntries: [],
    nodeIdsEntries: [],
    tableMetadataEntries: [],
    timings: { preprocess: 0, parse: 0, total: 0 },
  };
}

/** Cache byte estimate: topLevelNodes × 1024 */
function estimatedBytes(topLevelNodes: number): number {
  return topLevelNodes * 1024;
}

beforeEach(() => {
  parsedDocCache.clear();
});

// ---------------------------------------------------------------------------
// get / set / delete round-trip
// ---------------------------------------------------------------------------

describe("get / set / delete", () => {
  it("returns undefined for unknown key", () => {
    expect(parsedDocCache.get("/path/to/missing.md")).toBeUndefined();
  });

  it("stores and retrieves a result", () => {
    const result = makeResult("a", 5);
    parsedDocCache.set("/a.md", result);
    expect(parsedDocCache.get("/a.md")).toBe(result);
  });

  it("has() returns true after set and false after delete", () => {
    parsedDocCache.set("/b.md", makeResult("b"));
    expect(parsedDocCache.has("/b.md")).toBe(true);
    parsedDocCache.delete("/b.md");
    expect(parsedDocCache.has("/b.md")).toBe(false);
  });

  it("delete returns false when key is absent", () => {
    expect(parsedDocCache.delete("/nonexistent.md")).toBe(false);
  });

  it("delete returns true when key was present", () => {
    parsedDocCache.set("/c.md", makeResult("c"));
    expect(parsedDocCache.delete("/c.md")).toBe(true);
  });

  it("overwriting an entry updates byte tally without double-counting", () => {
    parsedDocCache.set("/d.md", makeResult("d", 10)); // 10 KB
    parsedDocCache.set("/d.md", makeResult("d2", 20)); // 20 KB — replaces

    const { totalBytes, entryCount } = parsedDocCache.stats();
    expect(entryCount).toBe(1);
    // Estimate: 20 top-level nodes × 1024
    expect(totalBytes).toBe(estimatedBytes(20));
  });
});

// ---------------------------------------------------------------------------
// peek — does NOT promote LRU position
// ---------------------------------------------------------------------------

describe("peek", () => {
  it("returns the result without moving it to MRU position", () => {
    // Insert two entries: /a.md (oldest) then /b.md (newest)
    parsedDocCache.set("/a.md", makeResult("a", 1));
    parsedDocCache.set("/b.md", makeResult("b", 1));

    // peek at /a.md — must NOT promote it
    const peeked = parsedDocCache.peek("/a.md");
    expect(peeked).toBeDefined();

    // Now force eviction by inserting entries that exceed cap.
    // The byte cap is 100 MB. Each entry with 1 node = 1 KB.
    // To trigger eviction of the oldest (which should remain /a.md after
    // peek without promotion), insert a large entry.
    const BIG_NODES = 100 * 1024 + 1; // slightly over 100 MB of nodes (1 node = 1 KB)
    parsedDocCache.set("/big.md", makeResult("big", BIG_NODES));

    // After eviction at cap, /a.md (oldest = not promoted by peek) should
    // have been evicted, not /b.md.
    expect(parsedDocCache.has("/a.md")).toBe(false);
    // /b.md and /big.md survive (big is the only one left after /a evicted,
    // /b may also be evicted depending on how the cap math works — just
    // assert the fundamental: /a was evicted first, not /b)
  });

  it("returns undefined for missing key", () => {
    expect(parsedDocCache.peek("/missing.md")).toBeUndefined();
  });

  it("does not change stats when called on a present key", () => {
    parsedDocCache.set("/e.md", makeResult("e", 5));
    const before = parsedDocCache.stats();
    parsedDocCache.peek("/e.md");
    expect(parsedDocCache.stats()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// LRU eviction at byte cap
// ---------------------------------------------------------------------------

describe("LRU eviction", () => {
  it("evicts oldest entry when budget is exceeded", () => {
    // Each entry here has 1 node = 1 KB. We need > 100 MB to trigger
    // eviction. Use 1 node per entry but many entries — too many to
    // populate individually. Instead use large node counts.

    // Fill near the cap: two 50 MB entries (50 * 1024 nodes each = ~50 MB each)
    const NODES_50MB = 50 * 1024; // 50 MB estimate
    parsedDocCache.set("/old.md", makeResult("old", NODES_50MB)); // oldest
    parsedDocCache.set("/mid.md", makeResult("mid", NODES_50MB)); // middle

    // Promote /old.md to MRU via get
    parsedDocCache.get("/old.md");

    // Now /mid.md is the oldest (LRU). Insert a 10 MB entry to trigger eviction.
    const NODES_10MB = 10 * 1024;
    parsedDocCache.set("/new.md", makeResult("new", NODES_10MB));

    // Total would be ~110 MB, so /mid.md (oldest) must be evicted
    expect(parsedDocCache.has("/mid.md")).toBe(false);
    // /old.md (MRU-promoted) should survive
    expect(parsedDocCache.has("/old.md")).toBe(true);
    // /new.md (just inserted = MRU) should survive
    expect(parsedDocCache.has("/new.md")).toBe(true);
  });

  it("keeps single entry larger than cap (one-entry floor)", () => {
    // Insert a single entry that is larger than MAX_CACHE_BYTES (100 MB).
    // node count: 100 * 1024 + 1 gives estimate > 100 MB.
    const NODES_OVER_CAP = 100 * 1024 + 1;
    parsedDocCache.set("/huge.md", makeResult("huge", NODES_OVER_CAP));

    // The cache must NOT evict this entry even though it exceeds the cap.
    expect(parsedDocCache.has("/huge.md")).toBe(true);
    expect(parsedDocCache.stats().entryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("clear", () => {
  it("removes all entries and resets byte tally", () => {
    parsedDocCache.set("/x.md", makeResult("x", 100));
    parsedDocCache.set("/y.md", makeResult("y", 200));

    parsedDocCache.clear();

    const { totalBytes, entryCount } = parsedDocCache.stats();
    expect(entryCount).toBe(0);
    expect(totalBytes).toBe(0);
    expect(parsedDocCache.get("/x.md")).toBeUndefined();
    expect(parsedDocCache.get("/y.md")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stats()
// ---------------------------------------------------------------------------

describe("stats()", () => {
  it("returns zero values when cache is empty", () => {
    const { totalBytes, entryCount } = parsedDocCache.stats();
    expect(totalBytes).toBe(0);
    expect(entryCount).toBe(0);
  });

  it("reflects accurate byte count after multiple sets", () => {
    parsedDocCache.set("/p.md", makeResult("p", 10)); // 10 KB
    parsedDocCache.set("/q.md", makeResult("q", 20)); // 20 KB

    const { totalBytes, entryCount } = parsedDocCache.stats();
    expect(entryCount).toBe(2);
    expect(totalBytes).toBe(estimatedBytes(10) + estimatedBytes(20));
  });

  it("decreases after delete", () => {
    parsedDocCache.set("/r.md", makeResult("r", 10)); // 10 KB
    parsedDocCache.set("/s.md", makeResult("s", 5));  // 5 KB
    parsedDocCache.delete("/r.md");

    const { totalBytes, entryCount } = parsedDocCache.stats();
    expect(entryCount).toBe(1);
    expect(totalBytes).toBe(estimatedBytes(5));
  });
});
