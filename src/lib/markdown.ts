import type { Editor } from "@tiptap/core";
import {
  getEditorStorage,
  type EditorStorageMarkdown,
} from "@/lib/editor-storage";
import { EditorState } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// Converter bank re-export (compatibility)
// ---------------------------------------------------------------------------
//
// The markdown ↔ HTML converter/restore/strip/inject/apply helper bank was
// extracted verbatim to `markdown-html-converters.ts` so the round-trip
// contract below stays readable in isolation. Every public symbol is
// re-exported here so existing `@/lib/markdown` import paths keep resolving.

export * from "@/lib/markdown-html-converters";

import {
  stripAnnotationsFromMarkdown,
  applyAnnotationsToEditor,
  injectAnnotationsIntoMarkdown,
  normalizeEmptyTaskItems,
  stripGhostTaskItems,
  convertCalloutsToHtml,
  convertLinkPreviewsToHtml,
  convertDrawingsToHtml,
  convertChartsToHtml,
  convertMermaidToHtml,
  convertInlineChartsToHtml,
  convertInlineDrawingsToHtml,
  convertDataUriImagesToHtml,
  convertImagesWithMetaToHtml,
  encodeImagePathSpaces,
  decodeImagePathSpaces,
  extractTableColumnMetadata,
  applyTableColumnMetadata,
  convertTocToHtml,
  restoreTocComments,
  stripNodeIdComments,
  applyNodeIdsToEditor,
  convertPageBreaksToHtml,
  restorePageBreaks,
  type TableColumnMetadataMap,
} from "@/lib/markdown-html-converters";

// ---------------------------------------------------------------------------
// Editor ↔ Markdown helpers
// ---------------------------------------------------------------------------

export function getMarkdownFromEditor(editor: Editor): string {
  let markdown = "";

  // Try to use the Markdown extension's getMarkdown method
  try {
    const mdStorage = getEditorStorage<EditorStorageMarkdown>(editor, "markdown");
    if (typeof mdStorage?.getMarkdown === "function") {
      markdown = decodeImagePathSpaces(mdStorage.getMarkdown());
    }
  } catch (error) {
    console.warn("Failed to get markdown from storage:", error);
  }

  // Last resort
  if (!markdown) {
    return editor.getText();
  }

  // Strip ghost empty task items and fix corrupted bracket escaping
  markdown = stripGhostTaskItems(markdown);

  // Restore page break comments from HTML div form
  markdown = restorePageBreaks(markdown);

  // Restore TOC comments from HTML div form
  markdown = restoreTocComments(markdown);

  // Node ID injection disabled — too noisy in source mode (every paragraph gets
  // <!-- id:uuid -->). UniqueID extension still active for in-session comment
  // anchoring but IDs are not persisted to markdown.
  // markdown = injectNodeIdComments(markdown, editor);

  // Inject {emoji} prefixes from the current ProseMirror document annotations
  return injectAnnotationsIntoMarkdown(markdown, editor);
}


export function setMarkdownInEditor(editor: Editor, markdown: string): void {
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(markdown);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  const encoded = convertDataUriImagesToHtml(convertImagesWithMetaToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta))))))))))))));
  setContentWithoutHistory(editor, encoded);

  if (metadata.size > 0) {
    applyTableColumnMetadata(editor, metadata);
  }
  if (nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, nodeIds);
  }
}

/**
 * Replace the editor's document content without adding to undo history.
 * Accepts already-encoded content (after encodeImagePathSpaces).
 *
 * NOTE: For loading raw markdown that may contain `{emoji}` annotation
 * prefixes, use `loadRawMarkdownIntoEditor` instead.
 */
export function setContentWithoutHistory(editor: Editor, content: string): void {
  editor.chain().setMeta("addToHistory", false).setContent(content).run();
}

/**
 * Load raw markdown (as stored on disk) into the editor without adding to
 * undo history.
 *
 * This is the preferred function for loading tab content, external changes,
 * and any markdown that may contain `{emoji}` annotation prefixes. It:
 *   1. Strips `{emoji}` prefixes and collects the annotation map
 *   2. Encodes image path spaces
 *   3. Calls setContent
 *   4. Applies annotations via a follow-up transaction (next animation frame)
 */
export function loadRawMarkdownIntoEditor(
  editor: Editor,
  rawMarkdown: string
): void {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(cleaned);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  const encoded = convertDataUriImagesToHtml(convertImagesWithMetaToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta))))))))))))));

  // [perf:setContent] instrumentation — measures main-thread cost of the
  // DOM teardown + rebuild. The "old" doc size is what we're throwing away;
  // the "new" doc size is what we're building. Both contribute to the cost.
  const oldDocSize = editor.state.doc.nodeSize;
  const t0 = performance.now();
  editor.chain().setMeta("addToHistory", false).setContent(encoded).run();
  const setContentMs = performance.now() - t0;
  const newDocSize = editor.state.doc.nodeSize;

  // Clear undo/redo history — the loaded content is a fresh baseline.
  // Without this, stale history entries from the previous document cause
  // silent no-op undos and unexpected cursor jumps after tab switches.
  const t1 = performance.now();
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);
  const freshStateMs = performance.now() - t1;

  const t2 = performance.now();
  if (metadata.size > 0) {
    applyTableColumnMetadata(editor, metadata);
  }
  if (nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, nodeIds);
  }
  const sideMapsMs = performance.now() - t2;

  console.log("[perf:setContent]", {
    path: "raw-markdown",
    oldDocSize,
    newDocSize,
    setContentMs: +setContentMs.toFixed(1),
    freshStateMs: +freshStateMs.toFixed(1),
    sideMapsMs: +sideMapsMs.toFixed(1),
    totalMs: +(setContentMs + freshStateMs + sideMapsMs).toFixed(1),
  });

  if (annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, annotations);
    });
  }
}

// ---------------------------------------------------------------------------
// Worker hydration path (Phase 2 — Layer 2)
// ---------------------------------------------------------------------------

/**
 * Companion to `loadRawMarkdownIntoEditor` for the Phase 2 worker hydration
 * path. The worker has already done the expensive markdown→HTML→ProseMirror
 * parse off-thread; the main thread just feeds the JSON to setContent and
 * applies the side-channel maps (annotations, nodeIds, table metadata) the
 * same way the legacy synchronous path does.
 *
 * `setContent(json, false)` is dramatically cheaper than `setContent(html)`
 * because the heavy schema-walk parse already happened in the worker.
 * This is the critical hot path that takes the 4.5–5.1s `animation-frame-fired`
 * block from "freezes the entire app" to "completes in milliseconds."
 */
export function loadParsedJsonIntoEditor(
  editor: Editor,
  /** ProseMirror JSON from the worker's `node.toJSON()`. */
  doc: unknown,
  side: {
    annotations: Map<number, string>;
    nodeIds: Map<number, string>;
    tableMetadata: TableColumnMetadataMap;
  },
): void {
  // [perf:setContent] instrumentation — see `loadRawMarkdownIntoEditor`
  // for rationale. This is the worker-hydration path; setContent here
  // accepts pre-parsed ProseMirror JSON which is dramatically cheaper
  // than parsing markdown, but the DOM materialize cost is the same.
  const oldDocSize = editor.state.doc.nodeSize;
  const t0 = performance.now();
  editor.chain().setMeta("addToHistory", false).setContent(doc as never).run();
  const setContentMs = performance.now() - t0;
  const newDocSize = editor.state.doc.nodeSize;

  // Same fresh-state pattern as `loadRawMarkdownIntoEditor` — clears undo
  // history so stale entries from the previous document don't corrupt the
  // user's first undo after open.
  const t1 = performance.now();
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);
  const freshStateMs = performance.now() - t1;

  const t2 = performance.now();
  if (side.tableMetadata.size > 0) {
    applyTableColumnMetadata(editor, side.tableMetadata);
  }
  if (side.nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, side.nodeIds);
  }
  const sideMapsMs = performance.now() - t2;

  console.log("[perf:setContent]", {
    path: "parsed-json",
    oldDocSize,
    newDocSize,
    setContentMs: +setContentMs.toFixed(1),
    freshStateMs: +freshStateMs.toFixed(1),
    sideMapsMs: +sideMapsMs.toFixed(1),
    totalMs: +(setContentMs + freshStateMs + sideMapsMs).toFixed(1),
  });

  if (side.annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, side.annotations);
    });
  }
}

/**
 * Default chunk size for streaming hydration. ~1000 top-level nodes per
 * chunk lands at roughly 30–60 ms of synchronous JS per chunk in dev mode
 * — short enough that yielding between chunks keeps clicks responsive,
 * large enough that the per-chunk transaction overhead doesn't dominate.
 *
 * Tuneable: smaller = more responsive, longer total time. Larger = closer
 * to single-shot setContent, less interruptible.
 */
const HYDRATE_CHUNK_SIZE = 1000;

/**
 * Streaming version of `loadParsedJsonIntoEditor` — inserts the parsed
 * doc in chunks with `setTimeout(0)` yields between chunks, gated on an
 * abort signal. Designed so that a click on a different tab during
 * hydration cleanly interrupts the in-flight load (next chunk's abort
 * check bails) instead of running the full ~4 s synchronous setContent
 * that ProseMirror does in one shot.
 *
 * Returns a structured result so the caller can log timings and decide
 * what to do on abort. The editor is left in a partially-hydrated state
 * on abort — the next call to `streamingHydrate` will replace its
 * content via the leading `setContent({content: []})` reset.
 *
 * The side-channel maps (table metadata, nodeIds, annotations) are
 * applied at the END after streaming completes. Applying them per-chunk
 * would double the transaction count.
 */
export async function streamingHydrate(
  editor: Editor,
  /** ProseMirror JSON from the worker's `node.toJSON()`. */
  doc: unknown,
  side: {
    annotations: Map<number, string>;
    nodeIds: Map<number, string>;
    tableMetadata: TableColumnMetadataMap;
  },
  signal: AbortSignal,
): Promise<{
  aborted: boolean;
  chunkCount: number;
  topLevelNodes: number;
  newDocSize: number;
  oldDocSize: number;
  ms: number;
}> {
  const t0 = performance.now();
  const oldDocSize = editor.state.doc.nodeSize;

  const docContent = (doc as { content?: unknown[] } | null)?.content;

  // Empty / malformed doc — fast path. Just clear the editor.
  if (!Array.isArray(docContent) || docContent.length === 0) {
    if (signal.aborted || editor.isDestroyed) {
      return { aborted: true, chunkCount: 0, topLevelNodes: 0, newDocSize: 0, oldDocSize, ms: performance.now() - t0 };
    }
    editor.chain().setMeta("addToHistory", false).setContent({ type: "doc", content: [] }).run();
    return {
      aborted: false,
      chunkCount: 0,
      topLevelNodes: 0,
      newDocSize: editor.state.doc.nodeSize,
      oldDocSize,
      ms: performance.now() - t0,
    };
  }

  if (signal.aborted || editor.isDestroyed) {
    return { aborted: true, chunkCount: 0, topLevelNodes: docContent.length, newDocSize: oldDocSize, oldDocSize, ms: performance.now() - t0 };
  }

  // Stream content in chunks. The FIRST chunk uses `setContent` so it
  // replaces existing content in one transaction (matching the old
  // `loadParsedJsonIntoEditor` behaviour for single-chunk small docs).
  // Subsequent chunks use `insertContent` to append. Yielding via rAF
  // between chunks so click events can fire and abort the loop —
  // single-chunk fast path skips the yield, no overhead.
  let chunkCount = 0;
  for (let i = 0; i < docContent.length; i += HYDRATE_CHUNK_SIZE) {
    // The rAF yield below hands control back to the browser between chunks —
    // the editor can be destroyed (Editor unmount) during that gap, not just
    // aborted. Writing to a destroyed ProseMirror view throws, so the
    // isDestroyed check is load-bearing; don't touch `editor.state` either.
    if (signal.aborted || editor.isDestroyed) {
      return { aborted: true, chunkCount, topLevelNodes: docContent.length, newDocSize: editor.isDestroyed ? oldDocSize : editor.state.doc.nodeSize, oldDocSize, ms: performance.now() - t0 };
    }

    const chunk = docContent.slice(i, i + HYDRATE_CHUNK_SIZE);
    const isFirstChunk = i === 0;
    if (isFirstChunk) {
      // Single-shot replacement — same as legacy `loadParsedJsonIntoEditor`
      // for small docs that fit in one chunk. Avoids the double-transaction
      // (clear + insert) that detaches DOM Playwright is mid-clicking.
      editor.chain().setMeta("addToHistory", false).setContent({ type: "doc", content: chunk } as never).run();
    } else {
      editor.chain().setMeta("addToHistory", false).insertContent(chunk as never).run();
    }
    chunkCount++;

    // Yield between chunks via `requestAnimationFrame`. Why not
    // `setTimeout(0)`? setTimeout fires the next chunk before the
    // browser has a chance to paint or run hover/cursor hit-tests, so
    // sidebar items don't show the pointer cursor during streaming.
    // rAF guarantees one paint frame between chunks (~16 ms on 60 Hz),
    // which is enough for cursor + hover styles + click events to fire
    // cleanly. Costs ~16 ms × N chunks of total time vs 1–4 ms × N for
    // setTimeout — worth it for the responsiveness win. Skip the yield
    // on the last chunk — no point waiting for nothing.
    if (i + HYDRATE_CHUNK_SIZE < docContent.length) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  if (signal.aborted || editor.isDestroyed) {
    return { aborted: true, chunkCount, topLevelNodes: docContent.length, newDocSize: editor.isDestroyed ? oldDocSize : editor.state.doc.nodeSize, oldDocSize, ms: performance.now() - t0 };
  }

  // Same fresh-state pattern as `loadParsedJsonIntoEditor` — clears undo
  // history so stale entries from the previous document don't corrupt
  // the user's first undo after open.
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);

  // Side-channel maps applied AFTER streaming. Each is a single
  // transaction; doing them per-chunk would multiply overhead.
  if (side.tableMetadata.size > 0) {
    applyTableColumnMetadata(editor, side.tableMetadata);
  }
  if (side.nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, side.nodeIds);
  }
  if (side.annotations.size > 0) {
    requestAnimationFrame(() => {
      // Deferred past the return — the editor can be destroyed (or the
      // activation aborted) before this frame fires.
      if (signal.aborted || editor.isDestroyed) return;
      applyAnnotationsToEditor(editor, side.annotations);
    });
  }

  return {
    aborted: false,
    chunkCount,
    topLevelNodes: docContent.length,
    newDocSize: editor.state.doc.nodeSize,
    oldDocSize,
    ms: performance.now() - t0,
  };
}

/**
 * Prepare raw markdown for use as Tiptap's initial `content` option.
 * Strips annotation prefixes and encodes image paths. Returns the cleaned
 * string AND the annotation map (apply with `applyAnnotationsToEditor` after
 * the editor is created).
 */
export function prepareInitialContent(rawMarkdown: string): {
  content: string;
  annotations: Map<number, string>;
  tableMetadata: TableColumnMetadataMap;
  nodeIds: Map<number, string>;
} {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(cleaned);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  return {
    content: convertDataUriImagesToHtml(convertImagesWithMetaToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta)))))))))))))),
    annotations,
    tableMetadata: metadata,
    nodeIds,
  };
}
