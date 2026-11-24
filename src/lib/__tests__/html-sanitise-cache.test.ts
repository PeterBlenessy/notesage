import { describe, it, expect } from "vitest";
import { createHtmlSanitiseCache } from "@/lib/html-sanitise-cache";

/** A fresh string object with the same characters, as a re-read file would be. */
function copyOf(text: string): string {
  return (" " + text).slice(1);
}

describe("html sanitise cache", () => {
  it("answers only for the exact text an entry was built from", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 1000, maxEntries: 4 });
    cache.set("/a.html", "default", "<p>one</p>", "ONE", 10);

    expect(cache.get("/a.html", "default", copyOf("<p>one</p>"))).toBe("ONE");
    expect(cache.get("/b.html", "default", "<p>one</p>")).toBeNull();
    expect(cache.get("/a.html", "block-external", "<p>one</p>")).toBeNull();
  });

  it("drops an entry when the file's text changed, even at the same length", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 1000, maxEntries: 4 });
    cache.set("/a.html", "default", "<p>one</p>", "ONE", 10);

    expect(cache.get("/a.html", "default", "<p>two</p>")).toBeNull();
    expect(cache.size).toBe(0);
    expect(cache.totalChars).toBe(0);
    // The old text does not come back either.
    expect(cache.get("/a.html", "default", "<p>one</p>")).toBeNull();
  });

  it("evicts the least recently used entry when the character budget is exceeded", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 100, maxEntries: 10 });
    cache.set("/a", "v", "a", "A", 40);
    cache.set("/b", "v", "b", "B", 40);
    expect(cache.get("/a", "v", "a")).toBe("A"); // /a is now the most recent
    cache.set("/c", "v", "c", "C", 40);

    expect(cache.get("/b", "v", "b")).toBeNull();
    expect(cache.get("/a", "v", "a")).toBe("A");
    expect(cache.get("/c", "v", "c")).toBe("C");
    expect(cache.totalChars).toBe(80);
  });

  it("evicts by entry count as well", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 1000, maxEntries: 2 });
    cache.set("/a", "v", "a", "A", 1);
    cache.set("/b", "v", "b", "B", 1);
    cache.set("/c", "v", "c", "C", 1);
    expect(cache.size).toBe(2);
    expect(cache.get("/a", "v", "a")).toBeNull();
  });

  it("does not keep an entry larger than the whole budget, and forgets the one it replaces", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 100, maxEntries: 10 });
    cache.set("/a", "v", "old", "OLD", 10);
    cache.set("/a", "v", "new", "NEW", 101);
    expect(cache.size).toBe(0);
    expect(cache.totalChars).toBe(0);
  });

  it("replacing an entry does not double-count it", () => {
    const cache = createHtmlSanitiseCache<string>({ maxChars: 100, maxEntries: 10 });
    cache.set("/a", "v", "one", "ONE", 60);
    cache.set("/a", "v", "two", "TWO", 70);
    expect(cache.size).toBe(1);
    expect(cache.totalChars).toBe(70);
    expect(cache.get("/a", "v", "two")).toBe("TWO");
  });
});
