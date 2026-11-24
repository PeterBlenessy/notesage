// @vitest-environment jsdom

/**
 * The MCP section of Settings: the note on where MCP tools work, config
 * entries that could not be loaded, and the catalog flow for a server that
 * needs an argument from the user.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/test/component-harness';
import { setMockInvokeHandler, clearMockInvokeHandlers } from '@/test/tauri-mock';
import { toast } from 'sonner';
import { McpServersSettings } from '@/components/settings/McpServersSettings';
import { useMcpStore, type McpCatalogItem } from '@/stores/mcp-store';
import { requiredArgsFor, argsFromAnswers } from '@/components/settings/mcp/catalog-requirements';

function catalogItem(overrides: Partial<McpCatalogItem>): McpCatalogItem {
  return {
    id: 'x',
    name: 'X',
    description: 'A server',
    category: null,
    homepage: null,
    official: true,
    transport: 'stdio',
    url: null,
    command: 'npx',
    args: ['-y', 'x'],
    required_env: [],
    ...overrides,
  };
}

const FILESYSTEM = catalogItem({
  id: 'filesystem',
  name: 'Filesystem',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
});

beforeEach(() => {
  vi.clearAllMocks();
  clearMockInvokeHandlers();
  setMockInvokeHandler('mcp_check_import_sources', () => []);
  useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0, configProblems: [] });
});

describe('McpServersSettings', () => {
  it('says which chats can use MCP tools', () => {
    renderWithProviders(<McpServersSettings />);

    const note = screen.getByText(/available in chats with API providers and Copilot/);
    expect(note.textContent).toMatch(/switched on and running/);
    expect(note.textContent).toMatch(/asks for permission/);
    expect(note.textContent).toMatch(/Coding agents receive them when a new agent session starts/);
  });

  it('lists config entries that could not be loaded, above the servers, and opens the file', async () => {
    const revealed: string[] = [];
    setMockInvokeHandler('reveal_in_finder', (args) => {
      revealed.push((args as { path: string }).path);
      return undefined;
    });
    useMcpStore.setState({
      configProblems: [
        {
          name: 'broken',
          source: 'notesage_global',
          reason: 'Unknown transport "websocket".',
          file: '/Users/me/.notesage/mcp.json',
        },
        {
          name: '/lib/Work/.notesage/mcp.json',
          source: 'notesage_project',
          reason: 'The file is not valid JSON.',
          file: '/lib/Work/.notesage/mcp.json',
        },
        { name: 'orphan', source: 'notesage_project', reason: 'env value for PORT must be a string.' },
      ],
    });
    renderWithProviders(<McpServersSettings />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('3 server entries could not be loaded')).toBeTruthy();
    // Name, file and reason of each.
    expect(within(alert).getByText('broken')).toBeTruthy();
    expect(within(alert).getByText('/Users/me/.notesage/mcp.json')).toBeTruthy();
    expect(within(alert).getByText('Unknown transport "websocket".')).toBeTruthy();
    // A whole-file problem shows the path once.
    expect(within(alert).getByText('The whole file could not be read')).toBeTruthy();
    expect(within(alert).getAllByText('/lib/Work/.notesage/mcp.json')).toHaveLength(1);
    expect(within(alert).getByText('The file is not valid JSON.')).toBeTruthy();
    // One whose file is unknown still shows, without a button.
    expect(within(alert).getByText('orphan')).toBeTruthy();
    expect(within(alert).getByText('A project’s .notesage/mcp.json')).toBeTruthy();
    expect(within(alert).getAllByRole('button')).toHaveLength(2);
    // Above the (empty) server list.
    const emptyState = screen.getByText('No MCP servers configured');
    expect(alert.compareDocumentPosition(emptyState) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Show the file that contains broken' }));
    await waitFor(() => expect(revealed).toEqual(['/Users/me/.notesage/mcp.json']));
  });

  it('shows no problem banner when every entry loaded', () => {
    renderWithProviders(<McpServersSettings />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('toasts when the file cannot be shown', async () => {
    setMockInvokeHandler('reveal_in_finder', () => {
      throw new Error('no such file');
    });
    useMcpStore.setState({
      configProblems: [{ name: 'broken', source: 'notesage_global', reason: 'r', file: '/Users/me/.notesage/mcp.json' }],
    });
    renderWithProviders(<McpServersSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Show the file that contains broken' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Could not show the file.*no such file/));
    });
  });

  it('adding Filesystem from the catalog asks for the folder instead of adding a server that exits at once', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => [FILESYSTEM]);
    renderWithProviders(<McpServersSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    // The catalog card says up front what will be asked for.
    const requirement = await screen.findByText('Folder the server may access');
    const card = requirement.closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /^Add$/ }));

    const folder = await screen.findByLabelText(/^Folder the server may access/);
    expect(folder.getAttribute('aria-required')).toBe('true');
    expect((screen.getByRole('button', { name: 'Add Server' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx');
    expect((screen.getByLabelText('Arguments') as HTMLInputElement).value).toBe(
      '-y @modelcontextprotocol/server-filesystem',
    );

    fireEvent.change(folder, { target: { value: '/Users/me/Notes' } });
    expect((screen.getByRole('button', { name: 'Add Server' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('catalog requirements', () => {
  it('Filesystem requires a folder; Git offers an optional repository; the rest need nothing', () => {
    expect(requiredArgsFor(FILESYSTEM)).toEqual([
      { key: 'directory', label: 'Folder the server may access', kind: 'path', required: true },
    ]);
    expect(requiredArgsFor(catalogItem({ id: 'git' }))).toEqual([
      { key: 'repository', label: 'Git repository', kind: 'path', flag: '--repository', required: false },
    ]);
    for (const id of ['fetch', 'memory', 'sequential-thinking', 'time', 'everything']) {
      expect(requiredArgsFor(catalogItem({ id }))).toEqual([]);
    }
  });

  it('prefers what a catalog entry declares itself', () => {
    const declared = [{ key: 'vault', label: 'Vault', kind: 'path' as const }];
    expect(requiredArgsFor(catalogItem({ id: 'filesystem', required_args: declared }))).toEqual(declared);
  });

  it('turns answers into arguments in order, with flags, skipping empty ones', () => {
    expect(
      argsFromAnswers(
        [
          { key: 'a', label: 'A', kind: 'path' },
          { key: 'b', label: 'B', kind: 'text', flag: '--b' },
          { key: 'c', label: 'C', kind: 'text', flag: '--c' },
        ],
        { a: ' /x y ', b: 'v', c: '  ' },
      ),
    ).toEqual(['/x y', '--b', 'v']);
  });
});
