// @vitest-environment jsdom

import { setMockInvokeHandler } from "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useRecentDocumentCycle } from "@/hooks/useRecentDocumentCycle";
import { CYCLE_RECENT_EVENT } from "@/hooks/useKeyboardShortcuts";

function mkTab(id: string, filePath: string): Tab {
  return {
    id,
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    isDirty: false,
    content: "",
    contentLoaded: true,
    frontmatter: null,
    fileType: "markdown",
  };
}

function dispatch(direction: "previous" | "next") {
  window.dispatchEvent(
    new CustomEvent<{ direction: "previous" | "next" }>(CYCLE_RECENT_EVENT, {
      detail: { direction },
    }),
  );
}

describe("useRecentDocumentCycle", () => {
  beforeEach(() => {
    useEditorStore.setState({
      openDocuments: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      pendingCloseTabId: null,
      persistedTabs: [],
      persistedActiveFilePath: null,
      documentAccessOrder: [],
    });
  });

  afterEach(() => {
    // Listener is cleaned up by the hook's unmount.
  });

  it("no-ops when fewer than 2 documents are open", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md")],
      activeTabId: "a",
      documentAccessOrder: ["a"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("previous"));
    expect(useEditorStore.getState().activeTabId).toBe("a");
    unmount();
  });

  it("⌘⇧[ (previous) advances toward older-accessed documents", () => {
    // Access order: [c, b, a] — c is most recently active
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md"), mkTab("c", "/c.md")],
      activeTabId: "c",
      documentAccessOrder: ["c", "b", "a"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("previous"));
    expect(useEditorStore.getState().activeTabId).toBe("b");
    unmount();
  });

  it("⌘⇧] (next) advances toward newer-accessed documents", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md"), mkTab("c", "/c.md")],
      activeTabId: "b",
      documentAccessOrder: ["c", "b", "a"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("next"));
    // Moving toward the head — "b"'s index is 1 → delta -1 → index 0 → "c"
    expect(useEditorStore.getState().activeTabId).toBe("c");
    unmount();
  });

  it("wraps at the head when cycling next past the MRU entry", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md")],
      activeTabId: "a", // head of MRU
      documentAccessOrder: ["a", "b"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("next"));
    expect(useEditorStore.getState().activeTabId).toBe("b");
    unmount();
  });

  it("wraps at the tail when cycling previous past the oldest entry", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md")],
      activeTabId: "b", // tail of MRU
      documentAccessOrder: ["a", "b"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("previous"));
    expect(useEditorStore.getState().activeTabId).toBe("a");
    unmount();
  });

  it("activating a tab bumps it to the head of the access order", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md"), mkTab("c", "/c.md")],
      activeTabId: "a",
      documentAccessOrder: ["a", "b", "c"],
    });
    useEditorStore.getState().setActiveTab("c");
    expect(useEditorStore.getState().documentAccessOrder).toEqual(["c", "a", "b"]);
  });

  it("closing a tab removes it from the access order", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md")],
      activeTabId: "a",
      documentAccessOrder: ["a", "b"],
      persistedTabs: [{ filePath: "/a.md", fileName: "a.md" }],
    });
    useEditorStore.getState().closeTab("b");
    expect(useEditorStore.getState().documentAccessOrder).toEqual(["a"]);
  });

  it("falls back to openDocuments order when access order is empty", () => {
    // Startup edge case: access order hasn't populated yet.
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md")],
      activeTabId: "a",
      documentAccessOrder: [],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    act(() => dispatch("previous"));
    expect(useEditorStore.getState().activeTabId).toBe("b");
    unmount();
  });

  it("removes the listener on unmount", () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md"), mkTab("b", "/b.md")],
      activeTabId: "a",
      documentAccessOrder: ["a", "b"],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());
    unmount();
    act(() => dispatch("previous"));
    // After unmount the listener should be gone — active tab unchanged.
    expect(useEditorStore.getState().activeTabId).toBe("a");
  });
});

describe("useRecentDocumentCycle — Quiet Composer mode", () => {
  beforeEach(() => {
    useSettingsStore.setState({ uiPreview: "quiet-composer" });
    // Quiet Composer cycle calls openFile → tauriApi.readFile →
    // invoke('read_file'). Register here (not at top level) because
    // tauri-mock clears handlers between every test.
    setMockInvokeHandler("read_file", () => "");
    useEditorStore.setState({
      openDocuments: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      pendingCloseTabId: null,
      persistedTabs: [],
      persistedActiveFilePath: null,
      documentAccessOrder: [],
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ uiPreview: "legacy" });
  });

  it("walks recentFiles and loads the previous entry from disk on ⌘⇧[", async () => {
    // Quiet Composer holds at most one open doc. The cycle hook should
    // walk the persisted MRU history (`recentFiles`) and `openFile` the
    // sibling entry from disk — `openFile` flows through `openTab`,
    // which evicts the current doc.
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md")],
      activeTabId: "a",
      // recentFiles head is the most recent (matches MRU convention).
      recentFiles: [
        { path: "/a.md", name: "a.md", lastAccessedAt: 3 },
        { path: "/b.md", name: "b.md", lastAccessedAt: 2 },
        { path: "/c.md", name: "c.md", lastAccessedAt: 1 },
      ],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());

    await act(async () => {
      dispatch("previous");
      // openFile is async — flush microtasks for the chain
      // (read_file mock → parseFrontmatter → openTab).
      await new Promise((r) => setTimeout(r, 20));
    });

    const state = useEditorStore.getState();
    // Single-document semantics: previous /a.md was evicted, /b.md is now open.
    expect(state.openDocuments).toHaveLength(1);
    expect(state.openDocuments[0].filePath).toBe("/b.md");
    expect(state.activeTabId).toBe(state.openDocuments[0].id);
    unmount();
  });

  it("walks recentFiles forward on ⌘⇧] (toward newer entries)", async () => {
    useEditorStore.setState({
      openDocuments: [mkTab("b", "/b.md")],
      activeTabId: "b",
      recentFiles: [
        { path: "/a.md", name: "a.md", lastAccessedAt: 3 },
        { path: "/b.md", name: "b.md", lastAccessedAt: 2 },
        { path: "/c.md", name: "c.md", lastAccessedAt: 1 },
      ],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());

    act(() => dispatch("next"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useEditorStore.getState().openDocuments[0].filePath).toBe("/a.md");
    unmount();
  });

  it("no-ops when recentFiles has fewer than 2 entries", async () => {
    useEditorStore.setState({
      openDocuments: [mkTab("a", "/a.md")],
      activeTabId: "a",
      recentFiles: [{ path: "/a.md", name: "a.md", lastAccessedAt: 1 }],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());

    act(() => dispatch("previous"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useEditorStore.getState().openDocuments[0].filePath).toBe("/a.md");
    unmount();
  });

  it("wraps at the tail when cycling previous past the oldest recent", async () => {
    useEditorStore.setState({
      openDocuments: [mkTab("c", "/c.md")],
      activeTabId: "c",
      recentFiles: [
        { path: "/a.md", name: "a.md", lastAccessedAt: 3 },
        { path: "/b.md", name: "b.md", lastAccessedAt: 2 },
        { path: "/c.md", name: "c.md", lastAccessedAt: 1 },
      ],
    });
    const { unmount } = renderHook(() => useRecentDocumentCycle());

    // /c.md is at index 2 (oldest). previous → wrap to index 0 (/a.md).
    act(() => dispatch("previous"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useEditorStore.getState().openDocuments[0].filePath).toBe("/a.md");
    unmount();
  });
});
