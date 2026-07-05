// Context-window size resolution for the estimated usage indicator
// (provider-usage-display #7).
//
// The ACP RFD's own guidance: no known size ⇒ no indicator. Never invent a
// denominator — an indicator against a guessed window is worse than none.

import type { Connection } from '@/lib/ai/connections';
import { DEFAULT_MODELS } from '@/lib/ai/constants';
import { useLocalAIStore } from '@/stores/local-ai-store';

/**
 * Per-model context-window sizes, longest-prefix-matched against the model id.
 * Deliberately small and conservative: entries exist only for the direct-API
 * providers we route (`anthropic`, `openai`). This map WILL drift as providers
 * ship new models — an unknown model resolves to `undefined`, which hides the
 * indicator (the designed fallback), so drift degrades gracefully.
 */
const MODEL_CONTEXT_SIZES: Array<[prefix: string, tokens: number]> = [
  // Anthropic — every current Claude model ships a 200K window (the 1M window
  // is an opt-in beta header Notesage doesn't send).
  ['claude-', 200_000],
  // OpenAI — order matters: longest/most-specific prefix first.
  ['gpt-4.1', 1_000_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['gpt-5', 400_000],
  ['o3', 200_000],
  ['o4', 200_000],
];

/** Resolve a model id to its context-window size, or `undefined` when unknown. */
export function resolveModelContextSize(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  for (const [prefix, size] of MODEL_CONTEXT_SIZES) {
    if (id.startsWith(prefix)) return size;
  }
  return undefined;
}

/**
 * Context-window size for a connection:
 * - `local_bundled` → the llama-server's configured `contextLength` (the one
 *   case where the size is exact, not a constant).
 * - direct-API `anthropic` / `openai` → the per-model constant map above,
 *   using `modelId ?? connection.config.model ?? provider default`.
 * - everything else (`ollama`, `openai_compatible`, ACP agents, Copilot LSP)
 *   → `undefined`. ACP agents report exact usage themselves; the rest have no
 *   trustworthy size source.
 */
export function getContextSize(connection: Connection, modelId?: string): number | undefined {
  if (connection.credentials.type === 'local_bundled') {
    const len = useLocalAIStore.getState().contextLength;
    return len > 0 ? len : undefined;
  }
  if (
    connection.credentials.type === 'api_key' &&
    (connection.provider === 'anthropic' || connection.provider === 'openai')
  ) {
    const model = modelId ?? connection.config?.model ?? DEFAULT_MODELS[connection.provider];
    return model ? resolveModelContextSize(model) : undefined;
  }
  return undefined;
}
