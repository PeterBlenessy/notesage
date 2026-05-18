/**
 * Worker-safe re-exports of the pure-string preprocessor chain that runs
 * before Tiptap parses markdown. Imported by the markdown-parse Web Worker
 * (Phase 2 task #6) — keeps the worker's import surface narrow so future
 * maintainers don't accidentally pull in editor-touching helpers.
 *
 * The functions live in `markdown.ts` (single source of truth). This file
 * is a curated subset re-export that's been audited for worker safety —
 * none of the listed functions touch `document`, `window`, or Tauri IPC
 * (verified via `grep document\.\|window\.\|invoke` in markdown.ts on
 * 2026-05-06; only matches were inside JSDoc comments).
 *
 * Functions that take an `Editor` parameter (e.g. `applyAnnotationsToEditor`,
 * `applyTableColumnMetadata`, `applyNodeIdsToEditor`, `getMarkdownFromEditor`,
 * `setMarkdownInEditor`, `setContentWithoutHistory`, `loadRawMarkdownIntoEditor`)
 * are intentionally NOT re-exported here. They run on the main thread after
 * `setContent` returns.
 *
 * See PRD § "Worker-safety constraints" and Phase 2 task #5/#6.
 */

export {
  // Annotation prefix stripping (`{emoji}` markers on list items)
  // — pure string, returns Map<index, emoji> for post-load main-thread apply.
  stripAnnotationsFromMarkdown,

  // Empty/ghost task item normalization — pure regex.
  stripGhostTaskItems,
  normalizeEmptyTaskItems,

  // Callout preprocessing (Obsidian `> [!type]` → `<div class="callout">`)
  convertCalloutsToHtml,

  // Link-preview cards (`> [!link](url)` → `<div data-link-preview>`)
  convertLinkPreviewsToHtml,

  // Drawing fenced blocks (```excalidraw → `<div data-drawing>`)
  convertDrawingsToHtml,
  convertInlineDrawingsToHtml,

  // Chart fenced blocks (```chart → `<div data-chart>`)
  convertChartsToHtml,
  convertInlineChartsToHtml,

  // Mermaid fenced blocks (```mermaid → `<div data-mermaid>`)
  convertMermaidToHtml,

  // Page-break markers (`<!-- page-break -->` → `<div data-page-break>`)
  convertPageBreaksToHtml,
  restorePageBreaks,

  // TOC markers (`<!-- toc -->` → `<div data-toc>`)
  convertTocToHtml,
  restoreTocComments,

  // Image path encoding (spaces → %20 to dodge markdown-it parser)
  encodeImagePathSpaces,
  decodeImagePathSpaces,

  // Data-URI images (`![alt](data:image/png;base64,...)` → `<img>`)
  convertDataUriImagesToHtml,

  // Images with block-size metadata (`![alt](src) <!--blockWidth:N,align:X-->`
  //  → `<img data-block-width data-align>`)
  convertImagesWithMetaToHtml,

  // Table column metadata extraction (HTML comments in header cells)
  extractTableColumnMetadata,

  // Node ID stripping (UniqueID extension comments)
  stripNodeIdComments,

  // Type-only re-exports for callers that need to type the metadata maps.
  type ColumnMetadata,
  type TableColumnMetadataMap,
} from "@/lib/markdown";

import {
  stripAnnotationsFromMarkdown,
  stripNodeIdComments,
  extractTableColumnMetadata,
  stripGhostTaskItems,
  normalizeEmptyTaskItems,
  convertMermaidToHtml,
  convertCalloutsToHtml,
  convertPageBreaksToHtml,
  convertTocToHtml,
  convertLinkPreviewsToHtml,
  convertDrawingsToHtml,
  convertChartsToHtml,
  convertInlineDrawingsToHtml,
  convertInlineChartsToHtml,
  encodeImagePathSpaces,
  convertDataUriImagesToHtml,
  convertImagesWithMetaToHtml,
  type TableColumnMetadataMap,
} from "@/lib/markdown";

/**
 * Composite result of running the full pure-preprocessor chain. The worker
 * passes the `prepared` HTML-fragmented markdown to markdown-it, then
 * forwards the side-channel maps (`annotations`, `nodeIds`, `tableMetadata`)
 * back to the main thread so they can be re-applied to the editor after
 * `setContent`.
 */
export interface PrepareForParseResult {
  /** Markdown with all pure preprocessors applied — ready to feed to markdown-it. */
  prepared: string;
  /** List-item index → emoji map. Apply via `applyAnnotationsToEditor` post-setContent. */
  annotations: Map<number, string>;
  /** Block index → UUID map. Apply via `applyNodeIdsToEditor` post-setContent. */
  nodeIds: Map<number, string>;
  /** Table column metadata. Apply via `applyTableColumnMetadata` post-setContent. */
  tableMetadata: TableColumnMetadataMap;
}

/**
 * Apply the full pure-preprocessor chain in the same order as
 * `loadRawMarkdownIntoEditor` in `markdown.ts`. Returns the prepared markdown
 * + the side-channel maps that need to be re-applied after `setContent`.
 *
 * Worker-safe: every step is pure string→string. The order matches the
 * main-thread chain exactly so the ProseMirror JSON output is byte-identical
 * (verified by Phase 2 task #19's parity test).
 */
export function prepareMarkdownForParse(rawMarkdown: string): PrepareForParseResult {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(cleaned);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  // Innermost-first; matches `loadRawMarkdownIntoEditor` exactly.
  const prepared = convertDataUriImagesToHtml(
    convertImagesWithMetaToHtml(
    encodeImagePathSpaces(
      convertInlineChartsToHtml(
        convertInlineDrawingsToHtml(
          convertChartsToHtml(
            convertDrawingsToHtml(
              convertLinkPreviewsToHtml(
                convertTocToHtml(
                  convertPageBreaksToHtml(
                    convertCalloutsToHtml(
                      convertMermaidToHtml(
                        normalizeEmptyTaskItems(stripGhostTaskItems(noMeta)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    ),
  );
  return { prepared, annotations, nodeIds, tableMetadata: metadata };
}
