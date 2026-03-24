import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';
import type { ConnectionConfig } from '../connections';

export class AnthropicProvider implements AIProvider {
  name: 'anthropic' = 'anthropic';
  private connectionId: string;
  private config?: ConnectionConfig;

  constructor(connectionId?: string, config?: ConnectionConfig) {
    this.connectionId = connectionId || '';
    this.config = config;
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    if (!this.connectionId) {
      throw new Error('Anthropic connection ID is required');
    }

    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'anthropic',
          prompt,
          api_key: null,
          connection_id: this.connectionId,
          ollama_url: null,
          stream: false,
          model: this.config?.model ?? null,
          temperature: this.config?.temperature ?? null,
          max_tokens: this.config?.maxTokens ?? null,
          base_url: this.config?.baseUrl ?? null,
        },
      });

      return result;
    } catch (error) {
      console.error('Anthropic generation failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to generate text with Anthropic'
      );
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.connectionId) {
      throw new Error('Anthropic connection ID is required');
    }

    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'anthropic',
        connectionId: this.connectionId,
        ollamaUrl: null,
        model: this.config?.model ?? null,
        temperature: this.config?.temperature ?? null,
        maxTokens: this.config?.maxTokens ?? null,
        baseUrl: this.config?.baseUrl ?? null,
      });

      return result;
    } catch (error) {
      console.error('Anthropic chat failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to chat with Anthropic'
      );
    }
  }
}
