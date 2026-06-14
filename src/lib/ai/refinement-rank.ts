import type { RefinementEntry, RefinementVerdict } from './refinement';

/**
 * Ranking for the AgentPanel "Refinements" section (task #13 — "Top 5").
 *
 * Surfaces the most useful pending refinements first. Ordering is:
 *  1. Verdict priority — the verdicts that most reward attention come first.
 *     `sharpen` / `split` (the engine actively improved the line) outrank
 *     `defer` (needs a precondition) which outranks `drop` (suggest removal).
 *  2. Recency — within a priority bucket, newest (`createdAt` desc) first.
 *
 * `keep` entries are never ranked (they carry no actionable change) and are
 * filtered out alongside any non-`pending` entry, mirroring the apply
 * extension's `getPendingEntries`.
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md`.
 */

/**
 * Verdict → priority weight. Higher wins. `keep` is 0 (and filtered out before
 * sorting), the rest descend sharpen/split > defer > drop.
 */
const VERDICT_PRIORITY: Record<RefinementVerdict, number> = {
  sharpen: 3,
  split: 3,
  defer: 2,
  drop: 1,
  keep: 0,
};

/**
 * Rank pending, non-`keep` refinement entries and return the top `limit`.
 *
 * Pure — does not mutate the input array. Order: verdict priority desc, then
 * `createdAt` desc (newest first). The default `limit` of 5 backs the
 * "Top 5" section in the AgentPanel.
 */
export function rankRefinements(
  entries: RefinementEntry[],
  limit = 5,
): RefinementEntry[] {
  const ranked = entries
    .filter((e) => e.status === 'pending' && e.result.verdict !== 'keep')
    .slice()
    .sort((a, b) => {
      const pa = VERDICT_PRIORITY[a.result.verdict] ?? 0;
      const pb = VERDICT_PRIORITY[b.result.verdict] ?? 0;
      if (pa !== pb) return pb - pa;
      return b.createdAt - a.createdAt;
    });

  if (limit < 0) return [];
  return ranked.slice(0, limit);
}
