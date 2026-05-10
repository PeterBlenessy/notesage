// @vitest-environment jsdom

/**
 * Regression for #173 follow-up: the worker's Chart / Drawing / LinkPreview
 * shims (`src/workers/worker-extensions.ts`) MUST declare the same attribute
 * surface as the production extensions. When attributes are missing from the
 * shim, ProseMirror's DOMParser silently drops them — `data-block-width="50"`
 * on the input HTML becomes `blockWidth: null` on the parsed doc, and the
 * user's width/align settings vanish on tab-switch / reload (the production
 * load path runs through the worker on most files).
 *
 * The bug cost a full debug cycle in 2026-05-10 because:
 *   - serializer wrote `{width=50}` correctly
 *   - main-thread parser converted it to `data-block-width="50"` correctly
 *   - worker schema didn't know about `blockWidth` so it dropped it silently
 *
 * If this test fails after a schema change, mirror the production
 * extension's attribute spec into the worker shim.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToProseMirrorJson } from "@/workers/markdown-parse.core";

describe("worker schema preserves blockWidth + textAlign (#173 follow-up)", () => {
  it("inline chart with {width=50 align=right} round-trips into doc.attrs.textAlign", () => {
    const md = '```chart {width=50 align=right}\n{"type":"bar"}\n```';
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const chart = findFirstNode(doc, "chart");
    expect(chart).toBeTruthy();
    expect(chart?.attrs?.blockWidth).toBe(50);
    expect(chart?.attrs?.textAlign).toBe("right");
  });

  it("inline drawing with {width=75 align=center} round-trips into doc.attrs.textAlign", () => {
    const md = '```excalidraw {width=75 align=center}\n{"elements":[]}\n```';
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const drawing = findFirstNode(doc, "drawing");
    expect(drawing).toBeTruthy();
    expect(drawing?.attrs?.blockWidth).toBe(75);
    expect(drawing?.attrs?.textAlign).toBe("center");
  });

  it("sidecar chart with `<!--blockWidth:50,align:left-->` round-trips", () => {
    const md = "![chart](/.notesage/charts/abc.json) <!--blockWidth:50,align:left-->";
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const chart = findFirstNode(doc, "chart");
    expect(chart).toBeTruthy();
    expect(chart?.attrs?.blockWidth).toBe(50);
    expect(chart?.attrs?.textAlign).toBe("left");
  });

  it("sidecar drawing with `<!--blockWidth:100-->` round-trips blockWidth only", () => {
    const md =
      "![drawing](/.notesage/drawings/abc.excalidraw) <!--blockWidth:100-->";
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const drawing = findFirstNode(doc, "drawing");
    expect(drawing).toBeTruthy();
    expect(drawing?.attrs?.blockWidth).toBe(100);
    // TextAlign default value is empty string (not null), since the extension
    // uses `defaultAlignment` which is empty by default.
    expect(drawing?.attrs?.textAlign ?? "").toBe("");
  });

  it("image with `<!--blockWidth:50,align:center-->` round-trips into doc.attrs.textAlign", () => {
    const md = "![photo](photo.png) <!--blockWidth:50,align:center-->";
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const image = findFirstNode(doc, "image");
    expect(image).toBeTruthy();
    expect(image?.attrs?.blockWidth).toBe(50);
    expect(image?.attrs?.textAlign).toBe("center");
  });

  it("image without metadata comment retains default attrs (no false positives)", () => {
    const md = "![photo](photo.png)";
    const { doc } = parseMarkdownToProseMirrorJson(md);
    const image = findFirstNode(doc, "image");
    expect(image).toBeTruthy();
    expect(image?.attrs?.blockWidth).toBeNull();
    expect(image?.attrs?.textAlign ?? "").toBe("");
  });
});

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

function findFirstNode(doc: unknown, name: string): DocNode | null {
  const stack: DocNode[] = [doc as DocNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === name) return node;
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return null;
}
