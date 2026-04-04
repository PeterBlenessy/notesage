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
});
