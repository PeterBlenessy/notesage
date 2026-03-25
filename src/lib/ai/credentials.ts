import type { AIProviderType } from '@/lib/ai/types';
import type { Connection, ConnectionConfig } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Resolved credential bundle returned by the resolution helpers
// ---------------------------------------------------------------------------

export interface ResolvedCredentials {
  provider: AIProviderType;
  connectionId: string;
  ollamaUrl: string | undefined;
  config: ConnectionConfig | undefined;
}

// ---------------------------------------------------------------------------
// Credential resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve provider type, connection ID, Ollama URL, and config from a Connection.
 * Returns null for agent_managed connections (handled via ACP in callbacks).
 */
export function resolveConnectionCredentials(
  connection: Connection,
  useCaseModelOverride?: string,
): ResolvedCredentials | null {
  if (connection.authMethod === 'agent_managed') {
    return null;
  }

  const provider = connection.provider as AIProviderType;

  const config = connection.config ? { ...connection.config } : undefined;
  if (useCaseModelOverride) {
    if (config) {
      config.model = useCaseModelOverride;
    } else {
      return resolveWithConfig(provider, connection, { model: useCaseModelOverride });
    }
  }

  if (connection.credentials.type === 'api_key') {
    return { provider, connectionId: connection.id, ollamaUrl: undefined, config };
  }

  if (connection.credentials.type === 'local') {
    return { provider, connectionId: connection.id, ollamaUrl: connection.credentials.url, config };
  }

  if (connection.credentials.type === 'local_bundled') {
    return { provider: 'local_bundled' as AIProviderType, connectionId: connection.id, ollamaUrl: undefined, config };
  }

  return null;
}

export function resolveWithConfig(
  provider: AIProviderType,
  connection: Connection,
  configOverride: ConnectionConfig,
): ResolvedCredentials | null {
  const config = { ...connection.config, ...configOverride };
  if (connection.credentials.type === 'api_key') {
    return { provider, connectionId: connection.id, ollamaUrl: undefined, config };
  }
  if (connection.credentials.type === 'local') {
    return { provider, connectionId: connection.id, ollamaUrl: connection.credentials.url, config };
  }
  if (connection.credentials.type === 'local_bundled') {
    return { provider: 'local_bundled' as AIProviderType, connectionId: connection.id, ollamaUrl: undefined, config };
  }
  return null;
}
