import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';

export class OpenAIProvider implements AIProvider {
  name: 'openai' = 'openai';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || '';
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'openai',
          prompt,
          api_key: this.apiKey,
          ollama_url: null,
          stream: false,
        },
      });

      return result;
    } catch (error) {
      console.error('OpenAI generation failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to generate text with OpenAI'
      );
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'openai',
        apiKey: this.apiKey,
        ollamaUrl: null,
      });

      return result;
    } catch (error) {
      console.error('OpenAI chat failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to chat with OpenAI'
      );
    }
  }
}
