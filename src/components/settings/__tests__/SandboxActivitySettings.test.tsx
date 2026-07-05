// @vitest-environment jsdom

/**
 * Component tests for the minimal sandbox observability panel
 * (Settings > AI Providers > Sandbox Activity).
 *
 * Read-only surface: rows come from `network_proxy_status` (mocked invoke),
 * connection names resolve via the ACP agent registry (mocked) + the
 * connections store, and the Refresh button re-invokes the command.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  setMockInvokeHandler,
} from '@/test/component-harness';
import type { NetworkProxyStatus } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';

// Mock the ACP agent registry — module-level singleton, not a store.
const getAllAcpAgentsMock = vi.fn<() => Array<{ instanceId: string; connectionId: string }>>(() => []);
vi.mock('@/lib/ai/acp-agent-state', () => ({
  getAllAcpAgents: () => getAllAcpAgentsMock(),
}));

import { SandboxActivitySettings } from '../SandboxActivitySettings';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

function makeStatus(overrides: Partial<NetworkProxyStatus> = {}): NetworkProxyStatus {
  return {
    instanceId: 'acp-1700000000000-abcdef12',
    agentId: 'claude-agent-acp',
    proxyAddr: '127.0.0.1:52301',
    allowedDomainCount: 3,
    sessionDomainCount: 1,
    ...overrides,
  };
}

describe('SandboxActivitySettings', () => {
  beforeEach(() => {
    getAllAcpAgentsMock.mockReset();
    getAllAcpAgentsMock.mockReturnValue([]);
    useConnectionsStore.setState({ connections: [] });
  });

  it('shows the empty state when no proxies are running', async () => {
    setMockInvokeHandler('network_proxy_status', () => []);
    renderWithProviders(<SandboxActivitySettings />);

    expect(await screen.findByText('No sandboxed agents running.')).toBeTruthy();
  });

  it('renders a row per running proxy with connection name, port, and domain counts', async () => {
    setMockInvokeHandler('network_proxy_status', () => [makeStatus()]);
    getAllAcpAgentsMock.mockReturnValue([
      { instanceId: 'acp-1700000000000-abcdef12', connectionId: 'conn-1' },
    ]);
    useConnectionsStore.setState({ connections: [makeConnection()] });

    renderWithProviders(<SandboxActivitySettings />);

    expect(await screen.findByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('52301')).toBeTruthy();
    expect(screen.getByText(/1 session-approved domain/)).toBeTruthy();
    expect(screen.getByText(/3 allowlisted at spawn/)).toBeTruthy();
  });

  it('falls back to agentId + truncated instance id when no connection maps', async () => {
    setMockInvokeHandler('network_proxy_status', () => [makeStatus()]);
    // Registry knows nothing about this instance.
    getAllAcpAgentsMock.mockReturnValue([]);

    renderWithProviders(<SandboxActivitySettings />);

    expect(
      await screen.findByText('claude-agent-acp · abcdef12'),
    ).toBeTruthy();
  });

  it('reveals the effective allowlist (built-in provider domains) on expand', async () => {
    setMockInvokeHandler('network_proxy_status', () => [makeStatus()]);
    getAllAcpAgentsMock.mockReturnValue([
      { instanceId: 'acp-1700000000000-abcdef12', connectionId: 'conn-1' },
    ]);
    useConnectionsStore.setState({ connections: [makeConnection()] });

    renderWithProviders(<SandboxActivitySettings />);
    await screen.findByText('Claude Code');

    fireEvent.click(screen.getByText('Effective allowlist'));

    // Built-in allowlist for claude-agent-acp (PROVIDER_OPTIONS installMeta).
    expect(await screen.findByText('api.anthropic.com')).toBeTruthy();
  });

  it('re-invokes network_proxy_status when Refresh is clicked', async () => {
    const handler = vi.fn(() => [makeStatus()]);
    setMockInvokeHandler('network_proxy_status', handler);
    getAllAcpAgentsMock.mockReturnValue([]);

    renderWithProviders(<SandboxActivitySettings />);
    await screen.findByText(/claude-agent-acp/);
    expect(handler).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh sandbox status' }));

    expect(await screen.findByText(/claude-agent-acp/)).toBeTruthy();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('degrades to a muted failure line when the command errors', async () => {
    setMockInvokeHandler('network_proxy_status', () => {
      throw new Error('backend unavailable');
    });

    renderWithProviders(<SandboxActivitySettings />);

    expect(await screen.findByText('Could not read proxy status.')).toBeTruthy();
  });
});
