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

// ---------------------------------------------------------------------------
// Provider name formatting
// ---------------------------------------------------------------------------

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
  local: 'Local AI',
  local_bundled: 'Local AI',
  openai_compatible: 'OpenAI-compatible provider',
};

/**
 * Capitalize a provider identifier into a user-facing display name.
 * Known providers get their canonical casing; unknown names are title-cased.
 */
function formatProviderName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

// ---------------------------------------------------------------------------
// Error pattern → friendly message mapping
// ---------------------------------------------------------------------------

interface ErrorMapping {
  /** Patterns to test against the lowercased error string (any match triggers). */
  patterns: RegExp[];
  /** Template function producing the user-friendly message. */
  message: (provider: string) => string;
  /** Whether to suggest opening Settings → Connections. */
  settingsHint: boolean;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    patterns: [/connection\s*refused/, /econnrefused/, /connect\s+econnrefused/],
    message: (p) => `Could not reach ${p}. Check that the service is running.`,
    settingsHint: true,
  },
  {
    patterns: [/\b401\b/, /\bunauthorized\b/, /invalid.{0,10}key/, /invalid.{0,10}api.{0,5}key/, /authentication\s+failed/],
    message: (p) => `Invalid API key for ${p}. Check your settings.`,
    settingsHint: true,
  },
  {
    patterns: [/\b429\b/, /rate.{0,5}limit/, /too\s+many\s+requests/],
    message: (p) => `Rate limited by ${p}. Try again in a moment.`,
    settingsHint: false,
  },
  {
    patterns: [/\btimeout\b/, /etimedout/, /timed?\s*out/, /request\s+timed?\s*out/],
    message: (p) => `Request to ${p} timed out. Check your connection.`,
    settingsHint: false,
  },
  {
    patterns: [/\b50[0-3]\b/, /internal\s+server\s+error/, /bad\s+gateway/, /service\s+unavailable/],
    message: (p) => `${p} returned a server error. Try again later.`,
    settingsHint: false,
  },
  {
    patterns: [/\b403\b/, /\bforbidden\b/],
    message: (p) => `Access denied by ${p}. Check your API key permissions.`,
    settingsHint: true,
  },
  {
    patterns: [/\b404\b.*model/, /model.*not\s+found/, /model.*does\s+not\s+exist/],
    message: (p) => `Model not found on ${p}. Check your model selection in settings.`,
    settingsHint: true,
  },
];

/**
 * Map common AI error patterns to user-friendly messages.
 *
 * Checks the raw error string against known HTTP status codes, network errors,
 * and provider-specific patterns. Returns a clean message with the provider
 * name formatted nicely, or `null` if no pattern matches (caller should
 * fall back to other formatting).
 *
 * Pure function — no side effects.
 */
export function mapAIError(error: string, provider: string): string | null {
  const lower = error.toLowerCase();
  const displayName = formatProviderName(provider);

  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.patterns.some((re) => re.test(lower))) {
      const msg = mapping.message(displayName);
      if (mapping.settingsHint) {
        return `${msg}\n\nOpen Settings → Connections to update your configuration.`;
      }
      return msg;
    }
  }

  return null;
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

  // First, try pattern-based mapping for common HTTP/network errors.
  // This catches errors before JSON parsing, so "connection refused" and
  // status code errors get clean messages even if wrapped in JSON.
  if (provider) {
    const mapped = mapAIError(raw, provider);
    if (mapped) {
      // Still run free account detection
      if (connectionId && raw.toLowerCase().includes('chatgpt account')) {
        flagFreeAccount(connectionId);
      }
      return mapped;
    }
  }

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
          // Expected: message field is not nested JSON — use as-is
        }
      }
    } catch {
      // Expected: error string may not contain valid JSON — fall through to string cleanup
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

  // After JSON extraction, try pattern mapping on the extracted message too
  if (provider) {
    const mapped = mapAIError(friendly, provider);
    if (mapped) {
      if (connectionId && friendly.toLowerCase().includes('chatgpt account')) {
        flagFreeAccount(connectionId);
      }
      return mapped;
    }
  }

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
