// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/component-harness';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  registerDefaultHandlers,
} from '@/test/tauri-mock';
import { toast } from 'sonner';
import { ImportDialog } from '@/components/settings/McpServersSettings';

const VALID_CONFIG = {
  id: 'claude_desktop:filesystem',
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {},
  source: 'claude_desktop',
  enabled: true,
};

describe('ImportDialog — foreign config validation (mcp_import_configs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeHandlers();
    registerDefaultHandlers();
    setMockInvokeHandler('mcp_check_import_sources', () => ['claude-desktop']);
  });

  it('drops malformed entries, toasts a skip count, and lists the valid server', async () => {
    setMockInvokeHandler('mcp_import_configs', () => [
      VALID_CONFIG,
      { id: 'claude_desktop:broken', name: 'broken' }, // missing args/env/source/enabled
      'junk-string',
    ]);

    renderWithProviders(<ImportDialog open onOpenChange={() => {}} />);

    const sourceButton = await screen.findByText('Claude Desktop');
    fireEvent.click(sourceButton);

    // Only the valid server survives validation
    await waitFor(() => {
      expect(screen.getByText('filesystem')).toBeTruthy();
    });
    expect(screen.queryByText('broken')).toBeNull();
    expect(screen.getByText(/Found 1 server/)).toBeTruthy();

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/Skipped 2 malformed server entries/),
    );
  });

  it('does not throw when the command returns a non-array payload', async () => {
    setMockInvokeHandler('mcp_import_configs', () => ({ not: 'an array' }));

    renderWithProviders(<ImportDialog open onOpenChange={() => {}} />);

    fireEvent.click(await screen.findByText('Claude Desktop'));

    await waitFor(() => {
      expect(screen.getByText('No MCP servers found')).toBeTruthy();
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
