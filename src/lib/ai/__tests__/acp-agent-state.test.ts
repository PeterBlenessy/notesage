import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import type { Connection } from '../connections';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Test Agent',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function setupDefaultHandlers(): void {
  setMockInvokeHandler('acp_agent_stop', () => undefined);
  setMockInvokeHandler('acp_agent_exists', () => true);
  setMockInvokeHandler('acp_agent_authenticate', () => {
    throw new Error('not implemented');
  });
}

describe('ensureAcpAgent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('spawns agent and returns instance ID on first call', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-a' });
    const result = await mod.ensureAcpAgent(connection, '/tmp');

    expect(result).toBe('inst-1');
    expect(mod.acpAgent).not.toBeNull();
    expect(mod.acpAgent!.connectionId).toBe('conn-a');
  });

  it('reuses existing agent when connection matches', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-a' });
    const result1 = await mod.ensureAcpAgent(connection, '/tmp');
    const result2 = await mod.ensureAcpAgent(connection, '/tmp');

    expect(result1).toBe('inst-1');
    expect(result2).toBe('inst-1');
    expect(spawnCount).toBe(1);
  });

  it('respawns when connection changes', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connA = makeConnection({ id: 'conn-a' });
    const connB = makeConnection({ id: 'conn-b' });

    await mod.ensureAcpAgent(connA, '/tmp');
    const result = await mod.ensureAcpAgent(connB, '/tmp');

    expect(result).toBe('inst-2');
    expect(spawnCount).toBe(2);
    expect(mod.acpAgent!.connectionId).toBe('conn-b');
  });

  it('clears sessionInfo when respawning for a connection change (command-bar-freshness invariant)', async () => {
    // Regression lock for the command bar UX bug on 2026-04-19: stale modes
    // and currentModeId from the previous agent were bleeding across to the
    // new agent because ensureAcpAgent stopped the backend but never cleared
    // the module-level sessionInfo. Fixing it makes the picker's "currently
    // selected" fallback chain (live sessionInfo → connection.acpDefaults →
    // first available) produce correct output immediately on switch.
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();
    mod.clearSessionInfo();

    // Seed session state as if the previous agent had a live session.
    mod.setSessionModes({
      currentModeId: 'acceptEdits',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'acceptEdits', name: 'Accept Edits' },
      ],
    });
    mod.setSessionConfigOptions([
      { id: 'reasoning_effort', name: 'Reasoning Effort', category: 'thought_level', currentValue: 'high' },
    ]);
    mod.updateUsage({
      contextUsed: 4200,
      contextSize: 200_000,
      rateLimit: { status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: 1_751_700_000 },
    });
    expect(mod.getSessionInfo().modes?.currentModeId).toBe('acceptEdits');
    expect(mod.getSessionInfo().configOptions?.length).toBe(1);
    expect(mod.getSessionInfo().usage?.rateLimit?.status).toBe('allowed_warning');

    const connA = makeConnection({ id: 'conn-a' });
    const connB = makeConnection({ id: 'conn-b' });

    await mod.ensureAcpAgent(connA, '/tmp');
    // Same-connection reuse should NOT clear sessionInfo.
    await mod.ensureAcpAgent(connA, '/tmp');
    expect(mod.getSessionInfo().modes?.currentModeId).toBe('acceptEdits');

    // Connection change MUST clear sessionInfo so stale modes/configOptions
    // from the prior agent don't leak into the new agent's command bar —
    // including usage with its rate-limit state (provider-usage-display #3:
    // a stale rate-limit warning from the previous provider is worse than none).
    await mod.ensureAcpAgent(connB, '/tmp');
    expect(mod.getSessionInfo().modes).toBeNull();
    expect(mod.getSessionInfo().configOptions).toBeNull();
    expect(mod.getSessionInfo().usage).toBeNull();
  });

  it('agent stop clears usage including rate-limit state (provider-usage-display #3)', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({ instance_id: 'inst-usage' }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();
    await mod.ensureAcpAgent(makeConnection(), '/tmp');

    mod.updateUsage({
      contextUsed: 1000,
      contextSize: 200_000,
      cost: { amount: 0.42, currency: 'USD' },
      rateLimit: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 91 },
    });
    expect(mod.getSessionInfo().usage?.rateLimit?.utilization).toBe(91);
    expect(mod.getSessionInfo().usage?.cost?.amount).toBe(0.42);

    mod.stopAcpAgent();

    expect(mod.getSessionInfo().usage).toBeNull();
  });

  it('throws after exceeding max retry depth instead of infinite recursion', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-1',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    // ensureAcpAgent carries its recursion depth in the trailing opts bag.
    // Calling with depth > MAX_RETRIES (3) should throw immediately.
    await expect(
      mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'test', { depth: 4 }),
    ).rejects.toThrow('Agent spawn failed after multiple retries');
  });

  it('allows normal recursion within the depth limit', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-ok',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    // Calling with depth=0 (default) should work fine
    const result = await mod.ensureAcpAgent(makeConnection(), '/tmp', undefined, 'test', { depth: 0 });
    expect(result).toBe('inst-ok');
  });

  it('binary not found → graceful error, acpAgent remains null', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => {
      throw new Error('Binary not found');
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await expect(
      mod.ensureAcpAgent(makeConnection(), '/tmp'),
    ).rejects.toThrow('Binary not found');

    expect(mod.acpAgent).toBeNull();
  });

  it('authentication "not implemented" is silently handled', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-auth-skip',
    }));
    // setupDefaultHandlers already sets authenticate to throw "not implemented",
    // but set it explicitly for clarity
    setMockInvokeHandler('acp_agent_authenticate', () => {
      throw new Error('not implemented');
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const result = await mod.ensureAcpAgent(makeConnection(), '/tmp');
    expect(result).toBe('inst-auth-skip');
    expect(mod.acpAgent).not.toBeNull();
  });

  it('propagates a preset endpoint resolution failure to the caller (no silent fallback)', async () => {
    // User decision: a broken Local Agent must surface a proper error in the
    // chat message, NOT be swallowed into a degraded flag + Path-4 fallback.
    // When the bundled server is down, resolveLocalAgentEndpoint throws and that
    // throw must reach the caller so the send path can render the real failure.
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({ instance_id: 'inst-x' }));
    setMockInvokeHandler('local_agent_write_config', () => {
      throw new Error('Local AI server is not running');
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const preset = makeConnection({
      id: 'goose',
      provider: 'custom_acp',
      config: { localAgentPreset: 'goose' },
    });

    await expect(mod.ensureAcpAgent(preset, '/tmp')).rejects.toThrow('Local AI server is not running');
  });

  it('propagates a non-preset spawn failure to the caller', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => {
      throw new Error('Binary not found');
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await expect(mod.ensureAcpAgent(makeConnection(), '/tmp')).rejects.toThrow('Binary not found');
  });

  it('authentication real error propagates', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-auth-fail',
    }));
    setMockInvokeHandler('acp_agent_authenticate', () => {
      throw new Error('Invalid API key');
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await expect(
      mod.ensureAcpAgent(makeConnection(), '/tmp'),
    ).rejects.toThrow('Invalid API key');

    // State should be null since spawn promise rejects
    expect(mod.acpAgent).toBeNull();
  });

  it('process exit → cleanup state via stopAcpAgent', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-stop',
    }));

    let stopCalled = false;
    setMockInvokeHandler('acp_agent_stop', () => {
      stopCalled = true;
      return undefined;
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await mod.ensureAcpAgent(makeConnection(), '/tmp');
    expect(mod.acpAgent).not.toBeNull();

    mod.stopAcpAgent();

    expect(mod.acpAgent).toBeNull();
    expect(stopCalled).toBe(true);
  });

  it('backend reports agent not alive → respawns', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-alive' });
    const result1 = await mod.ensureAcpAgent(connection, '/tmp');
    expect(result1).toBe('inst-1');

    // Now mock acp_agent_exists to return false — agent has crashed
    setMockInvokeHandler('acp_agent_exists', () => false);

    const result2 = await mod.ensureAcpAgent(connection, '/tmp');
    expect(result2).toBe('inst-2');
    expect(spawnCount).toBe(2);
  });

  it('concurrent callers share single spawn promise', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-concurrent' });

    // Fire two calls concurrently without awaiting the first
    const [result1, result2] = await Promise.all([
      mod.ensureAcpAgent(connection, '/tmp'),
      mod.ensureAcpAgent(connection, '/tmp'),
    ]);

    expect(spawnCount).toBe(1);
    expect(result1).toBe('inst-1');
    expect(result2).toBe('inst-1');
  });

  it('sandbox scope change triggers respawn', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-sandbox' });

    const result1 = await mod.ensureAcpAgent(connection, '/tmp', ['/a']);
    expect(result1).toBe('inst-1');

    const result2 = await mod.ensureAcpAgent(connection, '/tmp', ['/b']);
    expect(result2).toBe('inst-2');
    expect(spawnCount).toBe(2);
  });

  it('includes persisted "always" domains in the proxy allowlist at spawn (network sandbox)', async () => {
    // Regression lock for the "Allow Always is session-only" audit finding:
    // a domain the user approved with Allow Always (persisted in
    // permission-store.domainAlwaysAllowed) must reach the proxy's static
    // allowlist at agent spawn, so the user is never re-prompted for it
    // in a later session.
    setupDefaultHandlers();
    let lastSpawnArgs: Record<string, unknown> | null = null;
    setMockInvokeHandler('acp_agent_spawn', (args) => {
      lastSpawnArgs = args as Record<string, unknown>;
      return { instance_id: 'inst-net' };
    });

    // Import the store AFTER vi.resetModules() so it's the same instance
    // acp-agent-state reads from.
    const { usePermissionStore } = await import('@/stores/permission-store');
    usePermissionStore.setState({ domainAlwaysAllowed: {}, domainSessionAllowed: {} });
    usePermissionStore
      .getState()
      .allowDomain('conn-net', 'api.custom.dev', 'always', null);

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-net', networkSandboxEnabled: true });
    const result = await mod.ensureAcpAgent(connection, '/tmp');
    expect(result).toBe('inst-net');

    const domains = lastSpawnArgs!.networkAllowedDomains as string[];
    // Persisted always-domain included…
    expect(domains).toContain('api.custom.dev');
    // …alongside the provider's built-in allowlist (claude-agent-acp).
    expect(domains).toContain('api.anthropic.com');
  });

  it('does not leak persisted domains from OTHER connections into the spawn allowlist', async () => {
    setupDefaultHandlers();
    let lastSpawnArgs: Record<string, unknown> | null = null;
    setMockInvokeHandler('acp_agent_spawn', (args) => {
      lastSpawnArgs = args as Record<string, unknown>;
      return { instance_id: 'inst-net-2' };
    });

    const { usePermissionStore } = await import('@/stores/permission-store');
    usePermissionStore.setState({ domainAlwaysAllowed: {}, domainSessionAllowed: {} });
    usePermissionStore
      .getState()
      .allowDomain('conn-other', 'other-conn.example.com', 'always', null);

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const connection = makeConnection({ id: 'conn-net-2', networkSandboxEnabled: true });
    await mod.ensureAcpAgent(connection, '/tmp');

    const domains = lastSpawnArgs!.networkAllowedDomains as string[];
    expect(domains).not.toContain('other-conn.example.com');
  });

  // --- Local Agent preset: endpoint-config respawn (#10) ---

  function makePresetConnection(overrides: Partial<Connection> = {}): Connection {
    return makeConnection({
      id: 'conn-preset',
      provider: 'custom_acp',
      label: 'Local Agent',
      credentials: { type: 'agent_managed', agentBinary: '/opt/goose' },
      config: { binaryPath: '/opt/goose', binaryArgs: ['acp'], localAgentPreset: 'goose' },
      ...overrides,
    });
  }

  it('preset connection regenerates config and injects isolation env + llama port at spawn', async () => {
    setupDefaultHandlers();
    let lastSpawnArgs: Record<string, unknown> | null = null;
    setMockInvokeHandler('acp_agent_spawn', (args) => {
      lastSpawnArgs = args as Record<string, unknown>;
      return { instance_id: 'inst-preset' };
    });
    setMockInvokeHandler('local_agent_write_config', () => ({
      configPath: '/home/u/.notesage/agents/goose',
      env: {
        GOOSE_PROVIDER: 'openai',
        XDG_CONFIG_HOME: '/home/u/.notesage/agents/goose/config',
      },
      configKey: '8137:qwen2.5-coder-7b',
      port: 8137,
      modelId: 'qwen2.5-coder-7b',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const result = await mod.ensureAcpAgent(makePresetConnection(), '/work');
    expect(result).toBe('inst-preset');
    expect(mod.acpAgent!.configKey).toBe('8137:qwen2.5-coder-7b');
    // Isolation env merged into the spawn.
    expect((lastSpawnArgs!.envVars as Record<string, string>).XDG_CONFIG_HOME).toBe(
      '/home/u/.notesage/agents/goose/config',
    );
    // llama-server port allowed through the kernel network sandbox.
    expect(lastSpawnArgs!.extraLocalhostPorts).toEqual([8137]);
  });

  it('preset connection respawns when the llama-server port changes (#10)', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });
    let port = 8137;
    setMockInvokeHandler('local_agent_write_config', () => ({
      configPath: '/x',
      env: {},
      configKey: `${port}:qwen2.5-coder-7b`,
      port,
      modelId: 'qwen2.5-coder-7b',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    const conn = makePresetConnection();
    const r1 = await mod.ensureAcpAgent(conn, '/work');
    expect(r1).toBe('inst-1');
    // Same port → no respawn.
    const r2 = await mod.ensureAcpAgent(conn, '/work');
    expect(r2).toBe('inst-1');
    expect(spawnCount).toBe(1);

    // Server restarted on a new port → config key changes → respawn.
    port = 8190;
    const r3 = await mod.ensureAcpAgent(conn, '/work');
    expect(r3).toBe('inst-2');
    expect(spawnCount).toBe(2);
    expect(mod.acpAgent!.configKey).toBe('8190:qwen2.5-coder-7b');
  });

  it('non-preset connections never call local_agent_write_config and keep configKey empty', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({ instance_id: 'inst-plain' }));
    let configCalls = 0;
    setMockInvokeHandler('local_agent_write_config', () => {
      configCalls++;
      return { configPath: '', env: {}, configKey: 'x', port: 1, modelId: 'm' };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await mod.ensureAcpAgent(makeConnection({ id: 'conn-plain' }), '/tmp');
    expect(configCalls).toBe(0);
    expect(mod.acpAgent!.configKey).toBe('');
  });

  it('updateAcpAgentInstanceId updates the instance ID', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-original',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await mod.ensureAcpAgent(makeConnection(), '/tmp');
    expect(mod.acpAgent!.instanceId).toBe('inst-original');

    mod.updateAcpAgentInstanceId('new-id');
    expect(mod.acpAgent!.instanceId).toBe('new-id');
  });
});

describe('ACP agent registry (per-conversation, task #2)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('two distinct conversations each spawn and keep a distinct instance_id', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    const connA = makeConnection({ id: 'conn-a' });
    const connB = makeConnection({ id: 'conn-b' });

    const idA = await mod.ensureAcpAgent(connA, '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    const idB = await mod.ensureAcpAgent(connB, '/tmp', undefined, 'send', { conversationId: 'conv-B' });

    // Distinct processes — no cross-wiring.
    expect(idA).toBe('inst-1');
    expect(idB).toBe('inst-2');
    expect(spawnCount).toBe(2);
    expect(mod.getAcpAgent('conv-A')!.instanceId).toBe('inst-1');
    expect(mod.getAcpAgent('conv-B')!.instanceId).toBe('inst-2');
    expect(mod.getAcpAgent('conv-A')!.connectionId).toBe('conn-a');
    expect(mod.getAcpAgent('conv-B')!.connectionId).toBe('conn-b');
  });

  it('reuses the per-conversation entry on a second send (one spawn per key)', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    const conn = makeConnection({ id: 'conn-a' });

    const first = await mod.ensureAcpAgent(conn, '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    const second = await mod.ensureAcpAgent(conn, '/tmp', undefined, 'send', { conversationId: 'conv-A' });

    expect(first).toBe('inst-1');
    expect(second).toBe('inst-1');
    expect(spawnCount).toBe(1);
  });

  it('the per-key spawn guard collapses concurrent sends for the same conversation', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', async () => {
      spawnCount++;
      // Yield so both callers reach the in-flight guard before this resolves.
      await Promise.resolve();
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    const conn = makeConnection({ id: 'conn-a' });

    const [a, b] = await Promise.all([
      mod.ensureAcpAgent(conn, '/tmp', undefined, 'send', { conversationId: 'conv-A' }),
      mod.ensureAcpAgent(conn, '/tmp', undefined, 'send', { conversationId: 'conv-A' }),
    ]);

    expect(a).toBe('inst-1');
    expect(b).toBe('inst-1');
    expect(spawnCount).toBe(1);
  });

  it('respawn for one conversation does not disturb another', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-a' }), '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'send', { conversationId: 'conv-B' });

    // conv-B switches its connection → respawns only conv-B.
    const reB = await mod.ensureAcpAgent(makeConnection({ id: 'conn-c' }), '/tmp', undefined, 'send', { conversationId: 'conv-B' });

    expect(reB).toBe('inst-3');
    expect(mod.getAcpAgent('conv-A')!.instanceId).toBe('inst-1'); // untouched
    expect(mod.getAcpAgent('conv-B')!.instanceId).toBe('inst-3');
  });

  it('stopAcpAgent(conversationId) clears only that conversation', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-a' }), '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'send', { conversationId: 'conv-B' });

    mod.stopAcpAgent('conv-A');

    expect(mod.getAcpAgent('conv-A')).toBeNull();
    expect(mod.getAcpAgent('conv-B')!.instanceId).toBe('inst-2');
  });

  it('stopAllAcpAgents tears down every registry entry', async () => {
    setupDefaultHandlers();
    let stops = 0;
    setMockInvokeHandler('acp_agent_stop', () => {
      stops++;
      return undefined;
    });
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-a' }), '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'send', { conversationId: 'conv-B' });
    expect(mod.getAllAcpAgents()).toHaveLength(2);

    mod.stopAllAcpAgents();

    expect(stops).toBe(2);
    expect(mod.getAllAcpAgents()).toHaveLength(0);
    expect(mod.getAcpAgent('conv-A')).toBeNull();
    expect(mod.getAcpAgent('conv-B')).toBeNull();
  });

  it('the default key mirrors the exported acpAgent binding (back-compat)', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({ instance_id: 'inst-default' }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    // No conversationId → default key → mirrors `acpAgent`.
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-a' }), '/tmp');
    expect(mod.acpAgent!.instanceId).toBe('inst-default');
    expect(mod.getAcpAgent()).toBe(mod.acpAgent);

    // A keyed conversation does NOT touch the default mirror.
    setMockInvokeHandler('acp_agent_spawn', () => ({ instance_id: 'inst-keyed' }));
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'send', { conversationId: 'conv-X' });
    expect(mod.acpAgent!.instanceId).toBe('inst-default');
    expect(mod.getAcpAgent('conv-X')!.instanceId).toBe('inst-keyed');
  });

  it('spawns with role "interactive" by default and forwards an explicit role', async () => {
    setupDefaultHandlers();
    const roles: string[] = [];
    setMockInvokeHandler('acp_agent_spawn', (args) => {
      roles.push(String((args as { role?: string })?.role));
      return { instance_id: `inst-${roles.length}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    // Default — chat agent.
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-a' }), '/tmp', undefined, 'send', { conversationId: 'conv-A' });
    // Explicit task role — background delegation agent.
    await mod.ensureAcpAgent(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 'task', { conversationId: 'conv-B', role: 'task' });

    expect(roles).toEqual(['interactive', 'task']);
  });

  it('the delegation agent (TASK_AGENT_KEY) is a registry entry, visible to getAllAcpAgents and not the default mirror', async () => {
    setupDefaultHandlers();
    let spawnCount = 0;
    setMockInvokeHandler('acp_agent_spawn', () => {
      spawnCount++;
      return { instance_id: `inst-${spawnCount}` };
    });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    await mod.ensureAcpAgent(makeConnection({ id: 'conn-task' }), '/project', ['/project'], 'task', {
      conversationId: mod.TASK_AGENT_KEY,
      role: 'task',
    });

    // Folded into the shared registry — reachable by its reserved key and listed
    // for teardown, without populating the foreground `acpAgent` mirror.
    expect(mod.getAcpAgent(mod.TASK_AGENT_KEY)!.connectionId).toBe('conn-task');
    expect(mod.getAllAcpAgents()).toHaveLength(1);
    expect(mod.acpAgent).toBeNull();

    // stopAcpAgent on the reserved key clears only the delegation entry.
    mod.stopAcpAgent(mod.TASK_AGENT_KEY);
    expect(mod.getAcpAgent(mod.TASK_AGENT_KEY)).toBeNull();
    expect(mod.getAllAcpAgents()).toHaveLength(0);
  });
});

describe('resolveConfiguredModeId', () => {
  it('prefers the per-conversation pick over the connection default', async () => {
    const mod = await import('../acp-agent-state');
    const conn = makeConnection({ acpDefaults: { modeId: 'default' } });
    expect(mod.resolveConfiguredModeId('acceptEdits', conn)).toBe('acceptEdits');
  });

  it('falls back to the connection default when there is no conversation pick', async () => {
    const mod = await import('../acp-agent-state');
    const conn = makeConnection({ acpDefaults: { modeId: 'plan' } });
    expect(mod.resolveConfiguredModeId(undefined, conn)).toBe('plan');
  });

  it('returns undefined when neither is set', async () => {
    const mod = await import('../acp-agent-state');
    expect(mod.resolveConfiguredModeId(undefined, makeConnection())).toBeUndefined();
    expect(mod.resolveConfiguredModeId(undefined, null)).toBeUndefined();
  });
});

describe('getAgentModeDisplay', () => {
  const goose = (): Connection =>
    makeConnection({ provider: 'custom_acp', config: { localAgentPreset: 'goose' } });

  it('maps Goose raw mode ids to friendly labels with descriptions', async () => {
    const { getAgentModeDisplay } = await import('../acp-agent-state');
    const conn = goose();
    expect(getAgentModeDisplay(conn, 'smart_approve', 'smart_approve').name).toBe('Smart Approval');
    expect(getAgentModeDisplay(conn, 'approve', 'approve').name).toBe('Approve Each Step');
    expect(getAgentModeDisplay(conn, 'auto', 'auto').name).toBe('Full Access');
    expect(getAgentModeDisplay(conn, 'chat', 'chat').name).toBe('Chat Only');
    // Every Goose mode carries a user-facing description.
    for (const id of ['smart_approve', 'approve', 'auto', 'chat']) {
      expect(getAgentModeDisplay(conn, id, id).description).toBeTruthy();
    }
  });

  it('does NOT apply the Goose map to non-preset agents (auto collision)', async () => {
    const { getAgentModeDisplay } = await import('../acp-agent-state');
    // Codex's `auto` means "agent" (read + edit, asks for risky) — must NOT
    // become Goose's "Full Access".
    const codex = makeConnection({ credentials: { type: 'agent_managed', agentBinary: 'codex-acp' } });
    expect(getAgentModeDisplay(codex, 'auto', 'auto').name).toBe('Agent');
  });

  it('falls back to the native name/description for unmapped ids', async () => {
    const { getAgentModeDisplay } = await import('../acp-agent-state');
    const conn = goose();
    const display = getAgentModeDisplay(conn, 'some_future_mode', 'Native Name', 'native desc');
    expect(display.name).toBe('Native Name');
    expect(display.description).toBe('native desc');
  });
});
