// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useMobileStore } from "@/stores/mobile-store";

const store = () => useMobileStore.getState();

beforeEach(() => {
  useMobileStore.getState().reset();
});

describe("mobile-store grant state machine", () => {
  it("starts unknown", () => {
    expect(store().grantState).toBe("unknown");
  });

  it("refreshGrant → granted when the backend reports a grant", async () => {
    setMockInvokeHandler("ios_get_library_grant", () => ({ displayName: "Notesage", granted: true }));
    await store().refreshGrant();
    expect(store().grantState).toBe("granted");
    expect(store().libraryName).toBe("Notesage");
  });

  it("refreshGrant → ungranted when there is no grant", async () => {
    setMockInvokeHandler("ios_get_library_grant", () => ({ displayName: "", granted: false }));
    await store().refreshGrant();
    expect(store().grantState).toBe("ungranted");
    expect(store().libraryName).toBe("");
  });

  it("refreshGrant → stale when resolving throws", async () => {
    setMockInvokeHandler("ios_get_library_grant", () => {
      throw new Error("stale bookmark");
    });
    await store().refreshGrant();
    expect(store().grantState).toBe("stale");
  });

  it("refreshGrant retries once on a transient throw and lands granted, not stale", async () => {
    // A one-off IPC hiccup (unrelated to bookmark validity) must not surface
    // "Reconnect your library" — the retry should succeed and resolve granted.
    let calls = 0;
    setMockInvokeHandler("ios_get_library_grant", () => {
      calls++;
      if (calls === 1) throw new Error("transient IPC hiccup");
      return { displayName: "Notesage", granted: true };
    });
    await store().refreshGrant();
    expect(calls).toBe(2);
    expect(store().grantState).toBe("granted");
    expect(store().libraryName).toBe("Notesage");
  });

  it("refreshGrant retries once and still lands stale when the bookmark is genuinely stale", async () => {
    // A genuinely stale bookmark fails consistently — it must not be
    // misclassified as transient just because a retry was attempted.
    let calls = 0;
    setMockInvokeHandler("ios_get_library_grant", () => {
      calls++;
      throw new Error("stale bookmark");
    });
    await store().refreshGrant();
    expect(calls).toBe(2);
    expect(store().grantState).toBe("stale");
  });

  it("pickFolder → granted and resets navigation", async () => {
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "Notesage", granted: true }));
    store().enterFolder({ relPath: "Sub", name: "Sub" });
    await store().pickFolder();
    expect(store().grantState).toBe("granted");
    expect(store().folderStack).toEqual([]);
    expect(store().openDoc).toBeNull();
  });

  it("clearGrant → ungranted and resets navigation", async () => {
    setMockInvokeHandler("ios_clear_library_grant", () => undefined);
    setMockInvokeHandler("ios_get_library_grant", () => ({ displayName: "Notesage", granted: true }));
    await store().refreshGrant();
    store().enterFolder({ relPath: "Sub", name: "Sub" });
    await store().clearGrant();
    expect(store().grantState).toBe("ungranted");
    expect(store().folderStack).toEqual([]);
  });
});

describe("mobile-store navigation", () => {
  it("enterFolder pushes and currentRelPath reflects the top", () => {
    expect(store().currentRelPath()).toBe("");
    store().enterFolder({ relPath: "A", name: "A" });
    store().enterFolder({ relPath: "A/B", name: "B" });
    expect(store().currentRelPath()).toBe("A/B");
    expect(store().folderStack).toHaveLength(2);
  });

  it("goBack closes the doc first, then pops folders, then reports root", () => {
    store().enterFolder({ relPath: "A", name: "A" });
    store().openDocument({ relPath: "A/note.md", name: "note.md" });
    expect(store().goBack()).toBe(true); // closes doc
    expect(store().openDoc).toBeNull();
    expect(store().goBack()).toBe(true); // pops folder
    expect(store().folderStack).toEqual([]);
    expect(store().goBack()).toBe(false); // at root
  });

  it("goToDepth truncates the stack and clears the open doc", () => {
    store().enterFolder({ relPath: "A", name: "A" });
    store().enterFolder({ relPath: "A/B", name: "B" });
    store().openDocument({ relPath: "A/B/n.md", name: "n.md" });
    store().goToDepth(1);
    expect(store().folderStack).toHaveLength(1);
    expect(store().openDoc).toBeNull();
  });

  // Following links between documents (HTML reports, linked notes). Back has
  // to retrace the trail; without the stack it drops straight to the folder,
  // which makes a set of linked pages one-way.
  describe("link trail", () => {
    it("retraces the trail before leaving the document", () => {
      store().enterFolder({ relPath: "site", name: "site" });
      store().openDocument({ relPath: "site/index.html", name: "index.html" });
      store().openLinkedDocument({ relPath: "site/a.html", name: "a.html" });
      store().openLinkedDocument({ relPath: "site/b.html", name: "b.html" });

      expect(store().goBack()).toBe(true);
      expect(store().openDoc?.relPath).toBe("site/a.html");
      expect(store().goBack()).toBe(true);
      expect(store().openDoc?.relPath).toBe("site/index.html");
      // Trail exhausted — now Back leaves the document.
      expect(store().goBack()).toBe(true);
      expect(store().openDoc).toBeNull();
      expect(store().goBack()).toBe(true); // pops the folder
      expect(store().goBack()).toBe(false); // root
    });

    it("opening from the listing starts a fresh trail", () => {
      store().openDocument({ relPath: "a.html", name: "a.html" });
      store().openLinkedDocument({ relPath: "b.html", name: "b.html" });
      // A new open from the browser is not a continuation of the old trail.
      store().openDocument({ relPath: "c.html", name: "c.html" });

      expect(store().docStack).toEqual([]);
      expect(store().goBack()).toBe(true);
      expect(store().openDoc).toBeNull();
    });

    it("a self-link is not a step", () => {
      // Otherwise Back appears to do nothing: it would return to the page
      // already on screen.
      store().openDocument({ relPath: "a.html", name: "a.html" });
      store().openLinkedDocument({ relPath: "a.html", name: "a.html" });
      expect(store().docStack).toEqual([]);
    });

    it("caps the trail so a circular site cannot grow it forever", () => {
      store().openDocument({ relPath: "start.html", name: "start.html" });
      for (let i = 0; i < 40; i++) {
        store().openLinkedDocument({ relPath: `p${i}.html`, name: `p${i}.html` });
      }
      expect(store().docStack).toHaveLength(20);
      // The cap drops the OLDEST steps: the most recent are what a reader
      // actually retraces.
      expect(store().docStack[store().docStack.length - 1].relPath).toBe("p38.html");
    });

    it("leaving the document clears the trail", () => {
      store().openDocument({ relPath: "a.html", name: "a.html" });
      store().openLinkedDocument({ relPath: "b.html", name: "b.html" });
      store().closeDocument();
      expect(store().docStack).toEqual([]);
    });

    it("jumping to a breadcrumb depth clears the trail", () => {
      store().enterFolder({ relPath: "A", name: "A" });
      store().openDocument({ relPath: "A/a.html", name: "a.html" });
      store().openLinkedDocument({ relPath: "A/b.html", name: "b.html" });
      store().goToDepth(0);
      expect(store().docStack).toEqual([]);
      expect(store().openDoc).toBeNull();
    });
  });

  it("openDocument records recents, newest-first, deduped, capped at 20", () => {
    for (let i = 0; i < 25; i++) {
      store().openDocument({ relPath: `f${i}.md`, name: `f${i}.md` });
    }
    // Re-open an existing one — it should jump to the front without duplicating.
    store().openDocument({ relPath: "f24.md", name: "f24.md" });
    const recents = store().recentlyRead;
    expect(recents).toHaveLength(20);
    expect(recents[0]).toBe("f24.md");
    expect(new Set(recents).size).toBe(recents.length);
  });
});

describe("mobile-store view mode (#633 — gallery view)", () => {
  it("defaults to list", () => {
    expect(store().viewMode).toBe("list");
  });

  it("setViewMode switches to gallery and back", () => {
    store().setViewMode("gallery");
    expect(store().viewMode).toBe("gallery");
    store().setViewMode("list");
    expect(store().viewMode).toBe("list");
  });

  it("reset() returns viewMode to list", () => {
    store().setViewMode("gallery");
    store().reset();
    expect(store().viewMode).toBe("list");
  });

  it("is included in the persisted (partialize'd) state — survives a relaunch", () => {
    store().setViewMode("gallery");
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } }).persist;
    const partialize = persistApi.getOptions().partialize;
    expect(partialize).toBeTruthy();
    const persisted = partialize!(store()) as { viewMode?: string };
    expect(persisted.viewMode).toBe("gallery");
  });
});

describe("mobile-store pinned paths & group-by (#652)", () => {
  it("loadPinnedPaths populates pinnedPaths from .notesage/pins.json", async () => {
    setMockInvokeHandler("ios_read_file", (args) => {
      expect((args as { relPath: string }).relPath).toBe(".notesage/pins.json");
      return JSON.stringify({ paths: ["a.md", "Sub/b.md"] });
    });
    await store().loadPinnedPaths();
    expect(store().pinnedPaths).toEqual(["a.md", "Sub/b.md"]);
  });

  it("resolves pinnedPaths to an empty array without throwing when pins.json is missing", async () => {
    // ios_read_file deliberately unmocked — invoke rejects, mirroring a
    // missing file (fresh library, or a library never opened by a build
    // with this feature).
    await expect(store().loadPinnedPaths()).resolves.toBeUndefined();
    expect(store().pinnedPaths).toEqual([]);
  });

  it("togglePin adds a path, writing the shared pins file the desktop reads", async () => {
    const writes: Array<{ relPath: string; content: string }> = [];
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["a.md"] }));
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_write_file", (args) => {
      writes.push(args as { relPath: string; content: string });
      return undefined;
    });

    await store().togglePin("Sub/b.md");

    expect(writes).toHaveLength(1);
    expect(writes[0].relPath).toBe(".notesage/pins.json");
    expect(JSON.parse(writes[0].content).paths).toEqual(["a.md", "Sub/b.md"]);
    expect(store().pinnedPaths).toEqual(["a.md", "Sub/b.md"]);
  });

  it("togglePin removes an already-pinned path", async () => {
    let written = "";
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["a.md", "b.md"] }));
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_write_file", (args) => {
      written = (args as { content: string }).content;
      return undefined;
    });

    await store().togglePin("a.md");
    expect(JSON.parse(written).paths).toEqual(["b.md"]);
  });

  it("togglePin re-reads the file first, so a pin made on the desktop is not clobbered", async () => {
    // The store's cached list is empty; the FILE has a desktop-made pin.
    let written = "";
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["from-desktop.md"] }));
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_write_file", (args) => {
      written = (args as { content: string }).content;
      return undefined;
    });

    expect(store().pinnedPaths).toEqual([]);
    await store().togglePin("mine.md");
    expect(JSON.parse(written).paths).toEqual(["from-desktop.md", "mine.md"]);
  });

  it("togglePin creates .notesage/ before writing, for a library the desktop never wrote to", async () => {
    const calls: string[] = [];
    setMockInvokeHandler("ios_ensure_directory", (args) => {
      calls.push((args as { relPath: string }).relPath);
      return undefined;
    });
    setMockInvokeHandler("ios_write_file", () => undefined);
    // ios_read_file unmocked → rejects, mirroring a missing pins.json.
    await store().togglePin("first.md");
    expect(calls).toEqual([".notesage"]);
    expect(store().pinnedPaths).toEqual(["first.md"]);
  });

  it("remembers a scroll offset per folder and forgets it on reset", () => {
    store().rememberScroll("Ideas", 420);
    store().rememberScroll("Projects", 96);
    expect(store().scrollOffsets).toEqual({ Ideas: 420, Projects: 96 });
    store().rememberScroll("Ideas", 12);
    expect(store().scrollOffsets.Ideas).toBe(12);
    store().reset();
    expect(store().scrollOffsets).toEqual({});
  });

  it("defaults groupMode to none", () => {
    expect(store().groupMode).toBe("none");
  });

  it("setGroupMode switches to pinned and back", () => {
    store().setGroupMode("pinned");
    expect(store().groupMode).toBe("pinned");
    store().setGroupMode("none");
    expect(store().groupMode).toBe("none");
  });

  it("reset() returns groupMode to none and clears pinnedPaths", () => {
    store().setGroupMode("pinned");
    useMobileStore.setState({ pinnedPaths: ["a.md"] });
    store().reset();
    expect(store().groupMode).toBe("none");
    expect(store().pinnedPaths).toEqual([]);
  });

  it("groupMode is included in the persisted (partialize'd) state — survives a relaunch, like sortMode", () => {
    store().setGroupMode("pinned");
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } }).persist;
    const partialize = persistApi.getOptions().partialize;
    const persisted = partialize!(store()) as { groupMode?: string };
    expect(persisted.groupMode).toBe("pinned");
  });
});

describe("rewritePath (#754)", () => {
  beforeEach(() => useMobileStore.getState().reset());

  it("repoints recents, the open doc and the back trail", async () => {
    useMobileStore.setState({
      recentlyRead: ["Inbox/a.md", "Other/b.md"],
      openDoc: { relPath: "Inbox/a.md", name: "a.md" },
      docStack: [{ relPath: "Inbox/a.md", name: "a.md" }],
      scrollOffsets: { "Inbox/a.md": 120, "Other/b.md": 40 },
    });

    await useMobileStore.getState().rewritePath("Inbox/a.md", "Archive/a.md");

    const s = useMobileStore.getState();
    expect(s.recentlyRead).toEqual(["Archive/a.md", "Other/b.md"]);
    expect(s.openDoc?.relPath).toBe("Archive/a.md");
    expect(s.docStack[0].relPath).toBe("Archive/a.md");
    // A stale offset key would restore the wrong scroll position forever.
    expect(s.scrollOffsets["Archive/a.md"]).toBe(120);
    expect(s.scrollOffsets["Inbox/a.md"]).toBeUndefined();
  });

  it("follows the article being read aloud, so the ring and the transport stay with it", async () => {
    useMobileStore.setState({
      speech: { relPath: "Inbox/a.html", title: "A", playing: true, index: 2, total: 9, rate: 1, language: "en" },
      speechPositions: { "Inbox/a.html": 2 },
    });
    await useMobileStore.getState().rewritePath("Inbox/a.html", "Archive/a.html");
    const s = useMobileStore.getState();
    expect(s.speech?.relPath).toBe("Archive/a.html");
    expect(s.speech?.index).toBe(2);
    expect(s.speechPositions["Archive/a.html"]).toBe(2);
    expect(s.speechPositions["Inbox/a.html"]).toBeUndefined();
  });

  it("leaves everything alone when the path did not change", async () => {
    useMobileStore.setState({ recentlyRead: ["Inbox/a.md"] });
    await useMobileStore.getState().rewritePath("Inbox/a.md", "Inbox/a.md");
    expect(useMobileStore.getState().recentlyRead).toEqual(["Inbox/a.md"]);
  });
});
