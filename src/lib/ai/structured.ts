import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AIProviderType } from './types';
import { streamEvent, newStreamId } from './stream-events';

/**
 * JSON Schema object passed to `generateStructured`. Kept as `Record<string, unknown>`
 * rather than a stricter type because callers may hand-build schemas or import
 * them from libraries (zod-to-json-schema, etc.) whose output shape we don't own.
 */
export type JsonSchema = Record<string, unknown>;

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateStructuredOptions<T = unknown> {
  schema: JsonSchema;
  /** Optional schema name surfaced to the model — defaults to `"response"`. */
  schemaName?: string;
  messages: ChatMessageInput[];
  provider: AIProviderType;
  connectionId?: string;
  ollamaUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  /**
   * Optional runtime type guard applied to the parsed model output. The
   * schema constraint is only token-level for `local_bundled` / compatible
   * providers — other providers may emit valid JSON of the wrong shape.
   * When provided and the guard fails, the promise rejects with a
   * descriptive error (same path as the invalid-JSON rejection).
   */
  validate?: (v: unknown) => v is T;
}

/**
 * Build the OpenAI-style `response_format` envelope. The Rust backend forwards
 * this verbatim to OpenAI-compatible servers and llama-server, and unwraps it
 * for Ollama's bare-schema `format` field (see `ollama_response_format`).
 */
export function buildJsonSchemaResponseFormat(
  schema: JsonSchema,
  name: string = 'response'
): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: { name, schema, strict: true },
  };
}

/**
 * Schema-constrained JSON generation. Wraps `ai_chat_stream` with a
 * `response_format` and collects the streamed text into a parsed object.
 *
 * Provider support: `local_bundled`, `openai_compatible`, and `ollama` enforce
 * the schema at the token level (GBNF/XGrammar — guaranteed valid output).
 * Other providers ignore the parameter; the call will succeed but the model
 * may emit invalid JSON — callers should fall back to retry or to a different
 * provider for those cases.
 */
export async function generateStructured<T = unknown>(
  options: GenerateStructuredOptions<T>
): Promise<T> {
  const responseFormat = buildJsonSchemaResponseFormat(options.schema, options.schemaName);

  // Unique per-call correlation id so a concurrent chat/agent stream can't leak
  // its chunks into `collected` (and vice-versa). See stream-events.ts.
  const streamId = newStreamId();

  let collected = '';
  let resolved = false;
  let resolve: (value: T) => void;
  let reject: (err: Error) => void;

  const done = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const unlistenChunk = await listen<string>(streamEvent('ai-stream-chunk', streamId), (event) => {
    collected += event.payload;
  });

  const unlistenDone = await listen(streamEvent('ai-stream-done', streamId), () => {
    if (resolved) return;
    resolved = true;
    try {
      const parsed: unknown = JSON.parse(collected);
      if (options.validate && !options.validate(parsed)) {
        reject(
          new Error(
            `Structured generation output failed validation against the expected shape. ` +
              `Raw output: ${collected.slice(0, 200)}`
          )
        );
        return;
      }
      // Documented cast site: without a caller-supplied validator we trust the
      // provider's schema constraint (GBNF/XGrammar for local providers).
      resolve(parsed as T);
    } catch (err) {
      reject(
        new Error(
          `Structured generation produced invalid JSON: ${err instanceof Error ? err.message : String(err)}. ` +
            `Raw output: ${collected.slice(0, 200)}`
        )
      );
    }
  });

  try {
    await invoke('ai_chat_stream', {
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      provider: options.provider,
      connectionId: options.connectionId ?? null,
      ollamaUrl: options.ollamaUrl ?? null,
      webSearchEnabled: false,
      tools: null,
      model: options.model ?? null,
      temperature: options.temperature ?? null,
      maxTokens: options.maxTokens ?? null,
      baseUrl: options.baseUrl ?? null,
      responseFormat,
      streamId,
    });
    return await done;
  } finally {
    unlistenChunk();
    unlistenDone();
  }
}
