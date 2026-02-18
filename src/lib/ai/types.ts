export type AIProviderType = 'anthropic' | 'openai' | 'ollama';

export interface Citation {
  url: string;
  title: string;
  citedText: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  citations?: Citation[];
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIProvider {
  name: AIProviderType;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
}
