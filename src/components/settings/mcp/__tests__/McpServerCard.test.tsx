// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/component-harness';
import { clearMockInvokeHandlers, setMockInvokeHandler } from '@/test/tauri-mock';
import { toast } from 'sonner';
import { useMcpStore } from '@/stores/mcp-store';
import { McpServerCard } from '../McpServerCard';
import type { McpServerEntry, McpToolInfo } from '@/stores/mcp-store';

function makeTool(name: string): McpToolInfo {
  return { name, description: `desc for ${name}`, input_schema: {}, server_id: 'srv-1' };
}

function makeServer(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'global:filesystem',
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'running',
    tools: [],
    transport: 'stdio',
    url: null,
    ...overrides,
  };
}

describe('McpServerCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeHandlers();
  });

  it('renders name, running status, source + Local badges, and the stdio command line', () => {
    renderWithProviders(<McpServerCard server={makeServer()} />);
    expect(screen.getByText('filesystem')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Local')).toBeTruthy();
    expect(
      screen.getByText('npx -y @modelcontextprotocol/server-filesystem /tmp'),
    ).toBeTruthy();
  });

  it('shows the stopped status label when the server is stopped', () => {
    renderWithProviders(<McpServerCard server={makeServer({ status: 'stopped', enabled: false })} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('shows the error status label and the error message when errored', () => {
    renderWithProviders(
      <McpServerCard server={makeServer({ status: 'error', error: 'spawn ENOENT' })} />,
    );
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('spawn ENOENT')).toBeTruthy();
  });

  it('renders a remote server with the URL as its command line and a Remote badge', () => {
    renderWithProviders(
      <McpServerCard
        server={makeServer({
          id: 'global:remote',
          name: 'remote',
          command: '',
          args: [],
          transport: 'http',
          url: 'https://example.com/mcp',
        })}
      />,
    );
    expect(screen.getByText('https://example.com/mcp')).toBeTruthy();
    expect(screen.getByText('Remote')).toBeTruthy();
  });

  it('shows a pluralized tool count and reveals the tool list only after expanding', () => {
    const server = makeServer({ tools: [makeTool('read'), makeTool('write')] });
    renderWithProviders(<McpServerCard server={server} />);

    expect(screen.getByText('2 tools')).toBeTruthy();
    // Collapsed by default — tool rows are not in the DOM yet.
    expect(screen.queryByText('read')).toBeNull();

    fireEvent.click(screen.getByText('Tools'));

    expect(screen.getByText('read')).toBeTruthy();
    expect(screen.getByText('write')).toBeTruthy();
  });

  it('uses the singular tool label for a single tool', () => {
    renderWithProviders(<McpServerCard server={makeServer({ tools: [makeTool('only')] })} />);
    expect(screen.getByText('1 tool')).toBeTruthy();
  });

  it('renders no Tools trigger when the server exposes no tools', () => {
    renderWithProviders(<McpServerCard server={makeServer({ tools: [] })} />);
    expect(screen.queryByText('Tools')).toBeNull();
  });
  describe('remove', () => {
    /** Put `raw` on disk as mcp.json (undefined = no file) and record every save. */
    function registerConfigFile(raw: string | undefined) {
      const saved: Array<Record<string, unknown>> = [];
      setMockInvokeHandler('get_home_dir', () => '/home/tester');
      setMockInvokeHandler('path_exists', () => raw !== undefined);
      setMockInvokeHandler('read_file', () => {
        if (raw === undefined) throw new Error('ENOENT');
        return raw;
      });
      setMockInvokeHandler('mcp_save_config', (args) => {
        saved.push(args ?? {});
        return undefined;
      });
      return { saved };
    }

    async function clickRemove() {
      const trigger = document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(await screen.findByText('Remove'));
    }

    function renderStored(server: McpServerEntry) {
      useMcpStore.setState({ servers: [server] });
      renderWithProviders(<McpServerCard server={server} />);
    }

    it('removes only this server from mcp.json and keeps the others', async () => {
      const { saved } = registerConfigFile(
        JSON.stringify({ mcpServers: { filesystem: { command: 'npx' }, git: { command: 'uvx' } } }),
      );
      renderStored(makeServer({ status: 'stopped' }));

      await clickRemove();

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Removed/));
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].configs).toEqual({ git: { command: 'uvx' } });
      expect(useMcpStore.getState().servers).toEqual([]);
    });

    it.each([
      ['invalid JSON', '{ "mcpServers": { '],
      ['a non-object mcpServers', '{ "mcpServers": 3 }'],
    ])('refuses when mcp.json holds %s: nothing is written or removed, and no success toast', async (_label, raw) => {
      const { saved } = registerConfigFile(raw);
      renderStored(makeServer({ status: 'stopped' }));

      await clickRemove();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/mcp\.json could not be read/));
      });
      expect(saved).toHaveLength(0);
      expect(toast.success).not.toHaveBeenCalled();
      expect(useMcpStore.getState().servers).toHaveLength(1);
    });

    it('does not report success when the config write fails', async () => {
      registerConfigFile(JSON.stringify({ mcpServers: { filesystem: { command: 'npx' } } }));
      setMockInvokeHandler('mcp_save_config', () => {
        throw new Error('disk full');
      });
      renderStored(makeServer({ status: 'stopped' }));

      await clickRemove();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/disk full/));
      });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('writes nothing when there is no mcp.json', async () => {
      const { saved } = registerConfigFile(undefined);
      renderStored(makeServer({ status: 'stopped' }));

      await clickRemove();

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Removed/));
      });
      expect(saved).toHaveLength(0);
    });
  });
});
