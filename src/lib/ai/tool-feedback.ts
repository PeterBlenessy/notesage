/**
 * Self-correction feedback for the tool execution loop.
 *
 * Two failure modes drove this module:
 *   1. Small local models retry the same failing call with the same arguments,
 *      eventually exhausting the 20-call-per-turn budget on the same wrong
 *      action. Wrapping the error with explicit reasoning guidance
 *      ("the call failed because X — reason about a different approach")
 *      reliably breaks the model out of the rut.
 *   2. When the same (tool, args) fails twice in a single turn, no amount of
 *      polite phrasing helps — the model needs a hard stop on that exact call
 *      shape, which `buildRepeatedFailureFeedback` provides.
 *
 * All three helpers are pure strings/booleans so they can be unit-tested
 * without spinning up the chat hook.
 */

/**
 * Stable key for "this call shape" — used to detect when the model repeats
 * the same tool with the same arguments. Argument order in JSON.stringify is
 * insertion order, which is stable for objects produced by the SSE
 * accumulator, so two semantically identical calls produce the same key.
 */
export function toolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(args ?? {})}`;
}

/**
 * Wrap a tool error result with ReAct-aligned reasoning guidance. The
 * original error stays in full — the wrapper only adds a directive on top so
 * the model still sees the underlying failure (path, permission, etc.) and
 * can use it to choose a different approach.
 */
export function wrapToolError(toolName: string, errorContent: string): string {
  return (
    `Tool '${toolName}' failed:\n${errorContent}\n\n` +
    `Before responding, reason about why this call failed and choose a ` +
    `different approach — do not retry the same call with the same arguments.`
  );
}

/**
 * Anti-loop directive when the same (tool, args) has already failed once in
 * this turn. Prepended to the wrapped error so the model sees the strong
 * stop signal first.
 */
export function buildRepeatedFailureFeedback(toolName: string): string {
  return (
    `You have already called '${toolName}' with these exact arguments and it ` +
    `failed. Do not call it again with the same arguments — either try ` +
    `different arguments, use a different tool, or respond with text ` +
    `acknowledging the limitation.`
  );
}

/**
 * Tracks per-turn tool-call history so the loop can detect repeat failures.
 * Constructed fresh for each turn (each call to `handleToolCalls`); never
 * shared across turns — a "retry" after the user sends a new message is a
 * legitimate fresh attempt and should not carry stale failure state.
 */
export class ToolCallHistory {
  private failures: Set<string> = new Set();

  /**
   * Returns true if the same (tool, args) shape has already errored in this
   * turn. Call BEFORE `record` so the feedback for the second-and-later call
   * can be escalated.
   */
  isRepeatedFailure(toolName: string, args: unknown): boolean {
    return this.failures.has(toolCallKey(toolName, args));
  }

  /** Record the outcome of a tool call. Only failures are remembered. */
  record(toolName: string, args: unknown, errored: boolean): void {
    if (errored) {
      this.failures.add(toolCallKey(toolName, args));
    }
  }
}

/**
 * Build the tool-result message body. Returns the wrapped error (with anti-
 * loop prefix when appropriate) on failure, or the raw success content
 * unchanged.
 *
 * Centralised so the wrap-vs-no-wrap decision lives in one place and the
 * useDirectApiChat tool loop stays focused on orchestration.
 */
export function buildToolResultContent(opts: {
  toolName: string;
  args: unknown;
  rawContent: string;
  isError: boolean;
  history: ToolCallHistory;
}): string {
  const { toolName, args, rawContent, isError, history } = opts;
  if (!isError) {
    history.record(toolName, args, false);
    return rawContent;
  }
  const repeated = history.isRepeatedFailure(toolName, args);
  history.record(toolName, args, true);
  const wrapped = wrapToolError(toolName, rawContent);
  if (repeated) {
    return `${buildRepeatedFailureFeedback(toolName)}\n\n${wrapped}`;
  }
  return wrapped;
}
