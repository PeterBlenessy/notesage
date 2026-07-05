// Estimated context usage for non-ACP connections (provider-usage-display #7).
//
// ACP agents report exact usage via `usage_update`; direct-API and local
// connections report nothing, so we estimate locally: `estimateMessagesTokens`
// (chars/4, the same heuristic the context trimmer uses) over the active
// thread plus the system prompt. Estimates can be off by ±30% for code-heavy
// content — the "≈" prefix and `confidence: 'estimated'` are load-bearing UI.

import { useEffect, useMemo } from 'react';
import type { Connection } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';
import { getThread } from '@/lib/chat-tree';
import { estimateMessagesTokens, estimateTokens } from '@/lib/ai/context-trim';
import { getContextSize } from '@/lib/ai/context-size';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useUsageStore } from '@/stores/usage-store';

export interface EstimatedContextUsage {
  contextUsed: number;
  contextSize: number;
}

/**
 * Estimate the active conversation's context usage against the connection's
 * context window. Returns `undefined` when the window size is unknown (the
 * no-denominator rule: never render an indicator against a guessed size) or
 * when there is nothing to estimate.
 *
 * Recomputed at message boundaries only — the memo keys on message COUNT and
 * the active leaf, deliberately not message content, so per-keystroke input
 * and per-chunk streaming never re-run the token walk.
 *
 * Successful estimates write through to the usage-store
 * (`source: 'estimate'`, `confidence: 'estimated'`) so the Settings surface
 * sees the same snapshot the indicator renders.
 */
export function useEstimatedContextUsage(
  conversation: Conversation | null | undefined,
  connection: Connection | null | undefined,
  systemPrompt?: string,
): EstimatedContextUsage | undefined {
  const messageCount = conversation?.messages.length ?? 0;
  const activeLeafId = conversation?.activeLeafId ?? null;
  // Subscribed (not getState) so a Settings-side context-length change
  // recomputes the local_bundled denominator.
  const localContextLength = useLocalAIStore((s) => s.contextLength);

  const estimate = useMemo<EstimatedContextUsage | undefined>(() => {
    if (!connection) return undefined;
    const contextSize = getContextSize(connection);
    if (!contextSize) return undefined;
    const thread = conversation
      ? getThread(conversation.messages, conversation.activeLeafId)
      : [];
    const contextUsed = estimateMessagesTokens(thread) + estimateTokens(systemPrompt);
    return { contextUsed, contextSize };
    // Message content is intentionally NOT a dependency — count + leaf mark the
    // message boundaries; streaming chunks mutate content without moving either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connection?.id,
    connection?.config?.model,
    conversation?.id,
    messageCount,
    activeLeafId,
    localContextLength,
    systemPrompt,
  ]);

  // Write-through depends ONLY on the connection id and the memoized estimate —
  // never the connection object, whose identity churns on unrelated
  // connections-store updates (e.g. a heartbeat status flip) and would
  // otherwise re-stamp `updatedAt` over unchanged numbers, making the Settings
  // "Estimated locally · just now" freshness label lie.
  const connectionId = connection?.id;
  useEffect(() => {
    if (!connectionId || !estimate) return;
    useUsageStore.getState().recordUsage(connectionId, {
      contextUsed: estimate.contextUsed,
      contextSize: estimate.contextSize,
      source: 'estimate',
      confidence: 'estimated',
    });
  }, [connectionId, estimate]);

  return estimate;
}
