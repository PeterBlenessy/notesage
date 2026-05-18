/**
 * Message protocol between the main thread and the markdown-parse Web Worker.
 * See PRD § "Worker message protocol" and Phase 2 task #2.
 *
 * Both sides import from this file so the discriminated unions stay in sync.
 * Each message carries a correlation `id` (UUID) so multiple in-flight parses
 * can be tracked at the protocol level — Quiet Composer only ever has one
 * active document, but the protocol stays generic for clarity and to make
 * cancellation reasoning straightforward (the bridge ignores results for ids
 * it no longer cares about; the worker doesn't need to know).
 */

import type { JSONContent } from "@tiptap/core";

/** Stage names used in `ParseProgress` events. Kept narrow on purpose. */
export type ParseStage = "preprocess" | "parse" | "finalize";

// ---------------------------------------------------------------------------
// Main → Worker
// ---------------------------------------------------------------------------

export interface ParseRequest {
  type: "parse";
  /** Correlation id — caller-generated, echoed back in every response. */
  id: string;
  /** Raw markdown body (frontmatter already stripped by the caller). */
  markdown: string;
  /**
   * Project root for resolving relative-image / drawing-sidecar / chart-sidecar
   * paths. The worker can't read files via Tauri IPC, so it emits placeholder
   * nodes for sidecar-backed content; the main thread resolves the placeholders
   * after the swap. The path is included for nodes that just need to remember
   * their resolution context.
   */
  projectRoot?: string;
}

// ---------------------------------------------------------------------------
// Worker → Main
// ---------------------------------------------------------------------------

export interface ParseProgress {
  type: "progress";
  id: string;
  stage: ParseStage;
  /** 0..1 within the stage. Useful for the EditorHydratingOverlay (#17). */
  pct: number;
}

export interface ParseTimings {
  /** Milliseconds spent in the pure preprocessor chain. */
  preprocess: number;
  /** Milliseconds spent in markdown-it + prosemirror-markdown parsing. */
  parse: number;
  /** Total wall-clock from request received to result posted. */
  total: number;
}

/**
 * Successful parse result. The `doc` field is the ProseMirror JSON
 * representation that the main thread feeds to `editor.commands.setContent()`
 * via the `loadParsedJsonIntoEditor` helper (Phase 2 task #11). The
 * `annotations` / `nodeIds` / `tableMetadataEntries` fields are the
 * side-channel maps that get re-applied to the editor after `setContent`.
 *
 * Note: maps are serialised as plain entries arrays for `postMessage`
 * structured-clone safety. Maps clone fine but arrays are slightly cheaper
 * and easier to type-assert.
 */
export interface ParseResult {
  type: "result";
  id: string;
  /** ProseMirror doc JSON — `node.toJSON()` output from the worker side. */
  doc: JSONContent;
  /** Annotation prefix map (list-item index → emoji). Empty if none. */
  annotationsEntries: Array<[number, string]>;
  /** Node ID map (block index → UUID). Empty if none. */
  nodeIdsEntries: Array<[number, string]>;
  /** Table column metadata. Outer key: table idx. Inner: col idx → metadata entries. */
  tableMetadataEntries: Array<
    [number, Array<[number, { colType?: string; colCurrency?: string; colAggregation?: string }]>]
  >;
  /** Per-parse timings for the perf benchmark + `[perf:doc-load]` log. */
  timings: ParseTimings;
}

/**
 * Worker errored. Caller falls back to the legacy main-thread parse path
 * (`loadRawMarkdownIntoEditor`) — see Phase 2 task #15.
 */
export interface ParseError {
  type: "error";
  id: string;
  message: string;
  /** Optional JS stack — present when the error is a thrown `Error` object. */
  stack?: string;
}

/**
 * Worker-→main signal that the worker is alive and ready to handle messages.
 * Posted automatically on worker module load. The bridge waits for this
 * before posting the first ParseRequest.
 */
export interface WorkerReady {
  type: "ready";
}

export type WorkerOutbound = ParseProgress | ParseResult | ParseError | WorkerReady;
export type WorkerInbound = ParseRequest;
