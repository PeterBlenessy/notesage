// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, within, act } from '@/test/component-harness';
import { ApprovalsSettings } from '@/components/settings/ApprovalsSettings';
import { usePermissionStore } from '@/stores/permission-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';

function resetStores() {
  usePermissionStore.setState({
    requests: [],
    sessionAllowed: new Set<string>(),
    alwaysAllowed: [],
    skillScriptSession: new Set<string>(),
    skillScriptAlways: [],
    toolCallSession: new Set<string>(),
    toolCallAlways: [],
    domainSessionAllowed: {},
    domainAlwaysAllowed: {},
  });
  useConnectionsStore.setState({ connections: [] });
}

function seedConnections() {
  const connA: Connection = {
    id: 'conn-claude',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Claude Sonnet',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: 1,
  };
  const connB: Connection = {
    id: 'conn-openai',
    provider: 'openai',
    authMethod: 'api_key',
    status: 'connected',
    label: 'OpenAI GPT-4o',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: 2,
  };
  useConnectionsStore.setState({ connections: [connA, connB] });
}

describe('ApprovalsSettings', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state when no approvals exist', () => {
    renderWithProviders(<ApprovalsSettings />);
    expect(screen.getByText(/No persisted approvals/i)).toBeTruthy();
  });

  it('renders scoped tool approvals with tool/connection/project columns', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        {
          toolName: 'write_file',
          connectionId: 'conn-claude',
          projectRoot: '/Users/me/Projects/ProjectA',
          grantedAt: Date.now(),
        },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);

    expect(screen.getByText('write_file')).toBeTruthy();
    expect(screen.getByText('Claude Sonnet')).toBeTruthy();
    // Project basename displayed
    expect(screen.getByText('ProjectA')).toBeTruthy();
  });

  it('renders ACP (alwaysAllowed) approvals alongside tool-call approvals', () => {
    seedConnections();
    usePermissionStore.setState({
      alwaysAllowed: [
        {
          toolName: 'edit',
          connectionId: 'conn-openai',
          projectRoot: '/work/projB',
          grantedAt: 100,
        },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);

    expect(screen.getByText('edit')).toBeTruthy();
    expect(screen.getByText('OpenAI GPT-4o')).toBeTruthy();
    expect(screen.getByText('projB')).toBeTruthy();
  });

  it('renders skill script approvals', () => {
    seedConnections();
    usePermissionStore.setState({
      skillScriptAlways: [
        {
          toolName: 'web-research',
          connectionId: 'conn-claude',
          projectRoot: null,
          grantedAt: 200,
        },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);
    expect(screen.getByText('web-research')).toBeTruthy();
  });

  it('renders domain approvals keyed by connection+project', () => {
    seedConnections();
    usePermissionStore.setState({
      domainAlwaysAllowed: {
        'conn-claude': {
          global: ['api.github.com', 'registry.npmjs.org'],
          '/work/projB': ['internal.example.com'],
        },
      },
    });

    renderWithProviders(<ApprovalsSettings />);

    expect(screen.getByText('api.github.com')).toBeTruthy();
    expect(screen.getByText('registry.npmjs.org')).toBeTruthy();
    expect(screen.getByText('internal.example.com')).toBeTruthy();
  });

  it('renders a "legacy, broad" warning label for null/null approvals', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        { toolName: 'bash', connectionId: null, projectRoot: null, grantedAt: 1 },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);

    expect(screen.getAllByText(/legacy/i).length).toBeGreaterThan(0);
  });

  it('revokes a single tool-call approval on row Revoke click', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        {
          toolName: 'write_file',
          connectionId: 'conn-claude',
          projectRoot: '/work/projA',
          grantedAt: 1,
        },
        {
          toolName: 'bash',
          connectionId: 'conn-openai',
          projectRoot: '/work/projB',
          grantedAt: 2,
        },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);

    // Find the row for 'write_file' and click its Revoke button
    const writeFileCell = screen.getByText('write_file');
    const row = writeFileCell.closest('tr') || writeFileCell.closest('[data-row="approval"]');
    expect(row).toBeTruthy();
    const revoke = within(row as HTMLElement).getByRole('button', { name: /revoke/i });
    act(() => {
      fireEvent.click(revoke);
    });

    const state = usePermissionStore.getState();
    expect(state.toolCallAlways.find((a) => a.toolName === 'write_file')).toBeUndefined();
    expect(state.toolCallAlways.find((a) => a.toolName === 'bash')).toBeDefined();
  });

  it('bulk-revokes all legacy approvals (null connection + null project)', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        { toolName: 'bash', connectionId: null, projectRoot: null, grantedAt: 1 },
        {
          toolName: 'write_file',
          connectionId: 'conn-claude',
          projectRoot: '/work/projA',
          grantedAt: 2,
        },
      ],
      skillScriptAlways: [
        { toolName: 'download', connectionId: null, projectRoot: null, grantedAt: 3 },
      ],
      alwaysAllowed: [
        { toolName: 'edit', connectionId: null, projectRoot: null, grantedAt: 4 },
      ],
    });

    renderWithProviders(<ApprovalsSettings />);

    const bulk = screen.getByRole('button', { name: /revoke all legacy/i });
    act(() => {
      fireEvent.click(bulk);
    });

    const state = usePermissionStore.getState();
    expect(state.toolCallAlways).toHaveLength(1);
    expect(state.toolCallAlways[0].toolName).toBe('write_file');
    expect(state.skillScriptAlways).toHaveLength(0);
    expect(state.alwaysAllowed).toHaveLength(0);
  });

  it('bulk-revokes all approvals for a given connection', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        {
          toolName: 'write_file',
          connectionId: 'conn-claude',
          projectRoot: '/work/projA',
          grantedAt: 1,
        },
        {
          toolName: 'bash',
          connectionId: 'conn-openai',
          projectRoot: '/work/projB',
          grantedAt: 2,
        },
      ],
      domainAlwaysAllowed: {
        'conn-claude': { global: ['api.github.com'] },
        'conn-openai': { global: ['other.com'] },
      },
    });

    renderWithProviders(<ApprovalsSettings />);

    // Click the "Revoke all for Claude Sonnet" action
    const bulkMenu = screen.getByRole('button', { name: /revoke all for Claude Sonnet/i });
    act(() => {
      fireEvent.click(bulkMenu);
    });

    const state = usePermissionStore.getState();
    expect(state.toolCallAlways.find((a) => a.connectionId === 'conn-claude')).toBeUndefined();
    expect(state.toolCallAlways.find((a) => a.connectionId === 'conn-openai')).toBeDefined();
    // domain approvals for conn-claude gone
    expect(state.domainAlwaysAllowed['conn-claude']).toBeUndefined();
    // domain approvals for conn-openai preserved
    expect(state.domainAlwaysAllowed['conn-openai']).toEqual({ global: ['other.com'] });
  });

  it('bulk-revokes all approvals for a given project', () => {
    seedConnections();
    usePermissionStore.setState({
      toolCallAlways: [
        {
          toolName: 'write_file',
          connectionId: 'conn-claude',
          projectRoot: '/work/projA',
          grantedAt: 1,
        },
        {
          toolName: 'bash',
          connectionId: 'conn-openai',
          projectRoot: '/work/projB',
          grantedAt: 2,
        },
      ],
      domainAlwaysAllowed: {
        'conn-claude': {
          global: ['api.github.com'],
          '/work/projA': ['projA.example.com'],
        },
      },
    });

    renderWithProviders(<ApprovalsSettings />);

    const bulk = screen.getByRole('button', { name: /revoke all for \/work\/projA/i });
    act(() => {
      fireEvent.click(bulk);
    });

    const state = usePermissionStore.getState();
    expect(state.toolCallAlways.find((a) => a.projectRoot === '/work/projA')).toBeUndefined();
    expect(state.toolCallAlways.find((a) => a.projectRoot === '/work/projB')).toBeDefined();
    // projA domain bucket removed; global bucket preserved
    expect(state.domainAlwaysAllowed['conn-claude']).toEqual({ global: ['api.github.com'] });
  });
});
