import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';

export class AnthropicProvider implements AIProvider {
  name: 'anthropic' = 'anthropic';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || '';
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'anthropic',
          prompt,
          api_key: this.apiKey,
          ollama_url: null,
          stream: false,
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
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'anthropic',
        apiKey: this.apiKey,
        ollamaUrl: null,
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
