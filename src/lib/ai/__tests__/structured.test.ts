// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildJsonSchemaResponseFormat,
  generateStructured,
} from '@/lib/ai/structured';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  emitMockEvent,
} from '@/test/tauri-mock';

describe('buildJsonSchemaResponseFormat', () => {
  it('wraps a schema in the OpenAI envelope', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    expect(buildJsonSchemaResponseFormat(schema)).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema, strict: true },
    });
  });

  it('respects a custom schema name', () => {
    const schema = { type: 'object' };
    expect(buildJsonSchemaResponseFormat(schema, 'Note')).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Note', schema, strict: true },
    });
  });
});

describe('generateStructured', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
  });

  it('forwards the response_format envelope and parses the streamed JSON', async () => {
    let received: Record<string, unknown> | undefined;
    setMockInvokeHandler('ai_chat_stream', (args) => {
      received = args as Record<string, unknown>;
      // Stream a complete JSON object across two chunks, then signal done.
      queueMicrotask(() => {
        emitMockEvent('ai-stream-chunk', '{"title":"Hello",');
        emitMockEvent('ai-stream-chunk', '"tags":["a","b"]}');
        emitMockEvent('ai-stream-done', undefined);
      });
    });

    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'tags'],
    };

    const result = await generateStructured<{ title: string; tags: string[] }>({
      schema,
      messages: [{ role: 'user', content: 'pick a note title' }],
      provider: 'local_bundled',
    });

    expect(result).toEqual({ title: 'Hello', tags: ['a', 'b'] });
    expect(received?.responseFormat).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema, strict: true },
    });
    expect(received?.tools).toBeNull();
    expect(received?.provider).toBe('local_bundled');
  });

  it('rejects when the streamed output is not valid JSON', async () => {
    setMockInvokeHandler('ai_chat_stream', () => {
      queueMicrotask(() => {
        emitMockEvent('ai-stream-chunk', 'not actually json');
        emitMockEvent('ai-stream-done', undefined);
      });
    });

    await expect(
      generateStructured({
        schema: { type: 'object' },
        messages: [{ role: 'user', content: 'hi' }],
        provider: 'local_bundled',
      })
    ).rejects.toThrow(/invalid JSON/);
  });

  it('passes provider routing parameters through', async () => {
    let received: Record<string, unknown> | undefined;
    setMockInvokeHandler('ai_chat_stream', (args) => {
      received = args as Record<string, unknown>;
      queueMicrotask(() => {
        emitMockEvent('ai-stream-chunk', '{}');
        emitMockEvent('ai-stream-done', undefined);
      });
    });

    await generateStructured({
      schema: { type: 'object' },
      messages: [{ role: 'user', content: 'hi' }],
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      model: 'qwen3:4b',
      temperature: 0,
      baseUrl: 'http://localhost:11434',
    });

    expect(received?.ollamaUrl).toBe('http://localhost:11434');
    expect(received?.model).toBe('qwen3:4b');
    expect(received?.temperature).toBe(0);
    expect(received?.baseUrl).toBe('http://localhost:11434');
  });
});
