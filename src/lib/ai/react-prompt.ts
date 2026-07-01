/**
 * ReAct-style tool-use guidance for local LLMs.
 *
 * Small/local models benefit dramatically from explicit step-by-step structure
 * around tool calls (the "Reason + Act" pattern). Without it, they tend to:
 *   - Call tools without first stating what they're trying to accomplish.
 *   - Retry the same failing call with no adjustment after an error.
 *   - Chain multiple speculative tool calls instead of one well-chosen one.
 *
 * Frontier cloud models already do this naturally, so this guidance is gated
 * to surfaces that target local models (currently `localSystemMessage` in
 * `useAIContext`, which feeds `local_bundled` chats only).
 *
 * For models with native thinking support (`supports_thinking: true` in the
 * catalog), the reasoning naturally lands inside `<think>` tags — Notesage's
 * streaming tag parser routes it to the thinking segment rather than the
 * visible response. For non-thinking models, the reasoning appears as short
 * visible text before each tool call, which is still useful as an audit trail.
 */
export const REACT_GUIDANCE = `Tool use protocol:
- Before each tool call: briefly state in one sentence what you need and why.
- After each result: briefly state what you learned before the next step.
- If a tool returns an error, reason about the cause and try a different approach — do not retry the same call with the same arguments.
- Prefer one well-chosen tool call over several speculative ones.`;

/**
 * Returns the ReAct addendum, or an empty string when it should not be
 * appended (e.g., tool calling is disabled — wasting tokens on guidance for a
 * feature the model can't use).
 */
export function buildReActAddendum(toolCallingEnabled: boolean): string {
  if (!toolCallingEnabled) return '';
  return REACT_GUIDANCE;
}
