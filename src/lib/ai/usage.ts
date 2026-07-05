// Provider usage types + defensive `_meta` parser registry.
// PRD: docs/prds/2026-07-05-provider-usage-display.md
//
// Hard constraints (user decision, do not relax):
// - All data comes from ACP events or local estimation — never from third-party
//   credential files or provider endpoints, and never via polling.
// - `_meta` is non-contractual by ACP spec ("implementations MUST NOT make
//   assumptions") — the parser must survive arbitrary payloads and never throw.

export type UsageConfidence = 'exact' | 'estimated';

export interface ProviderRateLimitInfo {
  /** e.g. "allowed_warning" */
  status?: string;
  /** e.g. "five_hour", "seven_day" */
  rateLimitType?: string;
  /** Unix seconds */
  resetsAt?: number;
  /** 0-100, present only near thresholds (Claude) */
  utilization?: number;
  /** Original `_meta` payload for the detail view */
  raw?: unknown;
}

export interface TurnUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface ProviderUsageSnapshot {
  connectionId: string;
  contextUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string };
  rateLimit?: ProviderRateLimitInfo;
  lastTurnUsage?: TurnUsage;
  confidence: UsageConfidence;
  source: 'acp' | 'estimate';
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// `_meta` parser registry
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse the Claude Code rate-limit payload forwarded by claude-code-acp:
 * `{ status, resetsAt, rateLimitType, utilization? }`. Every field is optional
 * and type-validated individually; snake_case variants are tolerated (custom
 * agents re-serialize with varying conventions elsewhere in the codebase).
 * Returns `undefined` when no recognizable field survives validation — a
 * rate-limit row with zero known fields would be meaningless.
 */
function parseClaudeRateLimit(payload: unknown): ProviderRateLimitInfo | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const p = payload as Record<string, unknown>;
  const info: ProviderRateLimitInfo = {};
  const status = asString(p.status);
  if (status !== undefined) info.status = status;
  const rateLimitType = asString(p.rateLimitType) ?? asString(p.rate_limit_type);
  if (rateLimitType !== undefined) info.rateLimitType = rateLimitType;
  const resetsAt = asFiniteNumber(p.resetsAt) ?? asFiniteNumber(p.resets_at);
  if (resetsAt !== undefined) info.resetsAt = resetsAt;
  const utilization = asFiniteNumber(p.utilization);
  if (utilization !== undefined) info.utilization = utilization;
  if (Object.keys(info).length === 0) return undefined;
  info.raw = payload;
  return info;
}

/**
 * Keyed registry of known `_meta` rate-limit payloads. Adding a provider is a
 * one-entry addition (Phase 3: `"_codex/rateLimits"` once the upstream
 * codex-acp PR forwarding `RateLimitSnapshot` lands). Entries are tried in
 * order; the first key present in `_meta` that parses to something wins.
 */
const RATE_LIMIT_META_PARSERS: Array<{
  key: string;
  parse: (payload: unknown) => ProviderRateLimitInfo | undefined;
}> = [
  { key: '_claude/rateLimit', parse: parseClaudeRateLimit },
];

/**
 * Validate an `acp-turn-usage` event payload's `usage` field against
 * {@link TurnUsage}. The Rust side serializes the ACP schema's `Usage` struct
 * (camelCase), but the upstream field is UNSTABLE — validate every field and
 * return `undefined` on any shape surprise rather than trusting the wire.
 * The three required totals must all be finite numbers; the optional
 * breakdowns are kept only when individually valid.
 */
export function parseTurnUsage(value: unknown): TurnUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const totalTokens = asFiniteNumber(v.totalTokens);
  const inputTokens = asFiniteNumber(v.inputTokens);
  const outputTokens = asFiniteNumber(v.outputTokens);
  if (totalTokens === undefined || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  const usage: TurnUsage = { totalTokens, inputTokens, outputTokens };
  const thoughtTokens = asFiniteNumber(v.thoughtTokens);
  if (thoughtTokens !== undefined) usage.thoughtTokens = thoughtTokens;
  const cachedReadTokens = asFiniteNumber(v.cachedReadTokens);
  if (cachedReadTokens !== undefined) usage.cachedReadTokens = cachedReadTokens;
  const cachedWriteTokens = asFiniteNumber(v.cachedWriteTokens);
  if (cachedWriteTokens !== undefined) usage.cachedWriteTokens = cachedWriteTokens;
  return usage;
}

/**
 * Extract rate-limit info from a `usage_update._meta` payload. Strictly
 * best-effort: unknown keys, malformed values, and non-object input all yield
 * `undefined` (or a partial with only the valid fields) — never a throw.
 */
export function parseUsageMeta(meta: unknown): ProviderRateLimitInfo | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const record = meta as Record<string, unknown>;
  for (const { key, parse } of RATE_LIMIT_META_PARSERS) {
    if (key in record) {
      const parsed = parse(record[key]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}
