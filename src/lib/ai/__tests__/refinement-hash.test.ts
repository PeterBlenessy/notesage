import { describe, expect, it } from "vitest";

import { createSeenSet, hashLine } from "../refinement-hash";

describe("hashLine", () => {
  it("is stable for identical text", () => {
    expect(hashLine("hello world")).toBe(hashLine("hello world"));
  });

  it("ignores cosmetic whitespace (trim + internal collapse)", () => {
    const base = hashLine("hello world");
    expect(hashLine("  hello world  ")).toBe(base);
    expect(hashLine("hello   world")).toBe(base);
    expect(hashLine("\thello\tworld\n")).toBe(base);
    expect(hashLine("hello \t world")).toBe(base);
  });

  it("produces distinct hashes for distinct text", () => {
    expect(hashLine("hello world")).not.toBe(hashLine("goodbye world"));
    expect(hashLine("foo")).not.toBe(hashLine("bar"));
    // Content difference that survives normalization.
    expect(hashLine("a b")).not.toBe(hashLine("ab"));
  });

  it("returns a short hex string", () => {
    const h = hashLine("some content line");
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeLessThanOrEqual(8);
  });

  it("handles the empty / whitespace-only line", () => {
    expect(hashLine("")).toBe(hashLine("   "));
    expect(hashLine("")).toBe(hashLine("\t\n  "));
  });

  it("has low collision rate across many distinct lines", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      seen.add(hashLine(`line number ${i} with content`));
    }
    // No collisions expected for this small, structured set.
    expect(seen.size).toBe(5000);
  });
});

describe("createSeenSet", () => {
  it("tracks added hashes", () => {
    const set = createSeenSet(10);
    expect(set.has("a")).toBe(false);
    set.add("a");
    expect(set.has("a")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("does not grow on duplicate adds", () => {
    const set = createSeenSet(10);
    set.add("a");
    set.add("a");
    set.add("a");
    expect(set.size).toBe(1);
  });

  it("clears all entries", () => {
    const set = createSeenSet(10);
    set.add("a");
    set.add("b");
    expect(set.size).toBe(2);
    set.clear();
    expect(set.size).toBe(0);
    expect(set.has("a")).toBe(false);
  });

  it("rejects invalid capacity", () => {
    expect(() => createSeenSet(0)).toThrow();
    expect(() => createSeenSet(-5)).toThrow();
    expect(() => createSeenSet(1.5)).toThrow();
  });

  it("evicts the oldest entry past capacity", () => {
    const set = createSeenSet(3);
    set.add("a"); // oldest
    set.add("b");
    set.add("c");
    set.add("d"); // pushes capacity to 4 → evicts "a"

    expect(set.size).toBe(3);
    expect(set.has("a")).toBe(false); // oldest gone
    expect(set.has("b")).toBe(true);
    expect(set.has("c")).toBe(true);
    expect(set.has("d")).toBe(true); // newest kept
  });

  it("refreshes recency on re-add (move to most-recent)", () => {
    const set = createSeenSet(3);
    set.add("a");
    set.add("b");
    set.add("c");
    // Re-add "a" → "a" becomes most-recent, "b" is now oldest.
    set.add("a");
    set.add("d"); // evicts oldest, which is now "b"

    expect(set.has("b")).toBe(false);
    expect(set.has("a")).toBe(true);
    expect(set.has("c")).toBe(true);
    expect(set.has("d")).toBe(true);
  });

  it("keeps a frequently-touched key alive across evictions via has()", () => {
    const set = createSeenSet(3);
    set.add("hot");
    set.add("b");
    set.add("c");

    // Touch "hot" via has() to refresh its recency, then keep adding new keys.
    for (let i = 0; i < 10; i++) {
      expect(set.has("hot")).toBe(true); // refreshes recency
      set.add(`new-${i}`);
    }

    // "hot" survived all evictions because every iteration refreshed it.
    expect(set.has("hot")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("uses default capacity of 2000", () => {
    const set = createSeenSet();
    for (let i = 0; i < 2500; i++) {
      set.add(`k-${i}`);
    }
    expect(set.size).toBe(2000);
    // The first 500 keys should have been evicted.
    expect(set.has("k-0")).toBe(false);
    expect(set.has("k-499")).toBe(false);
    expect(set.has("k-500")).toBe(true);
    expect(set.has("k-2499")).toBe(true);
  });

  it("integrates with hashLine for dedup", () => {
    const set = createSeenSet(100);
    const h1 = hashLine("  the same   line ");
    const h2 = hashLine("the same line");
    set.add(h1);
    expect(set.has(h2)).toBe(true); // normalization collapses both to one key
  });
});
