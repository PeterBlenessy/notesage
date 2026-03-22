// Lazy import to avoid circular dependency
let _flagFreeAccount: ((connectionId: string) => void) | null = null;
function flagFreeAccount(connectionId: string) {
  if (!_flagFreeAccount) {
    import('@/stores/connections-store').then((mod) => {
      _flagFreeAccount = (id: string) =>
        mod.useConnectionsStore.getState().updateConnection(id, { freeAccount: true });
      _flagFreeAccount(connectionId);
    });
  } else {
    _flagFreeAccount(connectionId);
  }
}

/**
 * Extract a user-friendly error message from AI provider errors.
 * Provider backends return raw JSON error bodies — parse out the message field.
 * Includes provider name so the user knows which connection failed.
 *
 * If connectionId is provided, certain error patterns auto-flag the connection
 * (e.g., free account detection disables reasoning effort tiers).
 */
export function friendlyAIError(error: unknown, provider?: string, connectionId?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const prefix = provider ? `${provider}: ` : '';

  // Try to extract the nested JSON message from provider error strings
  // e.g. 'Anthropic API error: {"type":"error","error":{"type":"...","message":"Your credit balance..."}}'
  // e.g. ACP: 'Prompt failed: Internal error: {"codex_error_info":"other","message":"{\"detail\":\"...\"}"}'
  let msg = '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      msg = parsed?.error?.message || parsed?.message || '';

      // Handle doubly-escaped JSON in message field (ACP agents wrap provider errors)
      if (msg && msg.startsWith('{')) {
        try {
          const inner = JSON.parse(msg);
          msg = inner?.detail || inner?.message || inner?.error?.message || msg;
        } catch {
          // Not nested JSON, use as-is
        }
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  if (!msg) {
    // Strip common prefixes like "Anthropic API error: " or "Prompt failed: Internal error: "
    msg = raw
      .replace(/^(Anthropic|OpenAI|Ollama)\s+API\s+error:\s*/i, '')
      .replace(/^Prompt failed:\s*(Internal error:\s*)?/i, '')
      .trim();
  }

  const friendly = msg || 'Something went wrong. Please try again.';

  // Detect free account limitations and flag the connection
  if (connectionId && friendly.toLowerCase().includes('chatgpt account')) {
    flagFreeAccount(connectionId);
  }

  // Add actionable hints for common errors
  const hint = getErrorHint(friendly);
  return prefix + friendly + (hint ? `\n\n${hint}` : '');
}

/** Error patterns that indicate a dead or broken agent connection (retryable). */
const ACP_CONNECTION_ERROR_PATTERNS = [
  'query closed',
  'no longer running',
  'did not respond',
  'eof',
  'broken pipe',
  'no agent found',
  'process exited',
];

/**
 * Check if an error is a retryable ACP connection error (dead agent, broken pipe, etc.).
 */
export function isAcpConnectionError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ACP_CONNECTION_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

/**
 * Translate raw ACP errors into user-friendly messages.
 * Returns null if the error doesn't match any known ACP pattern (fall through to generic handling).
 */
export function friendlyAcpError(error: unknown, agentLabel?: string): string {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const agent = agentLabel || 'the agent';

  if (ACP_CONNECTION_ERROR_PATTERNS.some((p) => raw.includes(p))) {
    return `Lost connection to ${agent}. Please try again.`;
  }
  if (raw.includes('timed out') || raw.includes('timeout')) {
    return `${agent} is taking too long to respond. Please try again.`;
  }
  if (raw.includes('not found') && (raw.includes('binary') || raw.includes('spawn'))) {
    return `${agent} is not installed. Check Settings \u2192 Connections.`;
  }
  if (raw.includes('authenticat') || raw.includes('unauthorized') || raw.includes('auth')) {
    return `Authentication failed for ${agent}. Check Settings \u2192 Connections.`;
  }
  return `Something went wrong with ${agent}. Please try again.`;
}

/**
 * Return an actionable hint for common error patterns.
 */
function getErrorHint(message: string): string | null {
  const lower = message.toLowerCase();

  if (lower.includes('model is not supported') || lower.includes('model not found') || lower.includes('does not exist')) {
    return 'Tip: You can change the model in Settings → Connections → click the gear icon on this connection.';
  }

  if (lower.includes('credit balance') || lower.includes('insufficient') || lower.includes('billing')) {
    return 'Tip: Check your account billing status with the provider.';
  }

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Tip: Wait a moment and try again, or switch to a different provider.';
  }

  if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('401')) {
    return 'Tip: Re-check your credentials in Settings → Connections.';
  }

  return null;
}
