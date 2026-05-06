/**
 * Main-thread bridge to the markdown-parse Web Worker.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2" and
 * Phase 2 task #3.
 *
 * Public API: `parseInWorker(markdown, projectRoot, opts)` returns a Promise
 * that resolves with the worker's `ParseResult` (ProseMirror JSON + timings).
 * Cancellation: caller passes an `AbortSignal`; on abort we drop the entry
 * from the pending map and the worker's eventual response is silently
 * discarded. We do NOT terminate the worker — terminate-and-respawn is
 * more expensive than letting an orphan parse run to completion in the
 * background.
 *
 * Quiet Composer single-document semantics mean at most ONE in-flight
 * parse is "active" at a time, but the bridge is shaped for arbitrary
 * concurrency (the caller decides what's still relevant via abort).
 *
 * Contract with the worker:
 *   - Caller posts markdown that has ALREADY had its main-thread-only
 *     preprocessors applied (image path resolution, sidecar reads, etc.).
 *     The worker only runs pure-string preprocessors. See Phase 2 #7.
 *   - Worker emits a `WorkerReady` message on module load before it can
 *     handle any `ParseRequest`. The bridge buffers any pre-ready requests
 *     and flushes them on receipt.
 *   - Worker errors fall through to caller's catch — caller decides whether
 *     to retry, fall back to main-thread parse (#15), or surface to user.
 */

import MarkdownParseWorker from "@/workers/markdown-parse.worker?worker";
import type {
  ParseRequest,
  ParseResult,
  ParseProgress,
  WorkerOutbound,
} from "@/workers/markdown-parse.types";

interface PendingParse {
  resolve: (value: ParseResult) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: ParseProgress) => void;
  /** Removed from pending map on abort; the worker's eventual response is dropped. */
  aborted: boolean;
}

interface ParseOpts {
  /** Optional progress callback fired for every `ParseProgress` event. */
  onProgress?: (progress: ParseProgress) => void;
  /** Optional abort signal. On abort the parse promise rejects with `AbortError`. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Singleton worker — lazy-spawned on first `parseInWorker` call.
// ---------------------------------------------------------------------------

let workerInstance: Worker | null = null;
let workerReady = false;
const pendingParses = new Map<string, PendingParse>();
const preReadyQueue: ParseRequest[] = [];

function ensureWorker(): Worker {
  if (workerInstance) return workerInstance;
  const worker = new MarkdownParseWorker();

  worker.addEventListener("message", (event: MessageEvent<WorkerOutbound>) => {
    const msg = event.data;
    if (!msg) return;
    switch (msg.type) {
      case "ready": {
        workerReady = true;
        // Flush any messages that arrived before ready.
        while (preReadyQueue.length > 0) {
          const req = preReadyQueue.shift()!;
          worker.postMessage(req);
        }
        return;
      }
      case "progress": {
        const pending = pendingParses.get(msg.id);
        if (!pending || pending.aborted) return;
        pending.onProgress?.(msg);
        return;
      }
      case "result": {
        const pending = pendingParses.get(msg.id);
        pendingParses.delete(msg.id);
        if (!pending || pending.aborted) return;
        pending.resolve(msg);
        return;
      }
      case "error": {
        const pending = pendingParses.get(msg.id);
        pendingParses.delete(msg.id);
        if (!pending || pending.aborted) return;
        const err = new Error(msg.message);
        if (msg.stack) err.stack = msg.stack;
        pending.reject(err);
        return;
      }
    }
  });

  worker.addEventListener("error", (event) => {
    // Module-load or uncaught error — fail every pending parse.
    const err = new Error(event.message || "worker error");
    for (const [, pending] of pendingParses) {
      if (!pending.aborted) pending.reject(err);
    }
    pendingParses.clear();
  });

  workerInstance = worker;
  return worker;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse markdown to ProseMirror JSON in a Web Worker. The caller is
 * responsible for:
 *   - Stripping frontmatter (preview backend already does this for the
 *     preview surface; the worker path uses `tab.content` which is already
 *     post-frontmatter).
 *   - Running any DOM-dependent preprocessors first (Phase 2 task #7).
 *
 * The returned promise resolves with the worker's `ParseResult` or rejects
 * with an `Error`. Aborting the signal removes the pending entry; the
 * worker continues running in the background but its eventual response is
 * discarded (orphan parse — cheap).
 */
export function parseInWorker(
  markdown: string,
  projectRoot: string | undefined,
  opts?: ParseOpts,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    const pending: PendingParse = {
      resolve,
      reject,
      onProgress: opts?.onProgress,
      aborted: false,
    };
    pendingParses.set(id, pending);

    if (opts?.signal) {
      if (opts.signal.aborted) {
        pendingParses.delete(id);
        reject(new DOMException("parse aborted", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => {
        const entry = pendingParses.get(id);
        if (entry) {
          entry.aborted = true;
          pendingParses.delete(id);
          reject(new DOMException("parse aborted", "AbortError"));
        }
      });
    }

    const worker = ensureWorker();
    const request: ParseRequest = {
      type: "parse",
      id,
      markdown,
      projectRoot,
    };
    if (workerReady) {
      worker.postMessage(request);
    } else {
      preReadyQueue.push(request);
    }
  });
}

/**
 * Test-only escape hatch — terminates the worker so the next call respawns
 * a fresh instance. Lets vitest reset state between tests.
 */
export function terminateWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
    workerReady = false;
    preReadyQueue.length = 0;
    for (const [, pending] of pendingParses) {
      if (!pending.aborted) {
        pending.reject(new Error("worker terminated"));
      }
    }
    pendingParses.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lightweight UUID — `crypto.randomUUID` is fine in modern WKWebView. */
function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
