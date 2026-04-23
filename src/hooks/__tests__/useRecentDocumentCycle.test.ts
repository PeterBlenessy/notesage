// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorStore, type Tab } from "@/stores/editor-store";
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
