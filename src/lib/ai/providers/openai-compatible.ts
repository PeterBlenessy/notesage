import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';
import type { ConnectionConfig } from '../connections';

export class OpenAICompatibleProvider implements AIProvider {
  name: 'openai_compatible' = 'openai_compatible';
  private apiKey: string;
  private config?: ConnectionConfig;

  constructor(apiKey?: string, config?: ConnectionConfig) {
    this.apiKey = apiKey || '';
    this.config = config;
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }
    if (!this.config?.baseUrl) {
      throw new Error('Base URL is required for OpenAI-Compatible provider');
    }

    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'openai_compatible',
          prompt,
          api_key: this.apiKey,
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
      console.error('OpenAI-Compatible generation failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to generate text'
      );
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }
    if (!this.config?.baseUrl) {
      throw new Error('Base URL is required for OpenAI-Compatible provider');
    }

    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'openai_compatible',
        apiKey: this.apiKey,
        ollamaUrl: null,
        model: this.config?.model ?? null,
        temperature: this.config?.temperature ?? null,
        maxTokens: this.config?.maxTokens ?? null,
        baseUrl: this.config?.baseUrl ?? null,
      });

      return result;
    } catch (error) {
      console.error('OpenAI-Compatible chat failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to chat'
      );
    }
  }
}
