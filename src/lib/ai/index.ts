import type { AIProvider, AIProviderType } from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';

export * from './types';
export * from './connections';

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
