/**
 * Web Worker for the large-file instant-load Phase 2 hydration pipeline.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2".
 *
 * Receives partially-preprocessed markdown from the main thread, runs the
 * remaining pure-string preprocessors, builds a ProseMirror Schema from the
 * worker-only extension subset, parses to a doc node, and posts the JSON
 * result back. The main thread then calls `editor.commands.setContent(json,
 * false)` — much cheaper than parsing the markdown itself, so the editor's
 * hydration cost on the main thread drops from ~5s to ~milliseconds.
 *
 * Worker-safety constraints (PRD § "Worker scope"):
 *   - No DOM, no `window`, no Tauri IPC.
 *   - The Tiptap extensions imported here MUST not touch the DOM at module
 *     load time. See `worker-extensions.ts` for the curated subset (M2.3 #9).
 *   - Sidecar reads (drawings, charts) happen on the main thread post-swap;
 *     the worker emits placeholder nodes (M2.2 #8).
 *
 * This file is a STUB during M2.1. The actual parse pipeline lands in
 * M2.3 #10 once the worker-safe schema is built.
 */

import type {
  ParseRequest,
  ParseError,
  ParseTimings,
  WorkerOutbound,
} from "./markdown-parse.types";

/** Type-safe `postMessage` wrapper — keeps every outbound message in sync with the protocol. */
function post(message: WorkerOutbound): void {
  // Workers run in the dedicated `DedicatedWorkerGlobalScope` — `postMessage`
  // is a global function with the same shape as `Window.postMessage` but no
  // target-origin parameter.
  (self as unknown as { postMessage: (m: WorkerOutbound) => void }).postMessage(message);
}

/** Build a ParseError envelope from any thrown value. */
function toParseError(id: string, err: unknown): ParseError {
  if (err instanceof Error) {
    return { type: "error", id, message: err.message, stack: err.stack };
  }
  return { type: "error", id, message: String(err) };
}

/**
 * Handle one `ParseRequest`. STUB — the actual pipeline lands in M2.3 #10.
 * For now it returns an error so any premature caller falls back to the
 * legacy main-thread path via the bridge's catch (Phase 2 task #15).
 */
async function handleParse(req: ParseRequest): Promise<void> {
  const totalStart = performance.now();
  try {
    // M2.3 #10 will replace this with: pure-preprocess → schema → parse →
    // toJSON → post ParseResult. For now, intentionally unimplemented so the
    // bridge's worker-fallback path is exercised.
    void req;
    void totalStart;
    throw new Error("worker parse not yet implemented (M2.3 #10)");
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

// Signal readiness immediately. The bridge waits for this before posting
// the first ParseRequest so we don't race the worker's module init.
post({ type: "ready" });

// Tiny self-test in dev: the unused-imports below would cause TS errors
// if the import path or types changed. Reference them once for the linter.
export type _Tings = ParseTimings;
