// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useMobileStore, resolveFolderView } from "@/stores/mobile-store";
import { HOME_KEY } from "@/lib/home-file";

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

describe("mobile-store view mode (#633 — gallery view), remembered per folder", () => {
  const viewOf = (relPath: string) => resolveFolderView(store(), relPath);

  it("defaults to list", () => {
    expect(viewOf("").viewMode).toBe("list");
    expect(viewOf("Inbox").viewMode).toBe("list");
  });

  it("setViewMode switches the CURRENT folder to gallery and back, and no other", () => {
    store().enterFolder({ relPath: "Inbox", name: "Inbox" });
    store().setViewMode("gallery");
    expect(viewOf("Inbox").viewMode).toBe("gallery");
    expect(viewOf("").viewMode).toBe("list");
    expect(viewOf("Projects").viewMode).toBe("list");
    store().setViewMode("list");
    expect(viewOf("Inbox").viewMode).toBe("list");
  });

  it("every view choice is per folder: density, order and grouping too", () => {
    store().enterFolder({ relPath: "Projects", name: "Projects" });
    store().setListDensity("condensed");
    store().setSortMode("modified");
    store().setGroupMode("date");
    expect(viewOf("Projects")).toEqual({ viewMode: "list", listDensity: "condensed", sortMode: "modified", groupMode: "date" });
    expect(viewOf("")).toEqual({ viewMode: "list", listDensity: "comfortable", sortMode: "name", groupMode: "none" });
  });

  it("a folder without a view of its own follows the app-wide fallback — except the root, which is a list", () => {
    // What an upgraded install carries over from before views were per folder.
    useMobileStore.setState({ viewMode: "gallery", listDensity: "condensed", sortMode: "modified" });
    expect(viewOf("Inbox")).toMatchObject({ viewMode: "gallery", listDensity: "condensed", sortMode: "modified" });
    // Home (the top of the stack) is a list; All Folders (the root pushed
    // as a level) follows the fallback like any folder.
    expect(viewOf(HOME_KEY).viewMode).toBe("list");
    expect(viewOf(HOME_KEY).listDensity).toBe("condensed");
    expect(viewOf("").viewMode).toBe("gallery");
    // Home can still be made a gallery on purpose.
    store().setViewMode("gallery");
    expect(viewOf(HOME_KEY).viewMode).toBe("gallery");
  });

  it("a renamed folder takes its view, and its subfolders' views, with it", async () => {
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    store().enterFolder({ relPath: "Old", name: "Old" });
    store().setViewMode("gallery");
    store().enterFolder({ relPath: "Old/Sub", name: "Sub" });
    store().setSortMode("modified");
    store().enterFolder({ relPath: "Older", name: "Older" }); // a sibling with a shared prefix, untouched
    store().setGroupMode("date");
    await store().rewritePath("Old", "New");
    expect(viewOf("New").viewMode).toBe("gallery");
    expect(viewOf("New/Sub").sortMode).toBe("modified");
    expect(viewOf("Older").groupMode).toBe("date");
    expect(store().folderViews.map((e) => e.relPath)).toEqual(["Older", "New", "New/Sub"]);
  });

  it("a renamed folder takes everything remembered about its notes with it — recents, progress, offsets, pins", async () => {
    let pins = JSON.stringify({ paths: ["Old/note.md", "Elsewhere/x.md"] });
    let written: string | null = null;
    setMockInvokeHandler("ios_read_file", () => pins);
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_write_file", (args) => {
      written = (args as { content: string }).content;
      pins = written;
    });
    useMobileStore.setState({
      recentlyRead: ["Old/note.md", "Older/keep.md"],
      readingProgress: { "Old/note.md": 0.4 },
      scrollOffsets: { "Old/note.md": 99, Old: 12 },
      speechPositions: { "Old/deep/talk.html": 3 },
      openDoc: { relPath: "Old/note.md", name: "note.md" },
    });
    await store().rewritePath("Old", "New");
    const s = store();
    expect(s.recentlyRead).toEqual(["New/note.md", "Older/keep.md"]);
    expect(s.readingProgress).toEqual({ "New/note.md": 0.4 });
    expect(s.scrollOffsets).toEqual({ "New/note.md": 99, New: 12 });
    expect(s.speechPositions).toEqual({ "New/deep/talk.html": 3 });
    expect(s.openDoc).toEqual({ relPath: "New/note.md", name: "note.md" });
    expect(JSON.parse(written!).paths).toEqual(["New/note.md", "Elsewhere/x.md"]);
  });

  it("a renamed open document changes name and path in one update, and a failed pins write does not fail the rename", async () => {
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["a.md"] }));
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_write_file", () => {
      throw new Error("iCloud is read-only right now");
    });
    useMobileStore.setState({ openDoc: { relPath: "a.md", name: "a.md" }, docStack: [{ relPath: "a.md", name: "a.md" }] });
    await expect(store().rewritePath("a.md", "Shopping List.md")).resolves.toBeUndefined();
    expect(store().openDoc).toEqual({ relPath: "Shopping List.md", name: "Shopping List.md" });
    expect(store().docStack).toEqual([{ relPath: "Shopping List.md", name: "Shopping List.md" }]);
  });

  it("a rename onto a name a deleted folder left behind replaces that folder's stale view", async () => {
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    store().enterFolder({ relPath: "New", name: "New" });
    store().setGroupMode("pinned");
    store().enterFolder({ relPath: "Old", name: "Old" });
    store().setViewMode("gallery");
    await store().rewritePath("Old", "New");
    expect(store().folderViews).toEqual([{ relPath: "New", view: { viewMode: "gallery" } }]);
    expect(viewOf("New")).toMatchObject({ viewMode: "gallery", groupMode: "none" });
  });

  it("forgetPath drops everything remembered about a deleted folder and its contents, not a sibling's", async () => {
    let pins = JSON.stringify({ paths: ["Gone/note.md", "Goner/keep.md"] });
    setMockInvokeHandler("ios_read_file", () => pins);
    setMockInvokeHandler("ios_write_file", (args) => {
      pins = (args as { content: string }).content;
    });
    store().enterFolder({ relPath: "Gone", name: "Gone" });
    store().setViewMode("gallery");
    store().enterFolder({ relPath: "Gone/Sub", name: "Sub" });
    store().setSortMode("modified");
    store().enterFolder({ relPath: "Goner", name: "Goner" });
    store().setGroupMode("date");
    useMobileStore.setState({
      scrollOffsets: { Gone: 5, "Gone/Sub": 6, Goner: 7 },
      readingProgress: { "Gone/note.md": 0.8, "Goner/keep.md": 0.2 },
      speechPositions: { "Gone/note.md": 12 },
      readingResets: { "Gone/note.md": "2026-09-01T00:00:00Z" },
      recentlyRead: ["Gone/note.md", "Goner/keep.md"],
    });
    await store().forgetPath("Gone");
    const s = store();
    expect(s.folderViews.map((e) => e.relPath)).toEqual(["Goner"]);
    expect(s.scrollOffsets).toEqual({ Goner: 7 });
    expect(s.readingProgress).toEqual({ "Goner/keep.md": 0.2 });
    expect(s.speechPositions).toEqual({});
    expect(s.readingResets).toEqual({});
    expect(s.recentlyRead).toEqual(["Goner/keep.md"]);
    expect(JSON.parse(pins).paths).toEqual(["Goner/keep.md"]);
    expect(s.pinnedPaths).toEqual(["Goner/keep.md"]);
  });

  it("forgetPath leaves the pins file alone when nothing under the path is pinned", async () => {
    let writes = 0;
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["Elsewhere/x.md"] }));
    setMockInvokeHandler("ios_write_file", () => {
      writes += 1;
    });
    await store().forgetPath("Gone");
    expect(writes).toBe(0);
  });

  it("a renamed document's progress wins over a deleted document's stale entry at the new name", async () => {
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    // The stale entry was written AFTER the live one, so plain key order
    // would have let it win.
    useMobileStore.setState({
      readingProgress: { "Old/note.md": 0.3, "New/note.md": 0.9 },
      speechPositions: { "Old/note.md": 4, "New/note.md": 40 },
      recentlyRead: ["New/note.md", "Old/note.md"],
    });
    await store().rewritePath("Old", "New");
    expect(store().readingProgress).toEqual({ "New/note.md": 0.3 });
    expect(store().speechPositions).toEqual({ "New/note.md": 4 });
    expect(store().recentlyRead).toEqual(["New/note.md"]);
  });

  it("remembers at most 200 folders, forgetting the least recently set first", () => {
    for (let i = 0; i < 205; i++) {
      store().enterFolder({ relPath: `F${i}`, name: `F${i}` });
      store().setViewMode("gallery");
    }
    const entry = (relPath: string) => store().folderViews.find((e) => e.relPath === relPath)?.view;
    expect(store().folderViews).toHaveLength(200);
    expect(entry("F0")).toBeUndefined();
    expect(entry("F204")).toEqual({ viewMode: "gallery" });
    // Setting an old folder again makes it the newest.
    store().enterFolder({ relPath: "F5", name: "F5" });
    store().setListDensity("condensed");
    store().enterFolder({ relPath: "F999", name: "F999" });
    store().setViewMode("gallery");
    expect(entry("F5")).toEqual({ viewMode: "gallery", listDensity: "condensed" });
    expect(entry("F6")).toBeUndefined();
  });

  it("keeps a year-named folder as the newest when it was set last — the order is the order of setting", () => {
    // A JS object would enumerate "2024" before "Alpha" whatever the order
    // they were set in, and forget the wrong folder.
    for (const name of ["2024", "Alpha", "Beta", "2024", "Gamma"]) {
      store().enterFolder({ relPath: name, name });
      store().setViewMode("gallery");
    }
    expect(store().folderViews.map((e) => e.relPath)).toEqual(["Alpha", "Beta", "2024", "Gamma"]);
  });

  it("a persisted folderViews of another shape is dropped at launch instead of crashing", () => {
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } } }).persist;
    const merge = persistApi.getOptions().merge!;
    const merged = merge({ folderViews: { Inbox: { viewMode: "gallery" } }, speechRate: 1.25 }, store()) as { folderViews: unknown; speechRate: number };
    expect(merged.folderViews).toEqual([]);
    expect(merged.speechRate).toBe(1.25);
    const kept = merge({ folderViews: [{ relPath: "Inbox", view: { viewMode: "gallery" } }] }, store()) as { folderViews: unknown };
    expect(kept.folderViews).toEqual([{ relPath: "Inbox", view: { viewMode: "gallery" } }]);
  });

  it("reset() forgets every folder's view", () => {
    store().setViewMode("gallery");
    store().reset();
    expect(viewOf("").viewMode).toBe("list");
    expect(store().folderViews).toEqual([]);
  });

  it("is included in the persisted (partialize'd) state — survives a relaunch", () => {
    store().enterFolder({ relPath: "Inbox", name: "Inbox" });
    store().setViewMode("gallery");
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } }).persist;
    const partialize = persistApi.getOptions().partialize;
    expect(partialize).toBeTruthy();
    const persisted = partialize!(store()) as { folderViews?: Array<{ relPath: string; view: { viewMode?: string } }> };
    expect(persisted.folderViews).toEqual([{ relPath: "Inbox", view: { viewMode: "gallery" } }]);
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
    expect(resolveFolderView(store(), "").groupMode).toBe("none");
  });

  it("setGroupMode switches the current screen (Home here) to pinned and back", () => {
    store().setGroupMode("pinned");
    expect(resolveFolderView(store(), HOME_KEY).groupMode).toBe("pinned");
    store().setGroupMode("none");
    expect(resolveFolderView(store(), HOME_KEY).groupMode).toBe("none");
  });

  it("reset() returns groupMode to none and clears pinnedPaths", () => {
    store().setGroupMode("pinned");
    useMobileStore.setState({ pinnedPaths: ["a.md"] });
    store().reset();
    expect(resolveFolderView(store(), HOME_KEY).groupMode).toBe("none");
    expect(store().pinnedPaths).toEqual([]);
  });

  it("groupMode is included in the persisted (partialize'd) state — survives a relaunch, like sortMode", () => {
    store().setGroupMode("pinned");
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } }).persist;
    const partialize = persistApi.getOptions().partialize;
    const persisted = partialize!(store()) as { folderViews?: Array<{ relPath: string; view: { groupMode?: string } }> };
    expect(persisted.folderViews?.find((e) => e.relPath === HOME_KEY)?.view.groupMode).toBe("pinned");
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

  it("carries the reset ledger with a filed item, and the ledger stays bounded", async () => {
    useMobileStore.setState({ readingResets: { "Inbox/a.html": "2026-09-04T10:00:00.000Z" } });
    await useMobileStore.getState().rewritePath("Inbox/a.html", "Archive/a.html");
    expect(useMobileStore.getState().readingResets).toEqual({ "Archive/a.html": "2026-09-04T10:00:00.000Z" });
    for (let i = 0; i < 520; i++) useMobileStore.getState().recordReadingReset(`Inbox/${i}.html`, "2026-09-04T11:00:00.000Z");
    expect(Object.keys(useMobileStore.getState().readingResets).length).toBe(500);
  });

  it("leaves everything alone when the path did not change", async () => {
    useMobileStore.setState({ recentlyRead: ["Inbox/a.md"] });
    await useMobileStore.getState().rewritePath("Inbox/a.md", "Inbox/a.md");
    expect(useMobileStore.getState().recentlyRead).toEqual(["Inbox/a.md"]);
  });
});

describe("Home — the folders the root screen shows (home.json)", () => {
  const HOME = ".notesage/home.json";
  let disk: Record<string, string>;
  let writes: string[];
  const dir = (name: string) => ({ name, path: name, is_directory: true, hidden: false });
  beforeEach(() => {
    disk = {};
    writes = [];
    setMockInvokeHandler("ios_read_file", (args) => {
      const a = args as { relPath: string };
      if (a.relPath in disk) return disk[a.relPath];
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_write_file", (args) => {
      const a = args as { relPath: string; content: string };
      disk[a.relPath] = a.content;
      writes.push(a.relPath);
    });
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
  });

  it("loads null for a library without the file, and the list when there is one", async () => {
    await store().loadHomeFolders();
    expect(store().homeFolders).toBeNull();
    disk[HOME] = JSON.stringify({ version: 1, folders: ["Inbox", "Reading"] });
    await store().loadHomeFolders();
    expect(store().homeFolders).toEqual(["Inbox", "Reading"]);
  });

  it("setOnHome re-reads the file before writing, so another device's choice survives", async () => {
    useMobileStore.setState({ homeFolders: ["Inbox"] }); // stale: the iPad added Reading since
    disk[HOME] = JSON.stringify({ version: 1, folders: ["Inbox", "Reading"] });
    await store().setOnHome("Writing", true, [dir("Inbox"), dir("Reading"), dir("Writing")]);
    expect(JSON.parse(disk[HOME]).folders).toEqual(["Inbox", "Reading", "Writing"]);
    expect(store().homeFolders).toEqual(["Inbox", "Reading", "Writing"]);
  });

  it("setOnHome compacts entries that no longer name a root folder, and never writes on a read", async () => {
    disk[HOME] = JSON.stringify({ version: 1, folders: ["Inbox", "Gone"] });
    await store().loadHomeFolders();
    expect(writes).toEqual([]);
    await store().setOnHome("Reading", true, [dir("Inbox"), dir("Reading")]);
    expect(JSON.parse(disk[HOME]).folders).toEqual(["Inbox", "Reading"]);
    await store().setOnHome("Inbox", false, [dir("Inbox"), dir("Reading")]);
    expect(JSON.parse(disk[HOME]).folders).toEqual(["Reading"]);
  });

  it("starts from the defaults when there is no file yet — the first choice joins the Inbox", async () => {
    await store().setOnHome("Reading", true, [dir("Inbox"), dir("Reading")]);
    expect(JSON.parse(disk[HOME])).toEqual({ version: 1, folders: ["Inbox", "Reading"] });
  });

  it("a rename here keeps a Home folder on Home; a folder not on Home rewrites nothing", async () => {
    disk[HOME] = JSON.stringify({ version: 1, folders: ["Inbox", "Old"] });
    await store().rewritePath("Old", "New");
    expect(JSON.parse(disk[HOME]).folders).toEqual(["Inbox", "New"]);
    expect(store().homeFolders).toEqual(["Inbox", "New"]);
    writes.length = 0;
    await store().rewritePath("Other", "Renamed");
    expect(writes).toEqual([]);
  });

  it("Back closes the Edit Home screen before it leaves a folder or a document", () => {
    store().enterFolder({ relPath: "Reading", name: "Reading" });
    store().openHomeEditor();
    expect(store().homeEditorOpen).toBe(true);
    expect(store().goBack()).toBe(true);
    expect(store().homeEditorOpen).toBe(false);
    expect(store().folderStack).toHaveLength(1);
  });

  it("remembers that the hint was dismissed, across relaunches", () => {
    store().dismissHomeHint();
    const persistApi = (useMobileStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } }).persist;
    const persisted = persistApi.getOptions().partialize!(store()) as { homeHintDismissed?: boolean; homeFolders?: unknown };
    expect(persisted.homeHintDismissed).toBe(true);
    expect(persisted.homeFolders).toBeUndefined(); // the file is the truth
    store().reset();
    expect(store().homeHintDismissed).toBe(false);
  });
});
