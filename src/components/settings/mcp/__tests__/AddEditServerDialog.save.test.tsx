// @vitest-environment jsdom

/**
 * What the Add/Edit dialog writes, and where: the split command line, the
 * working directory, remote headers, "Save without testing", renames, edits
 * of project-scoped servers, the OAuth token's id and catalog arguments.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import { setMockInvokeHandler, clearMockInvokeHandlers } from '@/test/tauri-mock';
import { toast } from 'sonner';
import { AddEditServerDialog } from '../AddEditServerDialog';
import { useMcpDiscovery, resetMcpLifecycleForTests, type McpValidationResult } from '@/hooks/useMcpOperations';
import { useMcpStore, mcpProjectServerId, type McpServerEntry } from '@/stores/mcp-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { CatalogPrefill } from '../types';

const GLOBAL_FILE = '/home/tester/.notesage/mcp.json';

function okResult(): McpValidationResult {
  return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
}

function errResult(error: string, kind = 'spawn_failed'): McpValidationResult {
  return { ok: false, tools: [], server_info: null, error, error_kind: kind, stderr_tail: 'npm ERR! 404' };
}

interface Backend {
  /** Config files on disk, by path (raw JSON). */
  files: Record<string, string>;
  /** Every `mcp_save_config` call. */
  saved: Array<{ path: string; configs: Record<string, Record<string, unknown>> }>;
  /** The keychain. */
  keychain: Map<string, string>;
  /** Configs handed to `mcp_validate_server`. */
  validated: Array<Record<string, unknown>>;
  stopped: string[];
  authorized: string[];
}

/** A fake of everything the save path talks to. `validation` decides the dry run. */
function backend(validation: () => McpValidationResult | Promise<McpValidationResult> = okResult): Backend {
  const state: Backend = {
    files: {},
    saved: [],
    keychain: new Map(),
    validated: [],
    stopped: [],
    authorized: [],
  };
  setMockInvokeHandler('get_home_dir', () => '/home/tester');
  setMockInvokeHandler('path_exists', (args) => (args as { path: string }).path in state.files);
  setMockInvokeHandler('read_file', (args) => {
    const path = (args as { path: string }).path;
    if (!(path in state.files)) throw new Error('ENOENT');
    return state.files[path];
  });
  setMockInvokeHandler('mcp_save_config', (args) => {
    const call = args as { path: string; configs: Record<string, Record<string, unknown>> };
    state.saved.push(call);
    state.files[call.path] = JSON.stringify({ mcpServers: call.configs });
    return undefined;
  });
  setMockInvokeHandler('get_credential', (args) => state.keychain.get((args as { service: string }).service) ?? null);
  setMockInvokeHandler('store_credential', (args) => {
    const { service, key } = args as { service: string; key: string };
    state.keychain.set(service, key);
    return undefined;
  });
  setMockInvokeHandler('delete_credential', (args) => {
    state.keychain.delete((args as { service: string }).service);
    return undefined;
  });
  setMockInvokeHandler('mcp_validate_server', (args) => {
    state.validated.push((args as { config: Record<string, unknown> }).config);
    return validation();
  });
  setMockInvokeHandler('mcp_stop_server', (args) => {
    state.stopped.push((args as { serverId: string }).serverId);
    return undefined;
  });
  setMockInvokeHandler('mcp_oauth_status', () => ({ authorized: false, expires_at: null }));
  setMockInvokeHandler('mcp_oauth_authorize', (args) => {
    const { serverId } = args as { serverId: string };
    state.authorized.push(serverId);
    state.keychain.set(`notesage:mcp:${serverId}:oauth`, 'token-blob');
    return { authorized: true, expires_at: null };
  });
  return state;
}

function server(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'global:files',
    name: 'files',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'stopped',
    tools: [],
    transport: 'stdio',
    url: null,
    ...overrides,
  };
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockInvokeHandlers();
  resetMcpLifecycleForTests();
  useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0, configProblems: [] });
});

describe('AddEditServerDialog — command line', () => {
  it('splits a whole pasted line: first word is the command, the rest are arguments (quotes respected)', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    type('Command', 'npx -y @modelcontextprotocol/server-filesystem "/Users/me/My Notes"');
    type('Arguments', "--ro '/Volumes/Work Disk'");
    click('Add Server');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const expectedArgs = [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/Users/me/My Notes',
      '--ro',
      '/Volumes/Work Disk',
    ];
    // The dry run and the file get the same split.
    expect(be.validated[0]).toMatchObject({ command: 'npx', args: expectedArgs });
    expect(be.saved).toHaveLength(1);
    expect(be.saved[0].path).toBe(GLOBAL_FILE);
    // Named after the package the runner is given, not after `npx`.
    expect(be.saved[0].configs['server-filesystem']).toEqual({
      command: 'npx',
      args: expectedArgs,
      env: {},
    });
  });

  it('shows stored arguments quoted and saves them back unchanged', async () => {
    const be = backend();
    be.files[GLOBAL_FILE] = JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] } } });
    const args = ['-y', 'pkg', '/Users/me/My Notes', '', 'say "hi"'];
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AddEditServerDialog open onOpenChange={onOpenChange} editServer={server({ args })} />,
    );

    expect((screen.getByLabelText('Arguments') as HTMLInputElement).value).toBe(
      '-y pkg "/Users/me/My Notes" "" "say \\"hi\\""',
    );
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.saved[0].configs.files.args).toEqual(args);
  });

  it('keeps a program path with spaces as one command when editing', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AddEditServerDialog
        open
        onOpenChange={onOpenChange}
        editServer={server({ command: '/Applications/My Tool/bin/server', args: ['--stdio'] })}
      />,
    );

    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.saved[0].configs.files).toMatchObject({
      command: '/Applications/My Tool/bin/server',
      args: ['--stdio'],
    });
  });

  it('saves the working directory as cwd and sends it to the dry run', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    type('Command', 'node server.js');
    type('Working directory (optional)', '~/code/my server');
    type('Display Name', 'mine');
    click('Add Server');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.validated[0]).toMatchObject({ command: 'node', args: ['server.js'], cwd: '~/code/my server' });
    expect(be.saved[0].configs.mine).toEqual({
      command: 'node',
      args: ['server.js'],
      env: {},
      cwd: '~/code/my server',
    });
  });

  it('refuses to add a server under a name the file already has', async () => {
    const be = backend();
    be.files[GLOBAL_FILE] = JSON.stringify({ mcpServers: { git: { command: 'uvx', args: [] } } });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    type('Command', 'npx other');
    type('Display Name', 'git');
    click('Save without testing');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
    });
    expect(be.saved).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('AddEditServerDialog — remote headers', () => {
  it('saves plain and secret headers in the contract shape, the secret in the keychain', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText('Remote (URL)'));
    type('Server URL', 'https://api.example.com/mcp');
    type('Display Name', 'api');

    click('Add');
    click('Add');
    const names = screen.getAllByLabelText('Header name');
    const values = screen.getAllByLabelText('Header value');
    fireEvent.change(names[0], { target: { value: 'X-Tenant' } });
    fireEvent.change(values[0], { target: { value: 'acme' } });
    fireEvent.change(names[1], { target: { value: 'Authorization' } });
    fireEvent.change(values[1], { target: { value: 'Bearer s3cr3t' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Store in keychain' })[1]);

    click('Add Server');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The dry run needs the real values.
    expect(be.validated[0]).toMatchObject({
      transport: 'http',
      url: 'https://api.example.com/mcp',
      headers: { 'X-Tenant': 'acme', Authorization: 'Bearer s3cr3t' },
    });
    // The file gets a reference for the secret, never the value.
    expect(be.saved[0].configs.api).toEqual({
      transport: 'http',
      url: 'https://api.example.com/mcp',
      headers: { 'X-Tenant': 'acme', Authorization: { secret: true } },
      env: {},
    });
    expect(JSON.stringify(be.saved[0].configs)).not.toContain('s3cr3t');
    // Same keychain naming as an env secret, with the header name as the key.
    expect(be.keychain.get('notesage:mcp:global:api:Authorization')).toBe('Bearer s3cr3t');
  });

  it('shows the stored headers of a remote server when editing', async () => {
    const be = backend();
    be.keychain.set('notesage:mcp:global:api:X-Api-Key', 'k-123');
    renderWithProviders(
      <AddEditServerDialog
        open
        onOpenChange={() => {}}
        editServer={server({
          id: 'global:api',
          name: 'api',
          command: '',
          args: [],
          transport: 'http',
          url: 'https://api.example.com/mcp',
          headers: { 'X-Api-Key': { secret: true }, 'X-Tenant': 'acme' },
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByLabelText('Header value').map((el) => (el as HTMLInputElement).value)).toEqual([
        'k-123',
        'acme',
      ]);
    });
    expect(screen.getAllByLabelText('Header name').map((el) => (el as HTMLInputElement).value)).toEqual([
      'X-Api-Key',
      'X-Tenant',
    ]);
  });
});

describe('AddEditServerDialog — test and save', () => {
  it('says a first run may be downloading while the test runs', async () => {
    let finish: (result: McpValidationResult) => void = () => {};
    backend(() => new Promise<McpValidationResult>((resolve) => { finish = resolve; }));
    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);

    type('Command', 'npx -y slow-server');
    click('Test');

    expect(await screen.findByText(/up to two minutes/)).toBeTruthy();
    expect(screen.getByText(/may still be downloading/)).toBeTruthy();
    // Saving as configured does not have to wait for it.
    expect((screen.getByRole('button', { name: 'Save without testing' }) as HTMLButtonElement).disabled).toBe(false);

    finish(okResult());
    await waitFor(() => expect(screen.queryByText(/up to two minutes/)).toBeNull());
  });

  it('after a failed test, "Save without testing" saves the entry as configured and switches it on', async () => {
    const be = backend(() => errResult('Timed out after 120s waiting for the server to respond.', 'timeout'));
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    type('Command', 'npx -y cold-start-server');
    type('Display Name', 'cold');
    click('Add Server');

    // The failed test blocks the tested save and shows what the server said.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Timed out after 120s waiting for the server to respond.');
    });
    expect(be.saved).toHaveLength(0);
    expect(screen.getByText(/A first run often needs longer/)).toBeTruthy();
    fireEvent.click(screen.getByText('Show details'));
    expect(await screen.findByText('npm ERR! 404')).toBeTruthy();

    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.saved[0].configs.cold).toEqual({ command: 'npx', args: ['-y', 'cold-start-server'], env: {} });
    // Switched on (an explicit override) and a rescan requested, which starts it.
    expect(useMcpStore.getState().enabledOverrides['global:cold']).toBe(true);
    expect(useMcpStore.getState().rescanCounter).toBe(1);
  });

  it('"Save without testing" never runs the dry run', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    type('Command', 'uvx mcp-server-time');
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.validated).toHaveLength(0);
    expect(be.saved[0].configs['mcp-server-time']).toMatchObject({ command: 'uvx', args: ['mcp-server-time'] });
  });

  it('a server added in the dialog is started by the discovery pass that follows, although the file says nothing about enabled', async () => {
    const be = backend();
    const started: string[] = [];
    // Discovery reports what is in the file, always switched off.
    setMockInvokeHandler('mcp_discover_configs', () => {
      const raw = be.files[GLOBAL_FILE];
      const servers = raw ? (JSON.parse(raw) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers : {};
      return Object.entries(servers).map(([name, entry]) => ({
        id: `global:${name}`,
        name,
        command: entry.command,
        args: entry.args,
        env: {},
        source: 'notesage_global',
        enabled: false,
        transport: 'stdio',
        url: null,
      }));
    });
    setMockInvokeHandler('mcp_config_problems', () => []);
    setMockInvokeHandler('mcp_start_server', (args) => {
      const config = (args as { config: { id: string } }).config;
      started.push(config.id);
      return { ...config, status: 'running', error: null, tools: [] };
    });
    useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
    useSettingsStore.setState({ startupReady: true });

    function Harness() {
      useMcpDiscovery();
      return <AddEditServerDialog open onOpenChange={() => {}} />;
    }
    renderWithProviders(<Harness />);

    type('Command', 'npx -y time-server');
    type('Display Name', 'time');
    click('Add Server');

    await waitFor(() => expect(started).toEqual(['global:time']));
    await waitFor(() => {
      const added = useMcpStore.getState().getServer('global:time');
      expect(added?.enabled).toBe(true);
      expect(added?.status).toBe('running');
    });
  });
});

describe('AddEditServerDialog — editing', () => {
  it('keeps what is being typed when the edited server\'s status changes underneath it', async () => {
    backend();
    const editing = server({ status: 'error', error: 'boom' });
    const { rerender } = renderWithProviders(
      <AddEditServerDialog open onOpenChange={() => {}} editServer={editing} />,
    );

    type('Arguments', '-y pkg --fixed');
    // An automatic retry: the store hands the card a new object for the same server.
    rerender(<AddEditServerDialog open onOpenChange={() => {}} editServer={{ ...editing, status: 'starting', error: undefined }} />);
    rerender(<AddEditServerDialog open onOpenChange={() => {}} editServer={{ ...editing, status: 'error', error: 'boom again' }} />);

    await waitFor(() => {
      expect((screen.getByLabelText('Arguments') as HTMLInputElement).value).toBe('-y pkg --fixed');
    });
  });

  it('renaming removes the old key and moves the override, the secrets and the running process', async () => {
    const be = backend();
    be.files[GLOBAL_FILE] = JSON.stringify({
      mcpServers: {
        old: { command: 'npx', args: ['-y', 'pkg'], env: { TOKEN: { secret: true }, PLAIN: 'x' } },
        other: { command: 'uvx', args: [] },
      },
    });
    be.keychain.set('notesage:mcp:global:old:TOKEN', 'tok-1');
    const editing = server({
      id: 'global:old',
      name: 'old',
      env: { TOKEN: { secret: true }, PLAIN: 'x' },
      status: 'running',
    });
    useMcpStore.setState({ servers: [editing], enabledOverrides: { 'global:old': true } });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} editServer={editing} />);

    // The stored secret is revealed into the form first.
    await waitFor(() => {
      expect(screen.getAllByLabelText('Variable value').map((el) => (el as HTMLInputElement).value)).toContain('tok-1');
    });
    type('Display Name', 'new');
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const configs = be.saved[0].configs;
    expect(Object.keys(configs).sort()).toEqual(['new', 'other']);
    expect(configs.new).toMatchObject({ command: 'npx', env: { TOKEN: { secret: true }, PLAIN: 'x' } });
    // The secret lives under the new id only.
    expect(be.keychain.get('notesage:mcp:global:new:TOKEN')).toBe('tok-1');
    expect(be.keychain.has('notesage:mcp:global:old:TOKEN')).toBe(false);
    // Still switched on, under the new id.
    expect(useMcpStore.getState().enabledOverrides).toEqual({ 'global:new': true });
    // The process that ran as `global:old` is stopped.
    expect(be.stopped).toEqual(['global:old']);
  });

  it('renaming carries over a secret the form could not reveal', async () => {
    const be = backend();
    be.files[GLOBAL_FILE] = JSON.stringify({
      mcpServers: { old: { command: 'npx', args: [], env: { TOKEN: { secret: true } } } },
    });
    const editing = server({ id: 'global:old', name: 'old', env: { TOKEN: { secret: true } } });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} editServer={editing} />);
    // The keychain entry appears only after the form was filled (it could not
    // be read when the dialog opened), so the value field stays empty.
    await waitFor(() => expect(screen.getByLabelText('Variable value')).toBeTruthy());
    be.keychain.set('notesage:mcp:global:old:TOKEN', 'late');

    type('Display Name', 'new');
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.keychain.get('notesage:mcp:global:new:TOKEN')).toBe('late');
    expect(be.keychain.has('notesage:mcp:global:old:TOKEN')).toBe(false);
  });

  it('renaming a remote server moves its OAuth token to the new id', async () => {
    const be = backend();
    be.files[GLOBAL_FILE] = JSON.stringify({
      mcpServers: { linear: { transport: 'http', url: 'https://mcp.linear.app/mcp' } },
    });
    be.keychain.set('notesage:mcp:global:linear:oauth', 'token-blob');
    const editing = server({
      id: 'global:linear',
      name: 'linear',
      command: '',
      args: [],
      transport: 'http',
      url: 'https://mcp.linear.app/mcp',
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} editServer={editing} />);

    type('Display Name', 'tickets');
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(be.keychain.get('notesage:mcp:global:tickets:oauth')).toBe('token-blob');
    expect(be.keychain.has('notesage:mcp:global:linear:oauth')).toBe(false);
  });

  it('editing a project-scoped server writes the project\'s own mcp.json and keeps the entry\'s other keys', async () => {
    const be = backend();
    const projectFile = '/lib/Work/.notesage/mcp.json';
    be.files[projectFile] = JSON.stringify({
      mcpServers: {
        db: { command: 'node', args: ['db.js'], disabled: true, note: 'kept', type: 'stdio' },
        cache: { command: 'node', args: ['cache.js'] },
      },
    });
    be.files[GLOBAL_FILE] = JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] } } });
    const editing = server({
      id: mcpProjectServerId('/lib/Work', 'db'),
      name: 'db',
      command: 'node',
      args: ['db.js'],
      source: 'notesage-project',
      projectRoot: '/lib/Work',
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} editServer={editing} />);

    expect(screen.getByText(`Saved to ${projectFile}`)).toBeTruthy();
    type('Arguments', 'db.js --readonly');
    click('Save without testing');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // One write, to the project's file; the global file is not touched.
    expect(be.saved.map((call) => call.path)).toEqual([projectFile]);
    expect(be.saved[0].configs).toEqual({
      db: { command: 'node', args: ['db.js', '--readonly'], env: {}, disabled: true, note: 'kept' },
      cache: { command: 'node', args: ['cache.js'] },
    });
    // Editing does not switch a server on.
    expect(useMcpStore.getState().enabledOverrides).toEqual({});
  });
});

describe('AddEditServerDialog — OAuth', () => {
  it('the token ends up under the id the server is saved with, even when the name is typed after authorizing', async () => {
    const be = backend();
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText('Remote (URL)'));
    type('Server URL', 'https://mcp.linear.app/mcp');
    click('Authorize');
    await waitFor(() => expect(be.authorized).toEqual(['global:https://mcp.linear.app/mcp']));
    await screen.findByRole('button', { name: 'Authorized' });

    // Only now does the server get its name.
    type('Display Name', 'linear');
    click('Add Server');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The test ran with the token where it was at that moment...
    expect(be.validated[0]).toMatchObject({ id: 'global:https://mcp.linear.app/mcp' });
    // ...and the save moved it to the server's real id.
    expect(be.keychain.get('notesage:mcp:global:linear:oauth')).toBe('token-blob');
    expect(be.keychain.has('notesage:mcp:global:https://mcp.linear.app/mcp:oauth')).toBe(false);
    expect(be.saved[0].configs.linear).toMatchObject({ transport: 'http', url: 'https://mcp.linear.app/mcp' });
  });
});

describe('AddEditServerDialog — arguments a catalog entry requires', () => {
  const FILESYSTEM: CatalogPrefill = {
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: [],
    transport: 'stdio',
    requiredArgs: [
      { key: 'directory', label: 'Folder the server may access', kind: 'path', required: true },
    ],
  };

  it('asks for the folder, offers a folder picker, and appends the answer to the arguments', async () => {
    const be = backend();
    setMockInvokeHandler('open_folder_dialog', () => '/Users/me/My Notes');
    const onOpenChange = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} prefill={FILESYSTEM} />);

    // Without the folder the server would exit at once: nothing can be added yet.
    const add = screen.getByRole('button', { name: 'Add Server' }) as HTMLButtonElement;
    const saveAnyway = screen.getByRole('button', { name: 'Save without testing' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(saveAnyway.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true);

    click('Choose a folder for Folder the server may access');
    await waitFor(() => {
      expect((screen.getByLabelText(/^Folder the server may access/) as HTMLInputElement).value).toBe(
        '/Users/me/My Notes',
      );
    });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const expectedArgs = ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Notes'];
    expect(be.validated[0]).toMatchObject({ command: 'npx', args: expectedArgs });
    expect(be.saved[0].configs.Filesystem).toEqual({ command: 'npx', args: expectedArgs, env: {} });
  });

  it('puts an optional flagged argument after its flag, and leaves it out when empty', async () => {
    const be = backend();
    const git: CatalogPrefill = {
      name: 'Git',
      command: 'uvx',
      args: ['mcp-server-git'],
      env: [],
      requiredArgs: [
        { key: 'repository', label: 'Git repository', kind: 'path', flag: '--repository', required: false },
      ],
    };
    const first = vi.fn();
    const { unmount } = renderWithProviders(<AddEditServerDialog open onOpenChange={first} prefill={git} />);
    click('Save without testing');
    await waitFor(() => expect(first).toHaveBeenCalledWith(false));
    expect(be.saved[0].configs.Git.args).toEqual(['mcp-server-git']);
    unmount();

    be.files = {};
    const second = vi.fn();
    renderWithProviders(<AddEditServerDialog open onOpenChange={second} prefill={git} />);
    type(/^Git repository/, '/Users/me/code/my repo');
    click('Save without testing');
    await waitFor(() => expect(second).toHaveBeenCalledWith(false));
    expect(be.saved[1].configs.Git.args).toEqual(['mcp-server-git', '--repository', '/Users/me/code/my repo']);
  });
});
