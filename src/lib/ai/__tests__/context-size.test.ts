// @vitest-environment jsdom
// Tests for the context-size resolver (provider-usage-display #7).
//
// The no-denominator rule: unknown model / provider ⇒ undefined ⇒ no
// indicator. Map drift degrades gracefully by design.

import "@/test/local-storage";
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveModelContextSize, getContextSize } from '../context-size';
import { useLocalAIStore } from '@/stores/local-ai-store';
import type { Connection } from '../connections';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-cs',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('resolveModelContextSize', () => {
  it('resolves Claude models to 200K via the family prefix', () => {
    expect(resolveModelContextSize('claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(resolveModelContextSize('claude-opus-4-6')).toBe(200_000);
  });

  it('resolves OpenAI models with longest-prefix precedence', () => {
    expect(resolveModelContextSize('gpt-4o')).toBe(128_000);
    expect(resolveModelContextSize('gpt-4o-mini')).toBe(128_000);
    expect(resolveModelContextSize('gpt-4.1')).toBe(1_000_000);
    expect(resolveModelContextSize('gpt-5')).toBe(400_000);
    expect(resolveModelContextSize('o3-mini')).toBe(200_000);
  });

  it('is case-insensitive', () => {
    expect(resolveModelContextSize('Claude-Sonnet-4-5')).toBe(200_000);
  });

  it('returns undefined for unknown models (no invented denominator)', () => {
    expect(resolveModelContextSize('mistral-large')).toBeUndefined();
    expect(resolveModelContextSize('')).toBeUndefined();
  });
});

describe('getContextSize', () => {
  beforeEach(() => {
    useLocalAIStore.setState({ contextLength: 4096 });
  });

  it('local_bundled → the configured llama-server context length', () => {
    const conn = makeConnection({
      provider: 'local_ai',
      authMethod: 'local_bundled',
      credentials: { type: 'local_bundled' },
    });
    expect(getContextSize(conn)).toBe(4096);

    useLocalAIStore.setState({ contextLength: 32768 });
    expect(getContextSize(conn)).toBe(32768);
  });

  it('local_bundled with no configured length → undefined', () => {
    useLocalAIStore.setState({ contextLength: 0 });
    const conn = makeConnection({
      provider: 'local_ai',
      authMethod: 'local_bundled',
      credentials: { type: 'local_bundled' },
    });
    expect(getContextSize(conn)).toBeUndefined();
  });

  it('anthropic api_key → per-model map, defaulting to the provider default model', () => {
    expect(getContextSize(makeConnection())).toBe(200_000); // default claude-sonnet-4-5-…
    expect(getContextSize(makeConnection({ config: { model: 'claude-opus-4-6' } }))).toBe(200_000);
  });

  it('openai api_key → per-model map; explicit modelId wins over config', () => {
    const conn = makeConnection({ provider: 'openai', config: { model: 'gpt-4o' } });
    expect(getContextSize(conn)).toBe(128_000);
    expect(getContextSize(conn, 'gpt-4.1')).toBe(1_000_000);
  });

  it('openai_compatible / ollama / ACP → undefined (no trustworthy size source)', () => {
    expect(
      getContextSize(makeConnection({ provider: 'openai_compatible', config: { model: 'gpt-4o' } })),
    ).toBeUndefined();
    expect(
      getContextSize(makeConnection({ provider: 'ollama', credentials: { type: 'local', url: 'http://localhost:11434' } })),
    ).toBeUndefined();
    expect(
      getContextSize(makeConnection({
        provider: 'anthropic',
        authMethod: 'agent_managed',
        credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      })),
    ).toBeUndefined();
  });

  it('unknown model on a mapped provider → undefined', () => {
    expect(getContextSize(makeConnection({ config: { model: 'claude' } }))).toBeUndefined();
    expect(getContextSize(makeConnection({ provider: 'openai', config: { model: 'davinci-002' } }))).toBeUndefined();
  });
});
