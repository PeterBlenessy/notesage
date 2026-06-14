import { isActionCandidate } from './refinement-detect';

/**
 * Pure decision core for the ambient action-refinement watcher.
 *
 * `planRefinement` is the single source of truth for the "should this committed
 * line be sent to the engine?" gate. It is deliberately free of any editor,
 * React, store, or async dependency so the gating logic can be unit-tested
 * directly (the truth table: candidate pre-filter × already-refined watermark ×
 * seen-set). The hook (`useRefinementWatcher`) feeds it the line text plus the
 * three pieces of context it needs and acts on the verdict.
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md` ("Detection — the
 * watcher" / "Incremental processing").
 */

/** The watcher's decision for a single committed line. */
export type RefinementPlan = 'dispatch' | 'skip';

/**
 * Context the planner needs to gate a line, all precomputed by the caller:
 *
 * - `hash`          — the content hash of the (visible) line text. The caller
 *   computes this via `hashLine` so the planner stays dependency-light and the
 *   same hash can be reused for the seen-set / store keying.
 * - `alreadyRefined` — true when the line already carries a valid `ns-refine`
 *   comment whose stored `srcHash` still matches the current line (i.e. the line
 *   is unchanged since it was refined). Computed via `isLineRefined`. When the
 *   user edits a refined line the hash diverges, this flips to false, and the
 *   line re-dispatches — that divergence is the whole point of the watermark.
 * - `seen`          — predicate over the LRU seen-set: lines the engine looked
 *   at and had nothing to refine. Computed via `createSeenSet().has`.
 */
export interface RefinementPlanContext {
  hash: string;
  alreadyRefined: boolean;
  seen: (hash: string) => boolean;
}

/**
 * Decide whether a committed line should be dispatched to the refinement engine.
 *
 * Returns `'dispatch'` only when ALL hold:
 *   1. the line looks like an action item (`isActionCandidate`),
 *   2. it is not already refined-and-unchanged (`!alreadyRefined`), and
 *   3. its hash is not in the seen-set (`!seen(hash)`).
 *
 * Otherwise returns `'skip'`. Pure and synchronous.
 */
export function planRefinement(
  lineText: string,
  ctx: RefinementPlanContext,
): RefinementPlan {
  if (!isActionCandidate(lineText)) return 'skip';
  if (ctx.alreadyRefined) return 'skip';
  if (ctx.seen(ctx.hash)) return 'skip';
  return 'dispatch';
}
