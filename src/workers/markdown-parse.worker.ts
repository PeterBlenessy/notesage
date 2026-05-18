/**
 * Web Worker for the large-file instant-load Phase 2 hydration pipeline.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2".
 *
 * Thin wrapper around the parse pipeline in `markdown-parse.core.ts` —
 * adds `postMessage` glue, progress events, and error envelopes. The
 * actual parse logic lives in core.ts so vitest tests can call it
 * directly (Phase 2 #19 parity test).
 */

import { parseMarkdownToProseMirrorJson } from "./markdown-parse.core";
import type {
  ParseRequest,
  ParseError,
  ParseResult,
  ParseProgress,
  WorkerOutbound,
} from "./markdown-parse.types";

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

async function handleParse(req: ParseRequest): Promise<void> {
  try {
    progress(req.id, "preprocess", 0);
    const out = parseMarkdownToProseMirrorJson(req.markdown);
    progress(req.id, "parse", 1);

    progress(req.id, "finalize", 0);
    const tableMetadataEntries: ParseResult["tableMetadataEntries"] = [];
    for (const [tableIdx, colMap] of out.tableMetadata) {
      const colEntries: Array<[number, { colType?: string; colCurrency?: string; colAggregation?: string }]> = [];
      for (const [colIdx, meta] of colMap) {
        colEntries.push([colIdx, meta]);
      }
      tableMetadataEntries.push([tableIdx, colEntries]);
    }
    progress(req.id, "finalize", 1);

    const result: ParseResult = {
      type: "result",
      id: req.id,
      doc: out.doc,
      annotationsEntries: Array.from(out.annotations.entries()),
      nodeIdsEntries: Array.from(out.nodeIds.entries()),
      tableMetadataEntries,
      timings: out.timings,
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

post({ type: "ready" });
