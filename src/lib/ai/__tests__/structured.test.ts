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
import { streamEvent } from '@/lib/ai/stream-events';

/** Read the per-request streamId the production code threads into ai_chat_stream. */
const sidOf = (args: unknown): string =>
  String((args as { streamId?: string })?.streamId ?? '');

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
      const sid = sidOf(args);
      // Stream a complete JSON object across two chunks, then signal done.
      queueMicrotask(() => {
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '{"title":"Hello",');
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '"tags":["a","b"]}');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
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
    setMockInvokeHandler('ai_chat_stream', (args) => {
      const sid = sidOf(args);
      queueMicrotask(() => {
        emitMockEvent(streamEvent('ai-stream-chunk', sid), 'not actually json');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
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
      const sid = sidOf(args);
      queueMicrotask(() => {
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '{}');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
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

  // Regression lock for the stream-correlation fix (audit C1): a concurrent
  // generation's chunks — whether on the legacy global channel or under a
  // foreign streamId — must NOT leak into this call's collected buffer. Before
  // the fix, the global-channel noise corrupted `collected` and broke JSON.parse.
  it('ignores chunks from the global channel and other streams (correlation isolation)', async () => {
    setMockInvokeHandler('ai_chat_stream', (args) => {
      const sid = sidOf(args);
      queueMicrotask(() => {
        // Noise from a concurrent stream — must be ignored.
        emitMockEvent('ai-stream-chunk', 'GLOBAL_NOISE');
        emitMockEvent(streamEvent('ai-stream-chunk', 'some-other-stream'), 'FOREIGN_NOISE');
        // Our own correlated channel.
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '{"ok":true}');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
      });
    });

    const result = await generateStructured<{ ok: boolean }>({
      schema: { type: 'object' },
      messages: [{ role: 'user', content: 'hi' }],
      provider: 'local_bundled',
    });

    // If noise had leaked, `collected` would be
    // 'GLOBAL_NOISEFOREIGN_NOISE{"ok":true}' and JSON.parse would throw.
    expect(result).toEqual({ ok: true });
  });

  // Fix: `JSON.parse(collected) as T` trusted LLM output. An optional runtime
  // guard now validates the parsed shape at the trust boundary.
  it('resolves when the caller-supplied validator accepts the parsed output', async () => {
    setMockInvokeHandler('ai_chat_stream', (args) => {
      const sid = sidOf(args);
      queueMicrotask(() => {
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '{"title":"Hi"}');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
      });
    });

    const isTitled = (v: unknown): v is { title: string } =>
      typeof v === 'object' && v !== null && typeof (v as { title?: unknown }).title === 'string';

    const result = await generateStructured<{ title: string }>({
      schema: { type: 'object' },
      messages: [{ role: 'user', content: 'hi' }],
      provider: 'local_bundled',
      validate: isTitled,
    });
    expect(result).toEqual({ title: 'Hi' });
  });

  it('rejects with a descriptive error when output is valid JSON of the wrong shape', async () => {
    setMockInvokeHandler('ai_chat_stream', (args) => {
      const sid = sidOf(args);
      queueMicrotask(() => {
        // Valid JSON, but not the shape the caller expects.
        emitMockEvent(streamEvent('ai-stream-chunk', sid), '{"totally":"different"}');
        emitMockEvent(streamEvent('ai-stream-done', sid), undefined);
      });
    });

    const isTitled = (v: unknown): v is { title: string } =>
      typeof v === 'object' && v !== null && typeof (v as { title?: unknown }).title === 'string';

    await expect(
      generateStructured<{ title: string }>({
        schema: { type: 'object' },
        messages: [{ role: 'user', content: 'hi' }],
        provider: 'local_bundled',
        validate: isTitled,
      })
    ).rejects.toThrow(/failed validation/);
  });
});
