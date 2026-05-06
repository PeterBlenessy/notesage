/**
 * Pure parse pipeline used by the markdown-parse Web Worker. Lives in its
 * own module so vitest tests can import and invoke it directly without
 * spinning up a real Worker — see Phase 2 task #19's parity test.
 *
 * The pipeline runs IDENTICALLY in the worker and in test environments:
 * markdown → preprocessor chain → markdown-it → DOMParser → ProseMirror Node
 * → JSON. The only difference is that in vitest jsdom, `globalThis.DOMParser`
 * resolves to jsdom's DOMParser; in a worker it's `self.DOMParser`. Both
 * conform to the WHATWG DOMParser interface, so ProseMirror's parser walks
 * either tree the same way.
 *
 * NOT a worker file itself — the actual worker entry point is
 * `markdown-parse.worker.ts` which wraps this with `postMessage` glue.
 */

import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import markdownit from "markdown-it";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";
import taskListPlugin from "markdown-it-task-lists";
import { parseHTML } from "linkedom";
import type { JSONContent } from "@tiptap/core";
import { workerExtensions } from "./worker-extensions";
import { prepareMarkdownForParse } from "@/lib/markdown-preprocess-pure";
import type { TableColumnMetadataMap } from "@/lib/markdown";

// ---------------------------------------------------------------------------
// Shared schema + markdown-it instance — initialized once on module load.
// ---------------------------------------------------------------------------

const schema = getSchema(workerExtensions);

const md = markdownit({ html: true, linkify: false, breaks: false });
md.use(markdownitSub);
md.use(markdownitSup);
md.use(taskListPlugin);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParsePipelineResult {
  doc: JSONContent;
  annotations: Map<number, string>;
  nodeIds: Map<number, string>;
  tableMetadata: TableColumnMetadataMap;
  timings: {
    preprocess: number;
    parse: number;
    total: number;
  };
}

/**
 * Run the full parse pipeline: markdown → preprocessor chain → markdown-it →
 * linkedom → ProseMirror Node → JSON. Returns the doc JSON plus the
 * side-channel maps (annotations, nodeIds, table metadata) the main thread
 * applies to the editor after `setContent`.
 *
 * Pure with respect to its input — no I/O, no editor, no DOM mutations.
 * Round-trip safe: the JSON output is byte-identical to what the main-thread
 * editor would produce via `editor.commands.setContent(markdown)` modulo
 * UniqueID's randomly-generated UUIDs (test fixtures must mask those).
 *
 * Why linkedom instead of native DOMParser:
 * WKWebView's dedicated worker scope doesn't expose `DOMParser` as a global
 * (despite MDN's compat data suggesting it's available since Safari 10.5).
 * Confirmed empirically 2026-05-06 — the worker-fallback path fired with
 * "DOMParser is not available in this environment" and Phase 2's perf win
 * never materialised. linkedom is a pure-JS DOM implementation that works
 * identically in worker, jsdom (vitest), and main-thread environments, and
 * its `parseHTML(html)` returns a Document that ProseMirror's DOMParser
 * walks the same way it walks a native DOM tree.
 */
export function parseMarkdownToProseMirrorJson(rawMarkdown: string): ParsePipelineResult {
  const totalStart = performance.now();

  const preprocessStart = performance.now();
  const { prepared, annotations, nodeIds, tableMetadata } = prepareMarkdownForParse(rawMarkdown);
  const preprocessMs = performance.now() - preprocessStart;

  const parseStart = performance.now();
  const html = md.render(prepared);
  // linkedom requires a full HTML document structure to populate `body`
  // correctly — passing a body fragment leaves `document.body` empty.
  // (Confirmed empirically 2026-05-06: `parseHTML("<body>x</body>")` yields
  // an empty body, while `parseHTML("<!DOCTYPE html><html><body>x</body></html>")`
  // works.)
  // ProseMirror's DOMParser uses standard DOM APIs (childNodes, tagName,
  // getAttribute, etc.) — linkedom implements all of them. The cast goes
  // through `unknown` because linkedom's Element type doesn't explicitly
  // extend lib.dom's Element but is structurally compatible.
  const fullHtml = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const { document } = parseHTML(fullHtml);
  const body = document.body as unknown as HTMLElement;
  const node = PMDOMParser.fromSchema(schema).parse(body);
  const parseMs = performance.now() - parseStart;

  return {
    doc: node.toJSON(),
    annotations,
    nodeIds,
    tableMetadata,
    timings: {
      preprocess: +preprocessMs.toFixed(1),
      parse: +parseMs.toFixed(1),
      total: +(performance.now() - totalStart).toFixed(1),
    },
  };
}
