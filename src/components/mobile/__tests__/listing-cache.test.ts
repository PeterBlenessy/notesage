// Storage FIRST, before the store: zustand's `persist` reads its storage while
// the module initialises, and with none it bails out silently — returning a
// plain store with no `.persist` handle at all. The persistence assertion
// below would then be checking a store that was never persisted, which
// guarantees nothing. See `@/test/local-storage` for why Node 22+ needs this.
import "@/test/local-storage";
import { describe, it, expect, beforeEach } from "vitest";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * The listing survives a remount (#994).
 *
 * `MobileApp` renders `openDoc ? <Reader/> : <LibraryBrowser/>`, so opening a
 * document UNMOUNTS the browser and closing it mounts a new one. A fresh
 * browser began at `status: "loading"`, which threw away the list the reader
 * had been opened from and showed a skeleton for the frame it took to re-read
 * the folder — visible as the whole screen blinking, every time, with the
 * search island's item count arriving at the end of it.
 *
 * The cache is what lets the new browser start from what the old one had.
 */
const entry = (name: string) => ({
  name,
  path: `/lib/${name}`,
  is_directory: false,
  hidden: false,
});

describe("listing cache", () => {
  beforeEach(() => {
    useMobileStore.setState({ listingCache: {} });
  });

  it("remembers a folder's entries by path", () => {
    useMobileStore.getState().rememberListing("Inbox", [entry("a.md")]);
    expect(useMobileStore.getState().listingCache["Inbox"]).toHaveLength(1);
  });

  it("keeps folders apart", () => {
    useMobileStore.getState().rememberListing("Inbox", [entry("a.md")]);
    useMobileStore.getState().rememberListing("Notes", [entry("b.md"), entry("c.md")]);
    expect(useMobileStore.getState().listingCache["Inbox"]).toHaveLength(1);
    expect(useMobileStore.getState().listingCache["Notes"]).toHaveLength(2);
  });

  it("replaces a folder's entries rather than merging them", () => {
    // A file deleted elsewhere must not survive in the cache.
    useMobileStore.getState().rememberListing("Inbox", [entry("a.md"), entry("b.md")]);
    useMobileStore.getState().rememberListing("Inbox", [entry("a.md")]);
    expect(useMobileStore.getState().listingCache["Inbox"].map((e) => e.name)).toEqual(["a.md"]);
  });

  it("distinguishes an empty folder from an unvisited one", () => {
    // The difference decides whether the browser shows a skeleton: an empty
    // array is a known-empty folder, `undefined` is "never read".
    useMobileStore.getState().rememberListing("Empty", []);
    expect(useMobileStore.getState().listingCache["Empty"]).toEqual([]);
    expect(useMobileStore.getState().listingCache["Never"]).toBeUndefined();
  });

  it("is cleared by reset, so a new library never shows the old one's listing", () => {
    // `reset()` runs when the grant is dropped or re-picked. A cache that
    // survived it would render the PREVIOUS library's folders under the new
    // library's name — and it did survive, until a test caught it.
    useMobileStore.getState().rememberListing("Inbox", [entry("old.md")]);
    useMobileStore.getState().reset();
    expect(useMobileStore.getState().listingCache).toEqual({});
  });

  it("is not persisted — a listing restored at launch would be stale", () => {
    // Run the store's OWN `partialize` over a state that has a cache in it,
    // and check what comes out. An earlier version of this test sliced the
    // source between `partialize:` and the next `}),` and grepped the text —
    // which passes for a `partialize` that mentions the field in a comment,
    // fails on reformatting, and says nothing about what actually reaches
    // disk. This calls the function.
    useMobileStore.getState().rememberListing("Inbox", [entry("a.md")]);
    const partialize = useMobileStore.persist.getOptions().partialize;
    expect(partialize, "the store is no longer persisted?").toBeTypeOf("function");

    const persisted = partialize!(useMobileStore.getState()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("listingCache");
    // The assertion above is only meaningful if `partialize` keeps ANYTHING:
    // a function that returned `{}` would pass it while breaking every
    // preference the store exists to remember.
    expect(Object.keys(persisted).length).toBeGreaterThan(0);
  });
});

describe("the cache is bounded", () => {
  beforeEach(() => {
    useMobileStore.setState({ listingCache: {} });
  });

  it("forgets the least recently read folder rather than growing forever", () => {
    const store = useMobileStore.getState();
    for (let i = 0; i < 40; i++) store.rememberListing(`f${i}`, [entry(`${i}.md`)]);

    const cache = useMobileStore.getState().listingCache;
    expect(Object.keys(cache).length).toBeLessThanOrEqual(24);
    // The most recent survive; the first ones read are gone.
    expect(cache["f39"]).toBeDefined();
    expect(cache["f0"]).toBeUndefined();
  });

  it("re-reading a folder refreshes its place in the queue", () => {
    // The folder you keep coming back to is the one the cache exists for, so
    // a pure insertion-order queue that never refreshed would evict it first.
    const store = useMobileStore.getState();
    store.rememberListing("home", [entry("a.md")]);
    for (let i = 0; i < 20; i++) store.rememberListing(`f${i}`, [entry(`${i}.md`)]);
    store.rememberListing("home", [entry("a.md"), entry("b.md")]);
    for (let i = 20; i < 40; i++) store.rememberListing(`f${i}`, [entry(`${i}.md`)]);

    const cache = useMobileStore.getState().listingCache;
    expect(Object.keys(cache).length).toBeLessThanOrEqual(24);
    // `home` was read first of all, and 40 folders followed it — a queue that
    // only tracked FIRST read would have evicted it long ago. It survives on
    // the strength of the second read, holding that read's entries.
    expect(cache["home"]).toHaveLength(2);
    // Folders read around the same time as the first `home` read are gone.
    expect(cache["f0"]).toBeUndefined();
  });
});

describe("navigating between cached folders", () => {
  beforeEach(() => {
    useMobileStore.setState({ listingCache: {} });
  });

  it("keeps each folder's entries separate, so a parent's list cannot appear under a child", () => {
    // The bug this guards: suppressing the skeleton without re-seeding left
    // the PREVIOUS folder's rows on screen under the new folder's title and
    // item count, because the useState initializer runs only on mount.
    // Going back to a parent hits it every time — a parent is always cached.
    const store = useMobileStore.getState();
    store.rememberListing("", [entry("Inbox"), entry("Notes")]);
    store.rememberListing("Inbox", [entry("a.md")]);

    const forParent = useMobileStore.getState().listingCache[""];
    const forChild = useMobileStore.getState().listingCache["Inbox"];
    expect(forParent.map((e) => e.name)).toEqual(["Inbox", "Notes"]);
    expect(forChild.map((e) => e.name)).toEqual(["a.md"]);
    expect(forParent).not.toBe(forChild);
  });
});
