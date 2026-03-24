import type { AIProvider, AIProviderType } from './types';
import type { Connection, ConnectionConfig } from './connections';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { LocalProvider } from './providers/local';

export * from './types';
export * from './connections';

/**
 * Create an AIProvider from a Connection object.
 * Only supports api_key and local connections — agent_managed connections
 * route through ACP instead of the AIProvider interface.
 */
export function getAIProviderFromConnection(connection: Connection): AIProvider {
  if (connection.authMethod === 'agent_managed') {
    throw new Error(
      `Connection "${connection.label}" uses agent-managed auth. ` +
      'Use the ACP client instead of the direct API provider.'
    );
  }

  if (connection.credentials.type === 'api_key') {
    const provider = connection.provider as AIProviderType;
    return getAIProvider(provider, connection.id, undefined, connection.config);
  }

  if (connection.credentials.type === 'local') {
    return getAIProvider('ollama', undefined, connection.credentials.url, connection.config);
  }

  if (connection.credentials.type === 'local_bundled') {
    return new LocalProvider(connection.config);
  }

  throw new Error(`Unsupported credentials type for connection "${connection.label}"`);
}

/**
 * Create an AIProvider from loose parameters.
 * For api_key providers, connectionId is used to resolve the key from the OS keychain.
 */
export function getAIProvider(
  provider: AIProviderType,
  connectionId?: string,
  ollamaUrl?: string,
  config?: ConnectionConfig
): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(connectionId, config);
    case 'openai':
      return new OpenAIProvider(connectionId, config);
    case 'ollama':
      return new OllamaProvider(ollamaUrl, config);
    case 'openai_compatible':
      return new OpenAICompatibleProvider(connectionId, config);
    case 'local_bundled':
      return new LocalProvider(config);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
