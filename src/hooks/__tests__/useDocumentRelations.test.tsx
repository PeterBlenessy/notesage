// @vitest-environment jsdom

/**
 * Unit tests for `useDocumentRelations` (OKF wiki-navigation task #7).
 *
 * Covers: empty state when no document is open, loading→ready transition,
 * backlink + outlink loading via the mocked Tauri invoke, count derivation,
 * error state, per-path memoization (re-fetch on document switch), and the
 * explicit-path override used by the hover preview.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@/test/tauri-mock";
import { setMockInvokeHandler, emitMockEvent } from "@/test/tauri-mock";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  useDocumentRelations,
  countRelations,
} from "@/hooks/useDocumentRelations";
import { useEditorStore } from "@/stores/editor-store";
import type { BacklinkGroup, LinkRow } from "@/lib/tauri";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  PERF: {},
}));

function makeBacklink(sourcePath: string, occurrences: number): BacklinkGroup {
  return {
    source_path: sourcePath,
    source_title: `Title ${sourcePath}`,
    source_type: "note",
    source_description: "a source",
    occurrences: Array.from({ length: occurrences }, (_, i) => ({
      link_text: `link ${i}`,
      context: `context ${i}`,
    })),
  };
}

function makeOutlink(targetPath: string, resolved = true): LinkRow {
  return {
    source_path: "/p/active.md",
    target_path: targetPath,
    link_text: "x",
    context: "ctx",
    is_internal: true,
    resolved,
    target_title: `Target ${targetPath}`,
    target_type: "table",
    target_description: "a target",
  };
}

/** Seed editor-store with a single open document at `path`. */
function openDoc(path: string): void {
  useEditorStore.setState({
    openDocuments: [
      {
        id: "tab-1",
        filePath: path,
        fileName: path.split("/").pop() ?? path,
        isDirty: false,
        content: "",
        frontmatter: null,
        fileType: "markdown",
      },
    ],
    activeTabId: "tab-1",
  });
}

beforeEach(() => {
  useEditorStore.setState({ openDocuments: [], activeTabId: null });
});

describe("countRelations", () => {
  it("sums backlink occurrences and forward links", () => {
    const backlinks = [makeBacklink("/p/a.md", 2), makeBacklink("/p/b.md", 1)];
    const outlinks = [makeOutlink("/p/x.md"), makeOutlink("/p/y.md")];
    expect(countRelations(backlinks, outlinks)).toBe(5);
  });

  it("returns 0 for empty inputs", () => {
    expect(countRelations([], [])).toBe(0);
  });
});

describe("useDocumentRelations", () => {
  it("is empty with no open document (no IPC)", async () => {
    const backlinkSpy = vi.fn(() => []);
    setMockInvokeHandler("get_backlinks", backlinkSpy);
    setMockInvokeHandler("get_outlinks", () => []);

    const { result } = renderHook(() => useDocumentRelations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.path).toBeNull();
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.count).toBe(0);
    expect(backlinkSpy).not.toHaveBeenCalled();
  });

  it("loads backlinks + outlinks for the active document", async () => {
    openDoc("/p/active.md");
    setMockInvokeHandler("get_backlinks", () => [makeBacklink("/p/a.md", 2)]);
    setMockInvokeHandler("get_outlinks", () => [makeOutlink("/p/x.md")]);

    const { result } = renderHook(() => useDocumentRelations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.path).toBe("/p/active.md");
    expect(result.current.backlinks).toHaveLength(1);
    expect(result.current.outlinks).toHaveLength(1);
    // 2 backlink occurrences + 1 forward link.
    expect(result.current.count).toBe(3);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports the empty state when the document has no relations", async () => {
    openDoc("/p/lonely.md");
    setMockInvokeHandler("get_backlinks", () => []);
    setMockInvokeHandler("get_outlinks", () => []);

    const { result } = renderHook(() => useDocumentRelations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.count).toBe(0);
  });

  it("surfaces an error when the query rejects", async () => {
    openDoc("/p/active.md");
    setMockInvokeHandler("get_backlinks", () => {
      throw new Error("db locked");
    });
    setMockInvokeHandler("get_outlinks", () => []);

    const { result } = renderHook(() => useDocumentRelations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("db locked");
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("re-queries when links-reindexed fires for the active document (BUG 1)", async () => {
    openDoc("/p/active.md");
    let outlinkCount = 1;
    const backlinkSpy = vi.fn(() => []);
    setMockInvokeHandler("get_backlinks", backlinkSpy);
    setMockInvokeHandler("get_outlinks", () =>
      Array.from({ length: outlinkCount }, (_, i) => makeOutlink(`/p/x${i}.md`)),
    );

    const { result } = renderHook(() => useDocumentRelations());
    await waitFor(() => expect(result.current.outlinks).toHaveLength(1));

    // A save reindexes links.db and the backend emits `links-reindexed` with
    // the affected paths. The open doc removed a link → now zero outlinks.
    outlinkCount = 0;
    act(() => {
      emitMockEvent("links-reindexed", ["/p/active.md"]);
    });

    await waitFor(() => expect(result.current.outlinks).toHaveLength(0));
    expect(result.current.isEmpty).toBe(true);
  });

  it("ignores links-reindexed for unrelated documents", async () => {
    openDoc("/p/active.md");
    const outlinkSpy = vi.fn(() => [makeOutlink("/p/x.md")]);
    setMockInvokeHandler("get_backlinks", () => []);
    setMockInvokeHandler("get_outlinks", outlinkSpy);

    const { result } = renderHook(() => useDocumentRelations());
    await waitFor(() => expect(result.current.outlinks).toHaveLength(1));
    const callsAfterLoad = outlinkSpy.mock.calls.length;

    act(() => {
      emitMockEvent("links-reindexed", ["/p/somewhere-else.md"]);
    });

    // Give the debounce a beat; no re-fetch should occur.
    await new Promise((r) => setTimeout(r, 250));
    expect(outlinkSpy.mock.calls.length).toBe(callsAfterLoad);
  });

  it("re-queries when a related (backlink source) doc is reindexed (BUG 1)", async () => {
    openDoc("/p/active.md");
    let backlinkOccurrences = 1;
    setMockInvokeHandler("get_backlinks", () =>
      backlinkOccurrences > 0
        ? [makeBacklink("/p/source.md", backlinkOccurrences)]
        : [],
    );
    setMockInvokeHandler("get_outlinks", () => []);

    const { result } = renderHook(() => useDocumentRelations());
    await waitFor(() => expect(result.current.backlinks).toHaveLength(1));

    // The source doc dropped its link to us → reindex of the SOURCE path
    // must refresh our backlinks even though our own file didn't change.
    backlinkOccurrences = 0;
    act(() => {
      emitMockEvent("links-reindexed", ["/p/source.md"]);
    });

    await waitFor(() => expect(result.current.backlinks).toHaveLength(0));
  });

  it("accepts an explicit path override (hover-preview path)", async () => {
    // No active document, but an explicit path is supplied.
    const calls: string[] = [];
    setMockInvokeHandler("get_backlinks", (args) => {
      calls.push(String(args?.path));
      return [];
    });
    setMockInvokeHandler("get_outlinks", () => [makeOutlink("/p/x.md")]);

    const { result } = renderHook(() =>
      useDocumentRelations("/p/explicit.md"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.path).toBe("/p/explicit.md");
    expect(calls).toContain("/p/explicit.md");
    expect(result.current.outlinks).toHaveLength(1);
  });
});
