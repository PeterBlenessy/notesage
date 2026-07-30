// ACP turn stop reasons — turning a silent early stop into a visible one.
//
// Every ACP turn ends with a `stopReason` (ACP spec: Prompt Turn / Stop
// Reasons). Only `end_turn` means the agent actually finished. The others mean
// it gave up partway: it exhausted its token budget, hit its per-turn request
// cap, or refused. Notesage used to discard this value at the Rust boundary, so
// an agent that abandoned a long multi-file task looked exactly like one that
// completed — the work just stopped, with no explanation anywhere in the UI.
//
// The ACP spec is explicit that at least `refusal` "should be reflected in the
// UI"; in practice the token/turn limits matter more, because those are what a
// local model with a small context window actually hits.

/** Stop reasons as they arrive over IPC (snake_case, mirroring the ACP schema). */
export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'unknown';

/**
 * A user-facing explanation for a turn that ended early, or `null` when no
 * notice is warranted.
 *
 * Returns `null` for:
 *  - `end_turn`  — the agent finished; nothing to explain.
 *  - `cancelled` — the user stopped it themselves, and the UI already reflects
 *                  that. Telling them what they just did is noise.
 *
 * Everything else returns a sentence explaining that the work is likely
 * incomplete, because the defining symptom of this bug was output that simply
 * stopped with no indication it was unfinished.
 */
export function describeStopReason(reason: string | null | undefined): string | null {
  // Absent is NOT the same as unrecognised. A missing value means the backend
  // told us nothing (an older build, or a test mock) — inventing "stopped for
  // reason: undefined" would be crying wolf. An unrecognised *string* is a real
  // reason we don't know yet, and that we do report below.
  if (reason === null || reason === undefined || reason === '') return null;
  switch (reason) {
    case 'end_turn':
    case 'cancelled':
      return null;
    case 'max_tokens':
      return 'The agent stopped before finishing — it ran out of tokens for this turn. Its work is likely incomplete; try a smaller scope, or raise the context size in Settings → Local AI.';
    case 'max_turn_requests':
      return 'The agent stopped before finishing — it hit the maximum number of steps allowed in a single turn. Its work is likely incomplete; try breaking the task into smaller requests.';
    case 'refusal':
      return 'The agent declined to continue with this request.';
    default:
      // `unknown` (an ACP variant newer than this build) and anything
      // unrecognised. Fail loud rather than silent: an unfamiliar reason is
      // still NOT a completed turn, and staying quiet is the exact bug this
      // module exists to prevent.
      return `The agent stopped before finishing (reason: ${reason}). Its work may be incomplete.`;
  }
}

/**
 * True when the turn ended for any reason other than running to completion.
 * An absent reason is not treated as an early stop — see `describeStopReason`.
 */
export function isEarlyStop(reason: string | null | undefined): boolean {
  if (reason === null || reason === undefined || reason === '') return false;
  return reason !== 'end_turn';
}

/**
 * Render the notice as a markdown blockquote so it reads as meta-commentary
 * about the turn rather than as more model output.
 */
export function formatStopReasonNotice(reason: string | null | undefined): string | null {
  const description = describeStopReason(reason);
  return description === null ? null : `\n\n> ⚠️ ${description}`;
}
