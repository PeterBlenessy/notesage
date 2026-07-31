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
 * Coerce a raw stop reason to the closed telemetry enum.
 *
 * The backend value is a string, and a build newer than this one could emit a
 * variant we do not know. Reporting it verbatim would put an unbounded value
 * into the usage taxonomy, which the PII contract forbids — everything
 * unrecognised (including absent) collapses to `unknown`.
 */
export function toTelemetryStopReason(reason: string | null | undefined): AcpStopReason {
  switch (reason) {
    case 'end_turn':
    case 'max_tokens':
    case 'max_turn_requests':
    case 'refusal':
    case 'cancelled':
      return reason;
    default:
      return 'unknown';
  }
}

/**
 * Stop reasons the agent can simply be told to carry on from.
 *
 * `max_tokens` and `max_turn_requests` are budget limits: the agent still holds
 * its session, it just ran out of room in that turn, so a follow-up prompt
 * resumes the work. `refusal` is not resumable — the agent decided not to do it,
 * and re-asking is nagging. `cancelled` was the user's own decision.
 */
export function isResumableStop(reason: string | null | undefined): boolean {
  return reason === 'max_tokens' || reason === 'max_turn_requests';
}

/** The message sent when the user takes the offered continuation. */
export const CONTINUE_REPLY = 'Continue where you left off.';

/**
 * Render the notice as a markdown blockquote so it reads as meta-commentary
 * about the turn rather than as more model output.
 *
 * For a resumable stop the notice carries a `<quick-replies>` block, which the
 * existing chip UI renders as a one-click continuation — the agent keeps its
 * session, so the follow-up picks up the work rather than restarting it.
 * `TextSegmentView` strips the tag from the rendered text, so it never shows up
 * as literal markup.
 *
 * Deliberately NOT automatic: when the stop was caused by a genuinely exhausted
 * context rather than an output cap, continuing hits the same wall immediately,
 * and an unattended retry loop would burn the turn budget in a circle. A click
 * keeps a human in that decision.
 */
export function formatStopReasonNotice(reason: string | null | undefined): string | null {
  const description = describeStopReason(reason);
  if (description === null) return null;
  const notice = `\n\n> ⚠️ ${description}`;
  return isResumableStop(reason)
    ? `${notice}\n\n<quick-replies>\n${CONTINUE_REPLY}\n</quick-replies>`
    : notice;
}
