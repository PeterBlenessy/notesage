import type { JsonSchema } from './structured';
import { generateStructured } from './structured';
import { resolveConnectionCredentials } from './credentials';
import type { Connection } from './connections';

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

// ===========================================================================
// The refinement engine (`refineAction`)
//
// Refines a single action-item line into a {@link RefinementResult}. The engine
// is agent-agnostic: it dispatches by connection *shape*, mirroring how the rest
// of the app routes (see `resolveConnectionCredentials`).
//
//  - Direct-API connections (`api_key` / `local` / `local_bundled`) → schema-
//    constrained `generateStructured`. On the GBNF-capable subset the grammar
//    guarantees a schema-valid object; cloud `api_key` providers fall back to a
//    best-effort parse (and `isRefinementResult` rejects malformed output).
//  - `agent_managed` (ACP) connections → an injected one-shot `acpPrompt` runner.
//    There is no `response_format` path for ACP, so the prompt asks for a fenced
//    ```json block and the engine parses it best-effort with one retry.
//
// See docs/prds/2026-06-13-ambient-action-refinement.md ("Running — the engine").
// ===========================================================================

/** Minimal surrounding context for a refinement (no whole-doc context). */
export interface RefineContext {
  /** Heading ancestry of the line, outermost first. Used for minimal context. */
  headingPath?: string[];
}

/** Injected dependencies — keeps `refineAction` pure-ish and unit-testable. */
export interface RefineDeps {
  connection: Connection;
  /** Injected by the watcher for agent_managed connections: a one-shot "prompt → final assistant text". */
  acpPrompt?: (prompt: string) => Promise<string>;
  /** Test seam: override the direct-API generator. Defaults to `generateStructured`. */
  generate?: typeof generateStructured;
}

/** Human-readable meaning of each verdict, in declaration order. */
const VERDICT_MEANINGS: Record<RefinementVerdict, string> = {
  keep: 'already a clear, actionable next step — leave it unchanged.',
  sharpen: 'the same task made specific (owner / deadline / a concrete outcome).',
  split: 'a compound task — break it into a parent plus concrete sub-steps.',
  defer: 'not actionable yet — it needs a precondition first; flag it.',
  drop: 'not an action at all (a note or observation) — suggest removing it.',
};

/**
 * Build the system prompt shared by both dispatch paths. Defines the verdict
 * taxonomy, the "sharpen, don't pad" directive, and the role of sub-steps.
 */
export function buildRefinementSystemPrompt(): string {
  const taxonomy = REFINEMENT_VERDICTS.map(
    (v) => `- "${v}": ${VERDICT_MEANINGS[v]}`,
  ).join('\n');

  return [
    'You are an action-item refinement engine. You receive a single action-item line',
    'from a note and triage it into exactly one verdict, then sharpen it.',
    '',
    'Verdicts:',
    taxonomy,
    '',
    'Rules:',
    '- Choose exactly one verdict.',
    '- "outcome" is a single concrete line: sharpen, do not pad. One clear next step,',
    '  not a paragraph. Leave "outcome" as an empty string when the verdict is "keep".',
    '- "steps" carries concrete sub-steps and is mainly populated for the "split"',
    '  verdict; leave it empty otherwise.',
    '- "rationale" is one short clause explaining the verdict.',
  ].join('\n');
}

/** Build the user message from the line plus its (compact) heading ancestry. */
function buildRefinementUserMessage(line: string, context: RefineContext): string {
  const parts: string[] = [];
  const headingPath = context.headingPath?.filter((h) => h.trim().length > 0) ?? [];
  if (headingPath.length > 0) {
    parts.push(`Heading context: ${headingPath.join(' › ')}`);
  }
  parts.push(`Action item: ${line}`);
  return parts.join('\n');
}

/**
 * Extract the first JSON object from an ACP agent's text reply. Prefers a fenced
 * ```json block; falls back to the first balanced `{...}` span.
 */
function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fenced && fenced[1].trim()) {
    return fenced[1].trim();
  }

  // Fallback: first balanced top-level object.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse an ACP text reply into a validated RefinementResult, or null on failure. */
function parseRefinementReply(reply: string): RefinementResult | null {
  const json = extractJsonBlock(reply);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return isRefinementResult(parsed) ? parsed : null;
}

/**
 * Refine a single action-item `line` into a {@link RefinementResult}. Dispatches
 * by `deps.connection` shape (direct-API vs `agent_managed`). Throws a clear
 * Error on a usable-result failure so the caller can record a per-entry error.
 */
export async function refineAction(
  line: string,
  context: RefineContext,
  deps: RefineDeps,
): Promise<RefinementResult> {
  const { connection } = deps;
  const systemPrompt = buildRefinementSystemPrompt();
  const userMessage = buildRefinementUserMessage(line, context);

  // ---- ACP path (agent_managed) ----------------------------------------
  if (connection.authMethod === 'agent_managed') {
    const acpPrompt = deps.acpPrompt;
    if (!acpPrompt) {
      throw new Error(
        'refineAction: an agent_managed connection requires an injected acpPrompt runner.',
      );
    }

    const jsonInstruction =
      'Reply with ONLY a fenced ```json block containing an object with these keys: ' +
      '"verdict" (one of ' +
      REFINEMENT_VERDICTS.map((v) => `"${v}"`).join(', ') +
      '), "outcome" (string), "steps" (array of { "text": string }), and "rationale" (string). ' +
      'No prose outside the code block.';

    const basePrompt = `${systemPrompt}\n\n${userMessage}\n\n${jsonInstruction}`;
    const firstReply = await acpPrompt(basePrompt);
    const first = parseRefinementReply(firstReply);
    if (first) return first;

    // One stricter retry.
    const retryPrompt =
      `${basePrompt}\n\nYour previous reply could not be parsed. ` +
      'Return ONLY the JSON object inside a single ```json code block, with no prose before or after.';
    const secondReply = await acpPrompt(retryPrompt);
    const second = parseRefinementReply(secondReply);
    if (second) return second;

    throw new Error(
      'refineAction: the agent did not return a valid RefinementResult after a retry.',
    );
  }

  // ---- Direct-API path -------------------------------------------------
  const resolved = resolveConnectionCredentials(connection);
  if (!resolved) {
    throw new Error(
      `refineAction: could not resolve direct-API credentials for connection "${connection.id}".`,
    );
  }

  const generate = deps.generate ?? generateStructured;
  const result = await generate<unknown>({
    schema: REFINEMENT_RESULT_SCHEMA,
    schemaName: 'refinement',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    provider: resolved.provider,
    connectionId: resolved.connectionId,
    ollamaUrl: resolved.ollamaUrl,
    model: resolved.config?.model,
    temperature: resolved.config?.temperature,
    maxTokens: resolved.config?.maxTokens,
    baseUrl: resolved.config?.baseUrl,
  });

  if (!isRefinementResult(result)) {
    throw new Error(
      'refineAction: the model did not return a valid RefinementResult.',
    );
  }
  return result;
}
