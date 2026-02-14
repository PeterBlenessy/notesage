import { invoke } from '@tauri-apps/api/core';
import type { AIProvider, ChatMessage, GenerateOptions } from '../types';

export class OllamaProvider implements AIProvider {
  name: 'ollama' = 'ollama';
  private ollamaUrl: string;

  constructor(ollamaUrl?: string) {
    this.ollamaUrl = ollamaUrl || 'http://localhost:11434';
  }

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    try {
      const result = await invoke<string>('ai_generate_text', {
        request: {
          provider: 'ollama',
          prompt,
          api_key: null,
          ollama_url: this.ollamaUrl,
          stream: false,
        },
      });

      return result;
    } catch (error) {
      console.error('Ollama generation failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to generate text with Ollama'
      );
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    try {
      const result = await invoke<string>('ai_chat', {
        messages,
        provider: 'ollama',
        apiKey: null,
        ollamaUrl: this.ollamaUrl,
      });

      return result;
    } catch (error) {
      console.error('Ollama chat failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to chat with Ollama'
      );
    }
  }
}
