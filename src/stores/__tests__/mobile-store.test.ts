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
