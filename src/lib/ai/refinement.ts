import type { JsonSchema } from './structured';

/**
 * Ambient action-refinement engine — shared type contract.
 *
 * The engine analyzes action items as the user writes and produces a triaged
 * verdict + a sharpened outcome + optional sub-steps. See
 * `docs/prds/2026-06-13-ambient-action-refinement.md`.
 *
 * This module is the type/schema foundation only (task #1). The engine itself
 * (`refineAction`) lives in the same file family but is added by later tasks.
 */

/**
 * The engine's triage decision for a single action item.
 *
 * - `keep`    — already a clear, actionable next step; no change.
 * - `sharpen` — same task, made specific (owner / deadline / concrete outcome).
 * - `split`   — compound task → parent + nested sub-steps.
 * - `defer`   — not actionable now; needs a precondition. Flag it.
 * - `drop`    — not an action at all (note/observation); suggest removing it.
 */
export type RefinementVerdict = 'keep' | 'sharpen' | 'split' | 'defer' | 'drop';

/** All verdicts, in declaration order. Single source for the JSON-schema enum. */
export const REFINEMENT_VERDICTS: readonly RefinementVerdict[] = [
  'keep',
  'sharpen',
  'split',
  'defer',
  'drop',
] as const;

export interface RefinementStep {
  text: string;
}

/**
 * The structured result of refining one action item. On the GBNF-capable
 * provider paths this is schema-guaranteed; on `agent_managed` (ACP) paths it
 * is parsed best-effort from the agent's reply (see the engine task).
 */
export interface RefinementResult {
  verdict: RefinementVerdict;
  /** Sharpened single-line outcome. Empty when `verdict === 'keep'`. */
  outcome: string;
  /** Concrete sub-steps; non-empty mainly for `split`. */
  steps: RefinementStep[];
  /** One short clause explaining the verdict (shown on hover). */
  rationale: string;
}

export type RefinementEntryStatus = 'pending' | 'applied' | 'dismissed';

/**
 * A refinement as held in `refinement-store` (non-persisted — rebuilt from the
 * document's `ns-refine` comments on open). Keyed by document path + anchor.
 */
export interface RefinementEntry {
  id: string;
  docPath: string;
  /** ProseMirror anchor + source content hash for divergence detection. */
  anchor: { from: number; to: number };
  srcHash: string;
  originalText: string;
  result: RefinementResult;
  status: RefinementEntryStatus;
  /** Set when the backing provider failed to produce a usable result. */
  error?: string;
  createdAt: number;
}

/**
 * JSON Schema mirror of {@link RefinementResult} for `generateStructured`.
 * `strict: true` is applied by `buildJsonSchemaResponseFormat`; on the
 * GBNF-capable paths (`local_bundled` / `openai_compatible` / `ollama`) this
 * guarantees a schema-valid object.
 */
export const REFINEMENT_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'outcome', 'steps', 'rationale'],
  properties: {
    verdict: {
      type: 'string',
      enum: [...REFINEMENT_VERDICTS],
      description: 'Triage decision for this action item.',
    },
    outcome: {
      type: 'string',
      description: 'Sharpened single-line action. Empty string when verdict is "keep".',
    },
    steps: {
      type: 'array',
      description: 'Concrete sub-steps; mainly populated for "split".',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string' },
        },
      },
    },
    rationale: {
      type: 'string',
      description: 'One short clause explaining the verdict.',
    },
  },
};

/** Runtime guard: does an unknown value match the {@link RefinementResult} shape? */
export function isRefinementResult(value: unknown): value is RefinementResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.verdict !== 'string' || !REFINEMENT_VERDICTS.includes(v.verdict as RefinementVerdict)) {
    return false;
  }
  if (typeof v.outcome !== 'string') return false;
  if (typeof v.rationale !== 'string') return false;
  if (!Array.isArray(v.steps)) return false;
  return v.steps.every(
    (s) => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).text === 'string',
  );
}
