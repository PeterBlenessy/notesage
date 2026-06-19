// @vitest-environment jsdom

import { setMockInvokeHandler } from "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useRecentDocumentCycle } from "@/hooks/useRecentDocumentCycle";
import { CYCLE_RECENT_EVENT } from "@/lib/keyboard/shortcut-events";

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

  // Tests that exercised in-memory tab cycling (`activeTabId` switching
  // between open tabs) have been deleted alongside Classic Layout (#325).
  // Quiet Composer is single-doc, so the hook now walks `recentFiles`
  // and re-opens via `openFile` from disk — see the "Quiet Composer mode"
  // describe block below for full coverage of that path.

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

  it("walks recentFiles and loads the previous entry from disk on ⌃⇧Tab", async () => {
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

  it("walks recentFiles forward on ⌃Tab (toward newer entries)", async () => {
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
