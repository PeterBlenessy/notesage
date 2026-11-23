// @vitest-environment jsdom

/**
 * The production editor's schema must know every node the parse worker can
 * emit.
 *
 * `PageBreakNode` was registered in the worker and in the round-trip test
 * harness but NOT in `useEditor`, so the shipped editor had no `pageBreak`
 * node. A `<!-- pagebreak -->` marker was dropped on load and removed from the
 * file by the next save; and for large documents, parsed in the worker, the
 * editor was handed JSON containing a node type it rejected. The round-trip
 * gate could not see it because it builds its own extension list.
 */

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";

// jsdom has no ResizeObserver; the page-breaks plugin view creates one.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
  NoopResizeObserver;

import { useEditor } from "@/hooks/useEditor";
import { workerExtensions } from "@/workers/worker-extensions";
import { getMarkdownFromEditor } from "@/lib/markdown";

function productionEditor() {
  // Stores that load on import; nothing to read.
  setMockInvokeHandler("store_read_batch", () => ({}));
  setMockInvokeHandler("store_read", () => null);
  const { result } = renderHook(() =>
    useEditor({ content: "", onUpdate: () => {}, getDocumentId: () => "doc-1" }),
  );
  const editor = result.current;
  if (!editor) throw new Error("useEditor returned no editor");
  return editor;
}

describe("production editor schema", () => {
  it("has every node the parse worker's schema has", () => {
    const editor = productionEditor();
    const production = new Set(Object.keys(editor.schema.nodes));
    const workerNodes = workerExtensions
      .filter((ext) => (ext as { type?: string }).type === "node")
      .map((ext) => (ext as { name: string }).name);

    const missing = workerNodes.filter((name) => !production.has(name));
    expect(missing, `worker emits node(s) the editor cannot hold: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps a page break through load and save", () => {
    const editor = productionEditor();
    editor.commands.setContent("<p>before</p><div data-page-break></div><p>after</p>");

    expect(editor.getJSON().content?.map((n) => n.type)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
    expect(getMarkdownFromEditor(editor)).toContain("<!-- pagebreak -->");
  });
});
