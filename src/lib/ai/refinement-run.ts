import { hashLine } from './refinement-hash';
import { planRefinement } from './refinement-plan';
import { refineAction } from './refinement';
import type { Connection } from './connections';
import type { RefinementEntry } from './refinement';

/**
 * The testable dispatch core of the ambient watcher (task #9). `analyzeBlock`
 * takes one committed block plus injected dependencies and decides whether to
 * call the engine, then records the outcome. It is deliberately free of editor,
 * React, and timer concerns so the gating + dispatch behaviour can be
 * unit-tested without a live ProseMirror editor — the hook
 * (`useRefinementWatcher`) wires editor events + debounce on top.
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md` ("Running — the engine").
 */

/** A committed block handed to the analyzer. Positions are inline (PM coords). */
export interface RefinementBlock {
  text: string;
  from: number;
  to: number;
  docPath: string;
  headingPath?: string[];
}

export interface AnalyzeBlockDeps {
  /** The resolved refinement-slot connection, or null when none is assigned. */
  connection: Connection | null;
  /** LRU seen-set predicate + recorder (from `createSeenSet`). */
  seen: { has: (hash: string) => boolean; add: (hash: string) => void };
  /** True when an entry for this hash+doc already exists (pending or applied). */
  alreadyRefined: (hash: string, docPath: string) => boolean;
  upsertEntry: (entry: RefinementEntry) => void;
  markSeen: (hash: string) => void;
  /** Test seam — defaults to the real engine. */
  refine?: typeof refineAction;
  /** Injected ACP one-shot for agent_managed connections (deferred in v1). */
  acpPrompt?: (prompt: string) => Promise<string>;
  /** Test seam — id generator. */
  makeId?: () => string;
}

export type AnalyzeOutcome =
  | 'skipped-no-connection'
  | 'skipped-gate'
  | 'skipped-acp-unwired'
  | 'kept'
  | 'refined'
  | 'error';

function defaultId(): string {
  return `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Decide + dispatch a single committed block. Returns a discriminated outcome
 * (used by the hook for backoff + `[perf:refine]` logging). Never throws — an
 * engine failure resolves to `'error'`.
 */
export async function analyzeBlock(
  block: RefinementBlock,
  deps: AnalyzeBlockDeps,
): Promise<AnalyzeOutcome> {
  if (!deps.connection) return 'skipped-no-connection';

  const hash = hashLine(block.text);
  const plan = planRefinement(block.text, {
    hash,
    alreadyRefined: deps.alreadyRefined(hash, block.docPath),
    seen: (h) => deps.seen.has(h),
  });
  if (plan !== 'dispatch') return 'skipped-gate';

  // ACP one-shot wiring is deferred (v1): direct-API connections cover the
  // local-first default. An agent_managed connection without an injected
  // acpPrompt is skipped gracefully rather than half-wired.
  if (deps.connection.authMethod === 'agent_managed' && !deps.acpPrompt) {
    return 'skipped-acp-unwired';
  }

  try {
    const refine = deps.refine ?? refineAction;
    const result = await refine(
      block.text,
      { headingPath: block.headingPath },
      { connection: deps.connection, acpPrompt: deps.acpPrompt },
    );

    if (result.verdict === 'keep') {
      deps.seen.add(hash);
      deps.markSeen(hash);
      return 'kept';
    }

    deps.upsertEntry({
      id: (deps.makeId ?? defaultId)(),
      docPath: block.docPath,
      anchor: { from: block.from, to: block.to },
      srcHash: hash,
      originalText: block.text,
      result,
      status: 'pending',
      createdAt: Date.now(),
    });
    return 'refined';
  } catch {
    return 'error';
  }
}
