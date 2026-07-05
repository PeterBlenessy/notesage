/**
 * Copilot LSP `$/progress` intermediate-progress events.
 *
 * The Rust handler (`copilot_protocol.rs`, `$/progress` → `kind: "report"`)
 * fans the LSP's report payload out into two Tauri events that were
 * previously unconsumed:
 *
 * - `copilot-chat-step` — progress steps (skill resolution, searching, …).
 *   Payload fields come from `steps[]` entries: `{ id, title, status }`.
 * - `copilot-chat-tool-update` — server-side agent-round tool calls
 *   (`editAgentRounds[].toolCalls[]`): `{ id, name, status, input, result,
 *   error, progressMessage }`.
 *
 * Field-shape note: the Rust side emits `step.get("id")` / `tc.get("id")`
 * etc. verbatim, so every field except `conversationId` / `turnId` may be
 * `null` or absent — the types below reflect that. The LSP re-emits the
 * full steps / toolCalls arrays on every report, so consumers must dedupe
 * by id and only react to actual changes.
 */

export interface CopilotStepPayload {
  conversationId?: string;
  turnId?: string;
  stepId?: string | null;
  title?: string | null;
  status?: string | null;
}

export interface CopilotToolUpdatePayload {
  conversationId?: string;
  turnId?: string;
  toolCallId?: string | null;
  name?: string | null;
  status?: string | null;
  input?: unknown;
  result?: unknown;
  error?: unknown;
  progressMessage?: string | null;
}

/**
 * Map a Copilot LSP step / tool-call status string onto the ToolCallSegment
 * status union. Unknown / absent statuses are treated as still running —
 * the turn's `finalizeSegments` sweep settles any stragglers.
 */
export function mapCopilotProgressStatus(
  status: string | null | undefined,
): 'running' | 'done' | 'error' {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'complete':
    case 'success':
    case 'succeeded':
      return 'done';
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'canceled':
      return 'error';
    default:
      return 'running';
  }
}

/** Best-effort string form of an unknown result/error value for a
 *  ToolResultSegment. Returns undefined for null/undefined/empty. */
export function stringifyProgressValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value || undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
