import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';
import type { ConnectionConfig } from '../connections';

export class LocalProvider implements AIProvider {
  name: 'local_bundled' = 'local_bundled' as never; // Cast to satisfy AIProviderType union
  private config?: ConnectionConfig;

  constructor(config?: ConnectionConfig) {
    this.config = config;
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'local_bundled',
          prompt,
          api_key: null,
          ollama_url: null,
          stream: false,
          model: null,
          temperature: this.config?.temperature ?? null,
          max_tokens: this.config?.maxTokens ?? null,
          base_url: null,
        },
      });
      return result;
    } catch (error) {
      console.error('Local AI generation failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to generate text with local AI'
      );
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'local_bundled',
        apiKey: null,
        ollamaUrl: null,
        model: null,
        temperature: this.config?.temperature ?? null,
        maxTokens: this.config?.maxTokens ?? null,
        baseUrl: null,
      });
      return result;
    } catch (error) {
      console.error('Local AI chat failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to chat with local AI'
      );
    }
  }
}
