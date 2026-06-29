// Automation template renderer — substitutes `{{ … }}` tokens against a run
// context. Pure path lookup, NEVER eval: a token is a dotted path into the
// context object, so a token can only read data, never execute code.
//
// Supported tokens: {{today}}, {{now}}, {{trigger.<field>}},
// {{steps.<id>.output}}, {{steps.<id>.json.<path>}} (R2 structured output).
//
// PRD: docs/prds/2026-06-28-automations.md (Task #6)

import type { StepResult } from './types';

export interface RunContext {
  /** The trigger payload — `{ type, file?, event?, path?, … }`. */
  trigger: Record<string, unknown>;
  /** Prior step results, keyed by step id. */
  steps: Record<string, StepResult>;
  /** Local calendar date, `YYYY-MM-DD`. */
  today: string;
  /** Local date-time, `YYYY-MM-DD HH:mm`. */
  now: string;
}

export interface RenderResult {
  text: string;
  /** Paths that resolved to nothing — surfaced by the runner for debugging. */
  warnings: string[];
}

// `[^{}]` keeps a token from spanning `}}`; non-greedy trims to the first close.
const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local `YYYY-MM-DD` (matches the scheduler's local-time interpretation). */
export function formatToday(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `YYYY-MM-DD HH:mm`. */
export function formatNow(date: Date): string {
  return `${formatToday(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Build a context, deriving `today`/`now` from `date` (default: now). */
export function buildRunContext(opts: {
  trigger: Record<string, unknown>;
  steps?: Record<string, StepResult>;
  date?: Date;
}): RunContext {
  const date = opts.date ?? new Date();
  return {
    trigger: opts.trigger ?? {},
    steps: opts.steps ?? {},
    today: formatToday(date),
    now: formatNow(date),
  };
}

/** Pure dotted-path lookup (`"steps.x.json.field"`). Exported for the condition
 *  evaluator (condition-expr.ts) so token resolution stays in one place. */
export function deepGet(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const segment of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    // Never walk the prototype chain — a token/condition path like
    // `constructor.name` or `__proto__.x` must resolve to nothing, not leak
    // engine internals (and never enable prototype pollution).
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Render `input`, replacing `{{ path }}` tokens; missing paths → '' + warning. */
export function renderTemplate(input: string, ctx: RunContext): RenderResult {
  const warnings: string[] = [];
  const text = input.replace(TOKEN_RE, (_match, rawPath: string) => {
    const path = rawPath.trim();
    const value = deepGet(ctx, path);
    if (value === undefined || value === null) {
      warnings.push(path);
      return '';
    }
    return stringify(value);
  });
  return { text, warnings };
}

/** Convenience: rendered text only (warnings discarded). */
export function render(input: string, ctx: RunContext): string {
  return renderTemplate(input, ctx).text;
}
