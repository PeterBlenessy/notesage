import { describe, it, expect } from 'vitest';
import {
  findLocalBundledFallback,
  resolveInteractiveConnection,
  isAgentHealthError,
} from '../local-agent-routing';
import type { Connection } from '../connections';

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'C',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive'],
    createdAt: 0,
    ...overrides,
  };
}

const preset = conn({
  id: 'preset',
  provider: 'custom_acp',
  label: 'Local Agent',
  credentials: { type: 'agent_managed', agentBinary: '/opt/goose' },
  config: { binaryPath: '/opt/goose', localAgentPreset: 'goose' },
});

const localBundled = conn({
  id: 'lb',
  provider: 'local_ai',
  authMethod: 'local_bundled',
  label: 'Local (bundled)',
  credentials: { type: 'local_bundled' },
});

const plainAgent = conn({ id: 'claude' });

describe('findLocalBundledFallback', () => {
  it('returns the first local_bundled connection', () => {
    expect(findLocalBundledFallback([preset, localBundled, plainAgent])?.id).toBe('lb');
  });
  it('returns null when there is no local_bundled connection', () => {
    expect(findLocalBundledFallback([preset, plainAgent])).toBeNull();
  });
});

describe('resolveInteractiveConnection', () => {
  const all = [preset, localBundled, plainAgent];

  it('returns a non-preset connection unchanged regardless of degraded state', () => {
    expect(resolveInteractiveConnection(plainAgent, all, true)?.id).toBe('claude');
    expect(resolveInteractiveConnection(plainAgent, all, false)?.id).toBe('claude');
  });

  it('returns the preset unchanged when it is healthy (not degraded)', () => {
    expect(resolveInteractiveConnection(preset, all, false)?.id).toBe('preset');
  });

  it('falls back to local_bundled when the preset is degraded', () => {
    expect(resolveInteractiveConnection(preset, all, true)?.id).toBe('lb');
  });

  it('keeps the preset when degraded but no local_bundled fallback exists (no dead-end pretense)', () => {
    expect(resolveInteractiveConnection(preset, [preset, plainAgent], true)?.id).toBe('preset');
  });

  it('passes null through', () => {
    expect(resolveInteractiveConnection(null, all, true)).toBeNull();
  });
});

describe('isAgentHealthError — fallback triggers', () => {
  it('flags binary-missing / not-executable errors', () => {
    expect(isAgentHealthError(new Error('binary not found at /opt/goose'))).toBe(true);
    expect(isAgentHealthError('not executable')).toBe(true);
  });
  it('flags spawn / start failures', () => {
    expect(isAgentHealthError(new Error('Agent spawn failed after multiple retries'))).toBe(true);
    expect(isAgentHealthError('failed to start')).toBe(true);
  });
  it('flags bundled-server-down errors', () => {
    expect(isAgentHealthError('Local AI server is not running')).toBe(true);
    expect(isAgentHealthError('port 8137 is not responding to /health')).toBe(true);
    expect(isAgentHealthError('ECONNREFUSED')).toBe(true);
  });
  it('does NOT flag ordinary turn errors', () => {
    expect(isAgentHealthError(new Error('model produced invalid tool call'))).toBe(false);
    expect(isAgentHealthError('rate limited')).toBe(false);
    expect(isAgentHealthError('context length exceeded')).toBe(false);
    expect(isAgentHealthError('the model returned an empty response')).toBe(false);
    expect(isAgentHealthError(undefined)).toBe(false);
    expect(isAgentHealthError(null)).toBe(false);
  });
  it('flags Node spawn-ENOENT binary-missing errors (bare "spawn" kept on purpose)', () => {
    // Regression lock for review Medium #4: narrowing `spawn` → `spawn failed`
    // would miss Node's child_process error shape and hide the degraded notice.
    expect(isAgentHealthError(new Error('spawn goose ENOENT'))).toBe(true);
    expect(isAgentHealthError('spawn /usr/local/bin/goose EACCES')).toBe(true);
  });
  it('reads .message off Error objects and stringifies non-Error throws', () => {
    expect(isAgentHealthError({ message: 'ECONNREFUSED 127.0.0.1:8137' })).toBe(true);
    expect(isAgentHealthError('Binary not found')).toBe(true);
  });
});
