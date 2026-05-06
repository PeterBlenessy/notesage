/**
 * Web Worker for the large-file instant-load Phase 2 hydration pipeline.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2".
 *
 * Pipeline:
 *   1. Receive partially-preprocessed markdown from the main thread.
 *   2. Run the pure-string preprocessor chain (`prepareMarkdownForParse`).
 *   3. Render markdown → HTML via markdown-it (worker-safe library).
 *   4. Parse HTML → DOM via the worker's global `DOMParser`.
 *   5. Walk the DOM via `prosemirror-model`'s DOMParser to build a
 *      ProseMirror Node against the worker-only schema.
 *   6. Call `node.toJSON()` and post `ParseResult` back to the main thread.
 *
 * The main thread then calls `editor.commands.setContent(json, false)` —
 * much cheaper than parsing markdown itself, which means the editor's
 * hydration cost on the main thread drops from ~5s to milliseconds.
 *
 * Worker-safety:
 *   - No `document`, no `window`, no Tauri IPC.
 *   - `self.DOMParser` is available in dedicated workers in modern WebKit
 *     (Safari 10.5+ / Chrome 65+ / Firefox 67+). Tauri uses WKWebView on
 *     macOS. If a downstream platform lacks worker DOMParser, the bridge's
 *     `worker-fallback` path (Phase 2 #15) catches the resulting error.
 *   - Sidecar reads (drawings, charts) happen on the main thread post-swap.
 *     The worker emits placeholder nodes; main thread resolves them after
 *     `setContent`.
 */

import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import markdownit from "markdown-it";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";
import taskListPlugin from "markdown-it-task-lists";
import { workerExtensions } from "./worker-extensions";
import { prepareMarkdownForParse } from "@/lib/markdown-preprocess-pure";
import type {
  ParseRequest,
  ParseError,
  ParseResult,
  ParseProgress,
  WorkerOutbound,
} from "./markdown-parse.types";

// ---------------------------------------------------------------------------
// Schema + markdown-it instance — built once on worker module load.
// ---------------------------------------------------------------------------

/** Built once at module load. Identical shape to the main-thread editor's schema. */
const schema = getSchema(workerExtensions);

/**
 * Markdown-it instance. Configuration mirrors tiptap-markdown's defaults
 * (`html: true`, `linkify: false`, `breaks: false`) plus the plugins our
 * editor uses (sub, sup, task-lists). `html: true` allows our preprocessors'
 * HTML fragments (`<div data-callout-type>`, `<div data-drawing-id>`, etc.)
 * to pass through unchanged for the DOM-parse step.
 */
const md = markdownit({ html: true, linkify: false, breaks: false });
md.use(markdownitSub);
md.use(markdownitSup);
md.use(taskListPlugin);

// ---------------------------------------------------------------------------
// Worker message handling
// ---------------------------------------------------------------------------

/** Type-safe `postMessage` wrapper — keeps every outbound message in sync. */
function post(message: WorkerOutbound): void {
  (self as unknown as { postMessage: (m: WorkerOutbound) => void }).postMessage(message);
}

function progress(id: string, stage: ParseProgress["stage"], pct: number): void {
  post({ type: "progress", id, stage, pct });
}

function toParseError(id: string, err: unknown): ParseError {
  if (err instanceof Error) {
    return { type: "error", id, message: err.message, stack: err.stack };
  }
  return { type: "error", id, message: String(err) };
}

/**
 * Handle one ParseRequest end-to-end. Errors fall through to the bridge,
 * which falls back to the legacy main-thread parse (Phase 2 #15).
 */
async function handleParse(req: ParseRequest): Promise<void> {
  const totalStart = performance.now();
  try {
    progress(req.id, "preprocess", 0);
    const preprocessStart = performance.now();
    const { prepared, annotations, nodeIds, tableMetadata } = prepareMarkdownForParse(req.markdown);
    void annotations; // forwarded back via ParseResult once schema for them is wired (M2.4)
    void nodeIds;
    void tableMetadata;
    const preprocessMs = performance.now() - preprocessStart;
    progress(req.id, "preprocess", 1);

    progress(req.id, "parse", 0);
    const parseStart = performance.now();
    // markdown-it: markdown → HTML
    const html = md.render(prepared);
    progress(req.id, "parse", 0.5);

    // DOM: HTML → Document. Workers expose `DOMParser` as a global in modern
    // WebKit. We wrap the body fragment in a `<body>` so the parser preserves
    // top-level whitespace + block structure exactly as tiptap-markdown does.
    const wrapped = `<body>${html}</body>`;
    const doc = new (self as unknown as { DOMParser: typeof DOMParser }).DOMParser().parseFromString(wrapped, "text/html");
    const body = doc.body;
    progress(req.id, "parse", 0.8);

    // ProseMirror: DOM → Node. The schema we built at module-load time tells
    // the DOMParser which HTML elements map to which nodes/marks.
    const node = PMDOMParser.fromSchema(schema).parse(body);
    const parseMs = performance.now() - parseStart;
    progress(req.id, "parse", 1);

    progress(req.id, "finalize", 0);
    const docJson = node.toJSON();
    progress(req.id, "finalize", 1);

    const result: ParseResult = {
      type: "result",
      id: req.id,
      doc: docJson,
      timings: {
        preprocess: +preprocessMs.toFixed(1),
        parse: +parseMs.toFixed(1),
        total: +(performance.now() - totalStart).toFixed(1),
      },
    };
    post(result);
  } catch (err) {
    post(toParseError(req.id, err));
  }
}

self.addEventListener("message", (event: MessageEvent<ParseRequest>) => {
  const msg = event.data;
  if (msg && msg.type === "parse") {
    void handleParse(msg);
  }
});

// Signal readiness immediately. The bridge (`markdown-worker.ts`) waits for
// this before posting the first ParseRequest so we don't race the worker's
// module init.
post({ type: "ready" });
