// Per-step `if` evaluator (Phase 4, Track A). A step runs only when its `if`
// expression is truthy. This is a tiny, HAND-WRITTEN parser over the run
// context — there is NO eval/Function/template-literal evaluation; the
// expression is pure data (a path lookup via `deepGet` + a literal comparison),
// so a hostile `if` (`process.env`, `constructor`, `${…}`, `"; rm -rf …`) can
// only ever resolve to undefined or a string compare — never execute.
//
// Grammar:
//   <path> <op> <literal>   op ∈ ==, !=, contains, matches(regex)
//   <path>                  bare path → truthiness
// `<path>` resolves against the RunContext (`steps.x.output`, `steps.x.json.f`,
// `trigger.file`, `today`, …); an optional `{{ }}` wrapper is stripped.
// `<literal>` is a quoted string, number, boolean, or null.
//
// PRD: docs/prds/2026-06-28-automations.md (Task A1)

import { deepGet, type RunContext } from './template';

type Op = '==' | '!=' | 'contains' | 'matches';

interface Parsed {
  lhs: string;
  op: Op;
  rhs: string;
}

/** Split `<lhs> <op> <rhs>`; `null` when there's no operator (bare truthiness). */
function parseExpr(expr: string): Parsed | null {
  // Symbol ops first (==, !=). Non-greedy lhs so the FIRST operator wins.
  let m = expr.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (m) return { lhs: m[1].trim(), op: m[2] as Op, rhs: m[3].trim() };
  // Word ops (contains, matches) — must be space-delimited tokens.
  m = expr.match(/^(.+?)\s+(contains|matches)\s+(.+)$/);
  if (m) return { lhs: m[1].trim(), op: m[2] as Op, rhs: m[3].trim() };
  return null;
}

/** Resolve a path token against the context (strips an optional `{{ }}`). */
function resolvePath(token: string, ctx: RunContext): unknown {
  const path = token
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim();
  return deepGet(ctx, path);
}

/** Parse a right-hand literal: quoted string, boolean, null, number, or bare word. */
function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  return s; // bare word → string
}

/** Equality with light cross-type coercion (resolved values are often strings). */
function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === typeof b) return a === b;
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}

/** Truthiness of a resolved value (empty string / 0 / [] / null → false). */
function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '' && v !== 'false';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return true; // non-empty object
}

/** `new RegExp` is a regex compile, not code-eval; an invalid pattern → false. */
function regexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * Evaluate a step `if` expression to a boolean. NEVER throws — a malformed or
 * unparseable expression resolves to `false` (the step is skipped), which is the
 * fail-safe default for an unattended run.
 */
export function evaluateCondition(expr: string, ctx: RunContext): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true; // empty `if` ⇒ always run (caller normally omits it)

  const parsed = parseExpr(trimmed);
  if (!parsed) return truthy(resolvePath(trimmed, ctx)); // bare path → truthiness

  const left = resolvePath(parsed.lhs, ctx);
  const right = parseLiteral(parsed.rhs);
  switch (parsed.op) {
    case '==':
      return looseEq(left, right);
    case '!=':
      return !looseEq(left, right);
    case 'contains':
      return String(left ?? '').includes(String(right));
    case 'matches':
      return regexTest(String(right), String(left ?? ''));
    default:
      return false;
  }
}
