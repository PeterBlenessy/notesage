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
import { ImportDialog } from '../ImportDialog';

function config(name: string) {
  return {
    id: `claude_desktop:${name}`,
    name,
    command: 'npx',
    args: ['-y', `@modelcontextprotocol/server-${name}`],
    env: {},
    source: 'claude_desktop',
    enabled: true,
  };
}

describe('ImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeHandlers();
  });

  it('enables only installed sources and marks the rest "Not installed"', async () => {
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);

    renderWithProviders(<ImportDialog open onOpenChange={() => {}} />);

    const claude = await screen.findByText('Claude Desktop');
    // Two of the three sources are unavailable → the "Not installed" hint renders twice.
    await waitFor(() => {
      expect(screen.getAllByText('Not installed')).toHaveLength(2);
    });
    // The available source button is enabled; an unavailable one is disabled.
    const claudeBtn = claude.closest('button') as HTMLButtonElement;
    const cursorBtn = screen.getByText('Cursor').closest('button') as HTMLButtonElement;
    expect(claudeBtn.disabled).toBe(false);
    expect(cursorBtn.disabled).toBe(true);
  });

  it('lists discovered servers and reflects checkbox toggles in the Import button count', async () => {
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);
    setMockInvokeHandler('mcp_import_configs', () => [config('filesystem'), config('git')]);

    renderWithProviders(<ImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByText('Claude Desktop'));

    await waitFor(() => {
      expect(screen.getByText(/Found 2 servers/)).toBeTruthy();
    });
    // Both selected by default.
    expect(screen.getByRole('button', { name: /Import 2 Servers/ })).toBeTruthy();

    // Uncheck the first server → count drops to 1 (singular).
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import 1 Server$/ })).toBeTruthy();
    });
  });

  it('merges selected servers into the global config and closes on import', async () => {
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);
    setMockInvokeHandler('mcp_import_configs', () => [config('filesystem')]);
    setMockInvokeHandler('get_home_dir', () => '/home/tester');
    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('read_file', () => {
      throw new Error('ENOENT');
    });
    const saved: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('mcp_save_config', (args) => {
      saved.push(args ?? {});
      return undefined;
    });
    const onOpenChange = vi.fn();

    renderWithProviders(<ImportDialog open onOpenChange={onOpenChange} />);
    fireEvent.click(await screen.findByText('Claude Desktop'));
    await screen.findByText(/Found 1 server/);

    fireEvent.click(screen.getByRole('button', { name: /Import 1 Server/ }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(saved).toHaveLength(1);
    const configs = saved[0].configs as Record<string, { command: string }>;
    expect(configs.filesystem.command).toBe('npx');
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Imported 1 server/));
  });

  /** Open the dialog on one discovered server, with `raw` as the mcp.json on disk. */
  async function importWithExistingFile(raw: string) {
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);
    setMockInvokeHandler('mcp_import_configs', () => [config('filesystem')]);
    setMockInvokeHandler('get_home_dir', () => '/home/tester');
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('read_file', () => raw);
    const saved: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('mcp_save_config', (args) => {
      saved.push(args ?? {});
      return undefined;
    });
    const onOpenChange = vi.fn();

    renderWithProviders(<ImportDialog open onOpenChange={onOpenChange} />);
    fireEvent.click(await screen.findByText('Claude Desktop'));
    await screen.findByText(/Found 1 server/);
    fireEvent.click(screen.getByRole('button', { name: /Import 1 Server/ }));
    return { saved, onOpenChange };
  }

  it('keeps the servers already in mcp.json when importing', async () => {
    const { saved, onOpenChange } = await importWithExistingFile(
      JSON.stringify({ mcpServers: { git: { command: 'uvx', args: [], env: {} } } }),
    );

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(Object.keys(saved[0].configs as Record<string, unknown>).sort()).toEqual(['filesystem', 'git']);
  });

  it.each([
    ['invalid JSON', '{ "mcpServers": { "git": {} '],
    ['a non-object mcpServers', '{ "mcpServers": "git" }'],
  ])('does not overwrite an mcp.json with %s: it toasts and stays open', async (_label, raw) => {
    const { saved, onOpenChange } = await importWithExistingFile(raw);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/mcp\.json could not be read/));
    });
    expect(saved).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('returns to the source list from the Back button', async () => {
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);
    setMockInvokeHandler('mcp_import_configs', () => [config('filesystem')]);

    renderWithProviders(<ImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByText('Claude Desktop'));
    await screen.findByText(/Found 1 server/);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    // Back on the source-picker screen — the "Found N servers" summary is gone.
    await waitFor(() => {
      expect(screen.queryByText(/Found 1 server/)).toBeNull();
    });
    expect(screen.getByText('Claude Desktop')).toBeTruthy();
  });
});
