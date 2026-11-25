import { describe, it, expect, beforeEach } from 'vitest';
import {
  useMcpStore,
  mcpGlobalServerId,
  mcpProjectServerId,
  mcpProjectKey,
  mcpLegacyProjectServerId,
  mcpHeaderSecretService,
  mcpOAuthService,
  type McpServerEntry,
} from '../mcp-store';

/** A server as discovery hands it to the store: switched off. */
function discovered(id: string, overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id,
    name: id.split(':').pop() as string,
    command: 'node',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: false,
    status: 'stopped',
    tools: [],
    projectRoot: null,
    ...overrides,
  };
}

beforeEach(() => {
  useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0, configProblems: [] });
});

describe('server ids and keychain names', () => {
  it('a project-scoped id carries a short stable key of the project path', () => {
    const work = mcpProjectServerId('/Users/me/Library/Work', 'db');
    expect(work).toBe(`project:${mcpProjectKey('/Users/me/Library/Work')}:db`);
    expect(work).toMatch(/^project:[0-9a-f]{8}:db$/);
    // Stable: the same path always gives the same id.
    expect(mcpProjectServerId('/Users/me/Library/Work', 'db')).toBe(work);
    // Distinct per project, and never the old shared id.
    expect(mcpProjectServerId('/Users/me/Library/Home', 'db')).not.toBe(work);
    expect(work).not.toBe(mcpLegacyProjectServerId('db'));
    expect(mcpLegacyProjectServerId('db')).toBe('project:db');
    expect(mcpGlobalServerId('db')).toBe('global:db');
  });

  it('header secrets are named like env secrets, the OAuth token under :oauth', () => {
    expect(mcpHeaderSecretService('global:api', 'X-Api-Key')).toBe('notesage:mcp:global:api:X-Api-Key');
    expect(mcpOAuthService('global:api')).toBe('notesage:mcp:global:api:oauth');
  });
});

describe('enable overrides', () => {
  it('a server the backend reports as off stays off until the user says otherwise', () => {
    useMcpStore.getState().setServers([discovered('global:a')]);
    expect(useMcpStore.getState().getServer('global:a')?.enabled).toBe(false);

    useMcpStore.getState().setServerEnabled('global:a', true);
    expect(useMcpStore.getState().getServer('global:a')?.enabled).toBe(true);

    // The next discovery pass reports it as off again; the override wins.
    useMcpStore.getState().setServers([discovered('global:a')]);
    expect(useMcpStore.getState().getServer('global:a')?.enabled).toBe(true);
    expect(useMcpStore.getState().enabledOverrides).toEqual({ 'global:a': true });
  });

  it('enableOnNextDiscovery survives a pass that does not list the server yet, then behaves like any override', () => {
    useMcpStore.getState().enableOnNextDiscovery('global:new');

    // A pass that read mcp.json just before the server was written to it.
    useMcpStore.getState().setServers([discovered('global:a')]);
    expect(useMcpStore.getState().enabledOverrides).toEqual({ 'global:new': true });

    // The pass that finds it: switched on.
    useMcpStore.getState().setServers([discovered('global:a'), discovered('global:new')]);
    expect(useMcpStore.getState().getServer('global:new')?.enabled).toBe(true);

    // Once seen, it is pruned like any other when the server goes away.
    useMcpStore.getState().setServers([discovered('global:a')]);
    expect(useMcpStore.getState().enabledOverrides).toEqual({});
  });

  it('moveEnabledOverride carries a renamed server\'s state to its new id', () => {
    useMcpStore.setState({ enabledOverrides: { 'global:old': true, 'global:other': false } });

    useMcpStore.getState().moveEnabledOverride('global:old', 'global:new');
    expect(useMcpStore.getState().enabledOverrides).toEqual({ 'global:new': true, 'global:other': false });

    // Survives the pass that still lists the old name, and applies after.
    useMcpStore.getState().setServers([discovered('global:other')]);
    useMcpStore.getState().setServers([discovered('global:other'), discovered('global:new')]);
    expect(useMcpStore.getState().getServer('global:new')?.enabled).toBe(true);
  });

  it('moveEnabledOverride does nothing for a server that had no override', () => {
    useMcpStore.getState().moveEnabledOverride('global:old', 'global:new');
    expect(useMcpStore.getState().enabledOverrides).toEqual({});
  });

  it('migrates an override stored under the shared project id to the per-project ids, without overruling a newer one', () => {
    const work = mcpProjectServerId('/lib/Work', 'db');
    const home = mcpProjectServerId('/lib/Home', 'db');
    useMcpStore.setState({ enabledOverrides: { 'project:db': true, [home]: false } });

    useMcpStore.getState().setServers([
      discovered(work, { name: 'db', source: 'notesage-project', projectRoot: '/lib/Work' }),
      discovered(home, { name: 'db', source: 'notesage-project', projectRoot: '/lib/Home' }),
      // A global server that happens to be called `db` is not a project server.
      discovered('global:db', { name: 'db' }),
    ]);

    expect(useMcpStore.getState().enabledOverrides).toEqual({ [work]: true, [home]: false });
    expect(useMcpStore.getState().getServer(work)?.enabled).toBe(true);
    expect(useMcpStore.getState().getServer(home)?.enabled).toBe(false);
    expect(useMcpStore.getState().getServer('global:db')?.enabled).toBe(false);
  });
});

describe('config problems', () => {
  it('are replaced by each discovery pass', () => {
    useMcpStore.getState().setConfigProblems([{ name: 'x', source: 'notesage_global', reason: 'bad' }]);
    expect(useMcpStore.getState().configProblems).toHaveLength(1);
    useMcpStore.getState().setConfigProblems([]);
    expect(useMcpStore.getState().configProblems).toEqual([]);
  });
});
