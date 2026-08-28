/**
 * @vitest-environment jsdom
 *
 * Tests for the ConnectionCard uninstall + Copilot sign-out actions
 * (deep-review batch 5a — wiring `agent_uninstall` / `copilot_lsp_sign_out`).
 *
 *   Uninstall: confirm dialog → invoke('agent_uninstall') → installed-state
 *   refresh via agent_resolve_binary (system binary keeps the connection;
 *   nothing resolved → not_installed). Only shown for managed binaries.
 *
 *   Sign out: invoke('copilot_lsp_sign_out') → status flips to 'expired'.
 *   Errors surface as toasts; status is left untouched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import '@/test/tauri-mock';
import { setMockInvokeHandler, registerDefaultHandlers } from '@/test/tauri-mock';
import { toast } from 'sonner';

// Heavy child components are irrelevant to these flows — stub them out.
vi.mock('../ReauthDialog', () => ({ ReauthDialog: () => null }));
vi.mock('../LocalAIModelsDialog', () => ({ LocalAIModelsDialog: () => null }));
vi.mock('../GooseAttribution', () => ({ GooseAttribution: () => null }));
vi.mock('@/components/ProviderLogo', () => ({ ProviderLogo: () => null }));

import { ConnectionCard } from '../ConnectionCard';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';

function agentConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive'],
    createdAt: 0,
    binarySource: 'managed',
    ...overrides,
  } as Connection;
}

function seedStore(conn: Connection): void {
  useConnectionsStore.setState({ connections: [conn] });
}

function storedConn(id: string): Connection | undefined {
  return useConnectionsStore.getState().connections.find((c) => c.id === id);
}

beforeEach(() => {
  registerDefaultHandlers();
  vi.clearAllMocks();
});

describe('ConnectionCard — uninstall (managed agents)', () => {
  it('hides the uninstall affordance for system (PATH-resolved) binaries', () => {
    const conn = agentConn({ binarySource: 'system' });
    seedStore(conn);
    render(<ConnectionCard connection={conn} />);
    expect(screen.queryByLabelText('Uninstall agent binary')).toBeNull();
  });

  it('hides the uninstall affordance for non-agent connections', () => {
    const conn = agentConn({
      authMethod: 'api_key',
      credentials: { type: 'api_key', credentialStored: true },
      binarySource: undefined,
    } as Partial<Connection>);
    seedStore(conn);
    render(<ConnectionCard connection={conn} />);
    expect(screen.queryByLabelText('Uninstall agent binary')).toBeNull();
  });

  it('confirm → invoke → not_installed when no binary resolves anymore', async () => {
    const conn = agentConn();
    seedStore(conn);

    const uninstalled: unknown[] = [];
    setMockInvokeHandler('agent_uninstall', (args) => {
      uninstalled.push(args);
      return undefined;
    });
    setMockInvokeHandler('agent_resolve_binary', () => null);

    render(<ConnectionCard connection={conn} />);

    fireEvent.click(screen.getByLabelText('Uninstall agent binary'));
    // Confirm dialog copy
    expect(await screen.findByText(/binary will be removed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));

    await waitFor(() => {
      expect(uninstalled).toHaveLength(1);
    });
    expect(uninstalled[0]).toMatchObject({ agentId: 'claude-agent-acp' });

    await waitFor(() => {
      expect(storedConn('conn-1')?.status).toBe('not_installed');
    });
    expect(storedConn('conn-1')?.binarySource).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('claude-agent-acp'));
  });

  it('keeps the connection usable when a system binary still resolves', async () => {
    const conn = agentConn();
    seedStore(conn);

    setMockInvokeHandler('agent_uninstall', () => undefined);
    setMockInvokeHandler('agent_resolve_binary', () => ({
      path: '/usr/local/bin/claude-agent-acp',
      source: 'system',
      version: '1.2.3',
    }));

    render(<ConnectionCard connection={conn} />);
    fireEvent.click(screen.getByLabelText('Uninstall agent binary'));
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }));

    await waitFor(() => {
      expect(storedConn('conn-1')?.binarySource).toBe('system');
    });
    // Status untouched — the agent still works from PATH.
    expect(storedConn('conn-1')?.status).toBe('connected');
  });

  it('toasts the error and leaves the connection untouched when uninstall fails', async () => {
    const conn = agentConn();
    seedStore(conn);

    setMockInvokeHandler('agent_uninstall', () => {
      throw new Error('Failed to remove binary: permission denied');
    });

    render(<ConnectionCard connection={conn} />);
    fireEvent.click(screen.getByLabelText('Uninstall agent binary'));
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    });
    expect(storedConn('conn-1')?.status).toBe('connected');
    expect(storedConn('conn-1')?.binarySource).toBe('managed');
  });
});

describe('ConnectionCard — Copilot LSP sign out', () => {
  function copilotLspConn(): Connection {
    return agentConn({
      id: 'conn-lsp',
      provider: 'github',
      label: 'GitHub Copilot (LSP)',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      binarySource: undefined,
    } as Partial<Connection>);
  }

  // Sign-out was REMOVED, and this guards it staying removed.
  //
  // The Copilot LSP shares ONE credential store with everything else on the
  // machine that uses it. Notesage does not run its own isolated copy, so
  // signing out from here signs the user out of Copilot everywhere — including
  // wherever they had signed in before Notesage was installed. That is not
  // Notesage's credential to revoke.
  //
  // Disconnect deliberately leaves the token alone for the same reason: it
  // removes the connection from Notesage and nothing else.
  it('offers no sign-out action — the Copilot credential is shared, not ours', () => {
    for (const conn of [agentConn(), copilotLspConn()]) {
      seedStore(conn);
      const { unmount } = render(<ConnectionCard connection={conn} />);
      expect(screen.queryByLabelText(/sign out/i)).toBeNull();
      expect(screen.queryByTitle(/sign out/i)).toBeNull();
      unmount();
    }
  });
});
