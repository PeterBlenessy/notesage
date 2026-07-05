/**
 * Regression tests for `streamingHydrate`'s destroyed-editor guards.
 *
 * The hydration loop yields to the browser between chunks (rAF) and defers
 * the annotation apply past its own return — the editor can be destroyed
 * (Editor unmount) or the activation aborted during those gaps. Every
 * post-yield write must bail instead of touching the destroyed ProseMirror
 * view. See the deep-audit finding on `src/lib/markdown.ts` (streamingHydrate).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { streamingHydrate, type TableColumnMetadataMap } from "@/lib/markdown";

type RafCallback = (time: number) => void;

// Manual rAF queue so tests control exactly when the between-chunk yield
// and the deferred annotation apply fire.
let rafQueue: RafCallback[] = [];

function flushRaf(): void {
  const pending = rafQueue.splice(0, rafQueue.length);
  for (const cb of pending) {
    cb(performance.now());
  }
}

interface ParagraphJson {
  type: "paragraph";
  content: { type: "text"; text: string }[];
}

function paragraphs(count: number): ParagraphJson[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "paragraph",
    content: [{ type: "text", text: `paragraph ${i}` }],
  }));
}

function docJson(count: number): { type: "doc"; content: ParagraphJson[] } {
  return { type: "doc", content: paragraphs(count) };
}

function emptySideMaps(): {
  annotations: Map<number, string>;
  nodeIds: Map<number, string>;
  tableMetadata: TableColumnMetadataMap;
} {
  return {
    annotations: new Map<number, string>(),
    nodeIds: new Map<number, string>(),
    tableMetadata: new Map(),
  };
}

function annotatedSideMaps(): ReturnType<typeof emptySideMaps> {
  const side = emptySideMaps();
  side.annotations.set(0, "🔥");
  return side;
}

describe("streamingHydrate — destroyed editor guards", () => {
  let editor: Editor;

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: RafCallback): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: "<p>previous document</p>",
    });
  });

  afterEach(() => {
    if (!editor.isDestroyed) editor.destroy();
    vi.unstubAllGlobals();
  });

  it("bails without writing when the editor is destroyed during the between-chunk rAF gap", async () => {
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    // 1001 top-level nodes → 2 chunks with one rAF yield between them.
    const promise = streamingHydrate(editor, docJson(1001), emptySideMaps(), controller.signal);

    // First chunk is applied synchronously; the loop is parked on the yield.
    expect(chainSpy).toHaveBeenCalledTimes(1);
    expect(rafQueue.length).toBeGreaterThan(0);

    editor.destroy();
    flushRaf();

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(result.chunkCount).toBe(1);
    // No insertContent (or any other write) was attempted after destruction.
    expect(chainSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the aborted shape without touching an already-destroyed editor", async () => {
    editor.destroy();
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    const result = await streamingHydrate(editor, docJson(2), emptySideMaps(), controller.signal);

    expect(result.aborted).toBe(true);
    expect(result.chunkCount).toBe(0);
    expect(chainSpy).not.toHaveBeenCalled();
  });

  it("empty-doc fast path bails on a destroyed editor instead of clearing it", async () => {
    editor.destroy();
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    const result = await streamingHydrate(
      editor,
      { type: "doc", content: [] },
      emptySideMaps(),
      controller.signal,
    );

    expect(result.aborted).toBe(true);
    expect(chainSpy).not.toHaveBeenCalled();
  });

  it("skips the deferred annotation apply when the editor is destroyed before the rAF fires", async () => {
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    const result = await streamingHydrate(editor, docJson(2), annotatedSideMaps(), controller.signal);
    expect(result.aborted).toBe(false);
    const writesAfterHydrate = chainSpy.mock.calls.length;

    editor.destroy();
    flushRaf();

    expect(chainSpy.mock.calls.length).toBe(writesAfterHydrate);
  });

  it("skips the deferred annotation apply when the signal aborts before the rAF fires", async () => {
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    const result = await streamingHydrate(editor, docJson(2), annotatedSideMaps(), controller.signal);
    expect(result.aborted).toBe(false);
    const writesAfterHydrate = chainSpy.mock.calls.length;

    controller.abort();
    flushRaf();

    expect(chainSpy.mock.calls.length).toBe(writesAfterHydrate);
  });

  it("still applies deferred annotations when the editor stays alive (guards are not overzealous)", async () => {
    const chainSpy = vi.spyOn(editor, "chain");
    const controller = new AbortController();

    const result = await streamingHydrate(editor, docJson(2), annotatedSideMaps(), controller.signal);
    expect(result.aborted).toBe(false);
    const writesAfterHydrate = chainSpy.mock.calls.length;

    flushRaf();

    expect(chainSpy.mock.calls.length).toBeGreaterThan(writesAfterHydrate);
  });
});
