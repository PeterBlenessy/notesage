/**
 * Sliding-window context trimming for local LLM chats.
 *
 * Local models max out at 4K–32K context; a 10-turn agent session with tool
 * calls (each round = user + assistant + N tool_call + N tool_result) blows
 * the budget quickly. Without trimming, the server returns a truncation
 * error or silently drops the oldest content in a way that breaks the
 * tool_calls/tool_result pairing invariant.
 *
 * Strategy: drop the oldest complete rounds until the remainder fits the
 * budget. A "round" starts at a user message and runs through every
 * assistant/tool message before the next user message. Dropping by round
 * preserves two invariants the API requires:
 *   1. The system message stays at index 0.
 *   2. Every `tool_calls` assistant message stays with its matching
 *      `tool_call_id` response messages.
 *
 * Token counting is approximate (`chars / 4`) — exact counts would require
 * the model's tokenizer, which we don't have client-side. The approximation
 * over-counts for code-heavy text and under-counts for compact languages,
 * but is correct on average and matches the heuristic OpenAI / Anthropic
 * recommend for client-side estimation. We add a conservative 2000-token
 * budget per image attachment — vision models use ~1500 regardless of the
 * underlying base64 size.
 */
import type { ChatMessage } from './types';

const CHARS_PER_TOKEN = 4;
const TOKENS_PER_IMAGE = 2000;

export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = estimateTokens(msg.content);
  if (msg.toolCalls?.length) {
    // tool_calls serialize as JSON in the API payload; size matters.
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(tc.name);
      tokens += estimateTokens(JSON.stringify(tc.arguments ?? {}));
    }
  }
  if (msg.toolCallId) tokens += estimateTokens(msg.toolCallId);
  if (msg.attachments?.length) tokens += msg.attachments.length * TOKENS_PER_IMAGE;
  // 4-token per-message overhead from the chat-template wrapper
  // (role marker, separator). Matches the OpenAI cookbook heuristic.
  return tokens + 4;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

export interface TrimResult {
  messages: ChatMessage[];
  /** Tokens after trimming. */
  estimatedTokens: number;
  /** Number of messages dropped (0 when no trim was needed). */
  dropped: number;
}

/**
 * Trim a message list down to fit `budgetTokens`. Returns the original list
 * unchanged when it already fits. Always preserves the leading system
 * message (if present) and the final user message + everything after it.
 *
 * If the budget is so tight that even the final round doesn't fit, we
 * return that final round anyway — letting the API reject it is more
 * useful than silently dropping the user's most recent prompt.
 */
export function trimMessagesToBudget(
  messages: ChatMessage[],
  budgetTokens: number
): TrimResult {
  const total = estimateMessagesTokens(messages);
  if (total <= budgetTokens || messages.length === 0) {
    return { messages, estimatedTokens: total, dropped: 0 };
  }

  // Split off the leading system message — it's always preserved.
  const hasSystem = messages[0]?.role === 'system';
  const system = hasSystem ? messages[0] : null;
  let rest = hasSystem ? messages.slice(1) : messages.slice();

  // Drop oldest complete rounds until we fit. A round boundary is a user
  // message. Always keep at least the last user message + everything after.
  const fits = () => {
    const all = system ? [system, ...rest] : rest;
    return estimateMessagesTokens(all) <= budgetTokens;
  };

  while (!fits() && rest.length > 1) {
    // Find the next user message at index ≥ 1 (i.e., not the first message
    // in `rest`, which we're about to drop with everything before the next
    // user boundary). When no later user message exists, we've collapsed
    // down to the final round — stop.
    const nextUserIdx = rest.slice(1).findIndex((m) => m.role === 'user');
    if (nextUserIdx === -1) break;
    // findIndex returned an offset relative to slice(1), so +1 gets the
    // real index in `rest`.
    rest = rest.slice(nextUserIdx + 1);
  }

  const trimmed = system ? [system, ...rest] : rest;
  const dropped = messages.length - trimmed.length;
  return {
    messages: trimmed,
    estimatedTokens: estimateMessagesTokens(trimmed),
    dropped,
  };
}

/**
 * Compute the trim budget for the local_bundled provider. Reserves 25% of
 * the server's configured context_length for the model's response — without
 * this headroom, the model has no room to actually answer.
 */
export function localBundledTrimBudget(contextLength: number): number {
  return Math.floor(contextLength * 0.75);
}
