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

  it('throws after exceeding max retry depth instead of infinite recursion', async () => {
    setupDefaultHandlers();
    setMockInvokeHandler('acp_agent_spawn', () => ({
      instance_id: 'inst-1',
    }));

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();

    // After the fix, ensureAcpAgent accepts an optional depth parameter.
    // Calling with depth > MAX_RETRIES (3) should throw immediately.
    // Before the fix, this parameter doesn't exist and the function signature
    // only accepts 3 args, so this test will fail.
    const ensureFn = mod.ensureAcpAgent as (
      conn: Connection,
      cwd: string,
      sandboxPaths?: string[],
      depth?: number,
    ) => Promise<string>;

    await expect(
      ensureFn(makeConnection({ id: 'conn-b' }), '/tmp', undefined, 4),
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
    const ensureFn = mod.ensureAcpAgent as (
      conn: Connection,
      cwd: string,
      sandboxPaths?: string[],
      depth?: number,
    ) => Promise<string>;

    const result = await ensureFn(makeConnection(), '/tmp', undefined, 0);
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
