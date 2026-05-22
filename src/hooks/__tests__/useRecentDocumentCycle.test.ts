// @vitest-environment jsdom

import { setMockInvokeHandler } from "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
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
    // The hook always uses the recentFiles (persistent MRU) path.
    // Register the read_file mock here because tauri-mock clears
    // handlers between every test.
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
