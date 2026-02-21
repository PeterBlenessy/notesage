import type { AIProvider, AIProviderType } from './types';
import type { Connection } from './connections';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';

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
    return getAIProvider(provider, connection.credentials.key);
  }

  if (connection.credentials.type === 'local') {
    return getAIProvider('ollama', undefined, connection.credentials.url);
  }

  throw new Error(`Unsupported credentials type for connection "${connection.label}"`);
}

/**
 * Create an AIProvider from loose parameters.
 * @deprecated Use getAIProviderFromConnection() with a Connection object instead.
 */
export function getAIProvider(
  provider: AIProviderType,
  apiKey?: string,
  ollamaUrl?: string
): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'ollama':
      return new OllamaProvider(ollamaUrl);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
