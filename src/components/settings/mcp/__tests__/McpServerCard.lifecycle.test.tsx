// @vitest-environment jsdom

/**
 * The server card when things go wrong: the full error is readable and
 * copyable, Restart and Start work from a failed or switched-off state, and a
 * running server without tools says so.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/component-harness';
import { clearMockInvokeHandlers, setMockInvokeHandler } from '@/test/tauri-mock';
import { toast } from 'sonner';
import { useMcpStore, mcpProjectServerId, type McpServerEntry } from '@/stores/mcp-store';
import { resetMcpLifecycleForTests } from '@/hooks/useMcpOperations';
import { McpServerCard } from '../McpServerCard';

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

/** Render the card bound to the store, so it reflects what an action did. */
function LiveCard({ id }: { id: string }) {
  const server = useMcpStore((s) => s.servers.find((x) => x.id === id));
  return server ? <McpServerCard server={server} /> : null;
}

function renderLive(server: McpServerEntry) {
  useMcpStore.setState({ servers: [server], enabledOverrides: {} });
  renderWithProviders(<LiveCard id={server.id} />);
}

async function openMenuAndClick(item: string) {
  const trigger = document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByText(item));
}

const LONG_ERROR =
  "MCP initialization failed for 'filesystem': request timed out\n\nServer output:\n" +
  'Usage: mcp-server-filesystem <allowed-directory> [additional-directories...]\n' +
  'Error: at least one allowed directory is required (line 4 of the output)';

let startCalls: Array<{ id: string; enabled: boolean }>;

beforeEach(() => {
  vi.clearAllMocks();
  clearMockInvokeHandlers();
  resetMcpLifecycleForTests();
  startCalls = [];
  setMockInvokeHandler('mcp_start_server', (args) => {
    const config = (args as { config: { id: string; enabled: boolean } }).config;
    startCalls.push({ id: config.id, enabled: config.enabled });
    return {
      ...config,
      status: 'running',
      error: null,
      tools: [{ name: 'read_file', description: null, input_schema: {}, server_id: config.id }],
    };
  });
  setMockInvokeHandler('mcp_stop_server', () => undefined);
});

describe('McpServerCard — error', () => {
  it('shows the whole error, server output included, when expanded', () => {
    renderWithProviders(<McpServerCard server={makeServer({ status: 'error', error: LONG_ERROR })} />);

    // Collapsed: a clamped summary, and a way to open it.
    const summary = screen.getByText(/MCP initialization failed/);
    expect(summary.className).toContain('line-clamp-2');
    const toggle = screen.getByRole('button', { name: 'Show full error' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    const full = screen.getByLabelText('Full error');
    expect(full.textContent).toBe(LONG_ERROR);
    expect(full.className).not.toContain('line-clamp');
    expect(full.className).toContain('select-text');
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('copies the full error to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<McpServerCard server={makeServer({ status: 'error', error: LONG_ERROR })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));

    expect(writeText).toHaveBeenCalledWith(LONG_ERROR);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied'));
  });

  it('offers no expander for an error that already fits', () => {
    renderWithProviders(<McpServerCard server={makeServer({ status: 'error', error: 'spawn ENOENT' })} />);
    expect(screen.queryByRole('button', { name: 'Show full error' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy error' })).toBeTruthy();
  });
});

describe('McpServerCard — restart and start', () => {
  it('Restart on a failed server starts it from its config and clears the error', async () => {
    const restart = vi.fn(() => {
      throw new Error("Server 'global:filesystem' not found");
    });
    setMockInvokeHandler('mcp_restart_server', restart);
    renderLive(makeServer({ status: 'error', error: 'spawn ENOENT' }));

    await openMenuAndClick('Restart');

    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy());
    expect(startCalls.map((c) => c.id)).toEqual(['global:filesystem']);
    expect(screen.queryByText('spawn ENOENT')).toBeNull();
    expect(screen.getByText('1 tool')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Restart on a stopped server starts it', async () => {
    renderLive(makeServer({ status: 'stopped' }));

    await openMenuAndClick('Restart');

    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy());
    expect(startCalls).toHaveLength(1);
  });

  it('Start on a server that is switched off also switches it on, so its tools are offered', async () => {
    renderLive(makeServer({ status: 'stopped', enabled: false }));
    expect((screen.getByRole('switch', { name: 'Use filesystem' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');

    await openMenuAndClick('Start');

    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy());
    expect(startCalls).toEqual([{ id: 'global:filesystem', enabled: true }]);
    expect(screen.getByRole('switch', { name: 'Use filesystem' }).getAttribute('aria-checked')).toBe('true');
    const state = useMcpStore.getState();
    expect(state.enabledOverrides['global:filesystem']).toBe(true);
    expect(state.getActiveTools().map((t) => t.name)).toEqual(['read_file']);
  });
});

describe('McpServerCard — tools', () => {
  it('says so when a running server lists no tools', () => {
    renderWithProviders(<McpServerCard server={makeServer({ tools: [] })} />);
    expect(screen.getByText('No tools')).toBeTruthy();
    expect(screen.getByText(/did not list any tools/)).toBeTruthy();
  });

  it('does not say that about a server that is not running', () => {
    renderWithProviders(<McpServerCard server={makeServer({ status: 'stopped', tools: [] })} />);
    expect(screen.queryByText('No tools')).toBeNull();
    expect(screen.queryByText(/did not list any tools/)).toBeNull();
  });

  it('quotes an argument with spaces in the command line it shows', () => {
    renderWithProviders(
      <McpServerCard server={makeServer({ args: ['-y', 'pkg', '/Users/me/My Notes'] })} />,
    );
    expect(screen.getByText('npx -y pkg "/Users/me/My Notes"')).toBeTruthy();
  });

  it('labels the menu and the switch with the server they act on', () => {
    renderWithProviders(<McpServerCard server={makeServer()} />);
    expect(screen.getByRole('button', { name: 'Actions for filesystem' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Use filesystem' })).toBeTruthy();
  });
});

describe('McpServerCard — removing a project-scoped server', () => {
  it('rewrites the project\'s own mcp.json and deletes its header secrets and OAuth token', async () => {
    const projectFile = '/lib/Work/.notesage/mcp.json';
    const saved: Array<{ path: string; configs: Record<string, unknown> }> = [];
    const deleted: string[] = [];
    setMockInvokeHandler('get_home_dir', () => '/home/tester');
    setMockInvokeHandler('path_exists', (args) => (args as { path: string }).path === projectFile);
    setMockInvokeHandler('read_file', () =>
      JSON.stringify({ mcpServers: { api: { transport: 'http', url: 'https://x.test' }, db: { command: 'node' } } }),
    );
    setMockInvokeHandler('mcp_save_config', (args) => {
      saved.push(args as { path: string; configs: Record<string, unknown> });
      return undefined;
    });
    setMockInvokeHandler('delete_credential', (args) => {
      deleted.push((args as { service: string }).service);
      return undefined;
    });
    const id = mcpProjectServerId('/lib/Work', 'api');
    renderLive(
      makeServer({
        id,
        name: 'api',
        command: '',
        args: [],
        transport: 'http',
        url: 'https://x.test',
        headers: { Authorization: { secret: true }, 'X-Tenant': 'acme' },
        source: 'notesage-project',
        projectRoot: '/lib/Work',
        status: 'stopped',
      }),
    );

    await openMenuAndClick('Remove');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Removed/)));
    expect(saved).toEqual([{ path: projectFile, configs: { db: { command: 'node' } } }]);
    expect(deleted.sort()).toEqual([`notesage:mcp:${id}:Authorization`, `notesage:mcp:${id}:oauth`].sort());
  });
});
