/**
 * Extract a user-friendly error message from AI provider errors.
 * Provider backends return raw JSON error bodies — parse out the message field.
 * Includes provider name so the user knows which connection failed.
 */
export function friendlyAIError(error: unknown, provider?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const prefix = provider ? `${provider}: ` : '';

  // Try to extract the nested JSON message from provider error strings
  // e.g. 'Anthropic API error: {"type":"error","error":{"type":"...","message":"Your credit balance..."}}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const msg = parsed?.error?.message || parsed?.message;
      if (msg) return prefix + msg;
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Strip common prefixes like "Anthropic API error: " or "OpenAI API error: "
  const stripped = raw.replace(/^(Anthropic|OpenAI|Ollama)\s+API\s+error:\s*/i, '').trim();
  return prefix + (stripped || 'Something went wrong. Please try again.');
}
