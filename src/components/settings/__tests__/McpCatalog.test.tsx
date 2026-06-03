// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/component-harness';
import { setMockInvokeHandler, clearMockInvokeHandlers } from '@/test/tauri-mock';
import { McpCatalog } from '@/components/settings/McpCatalog';
import type { McpCatalogItem } from '@/stores/mcp-store';

const LOCAL_ITEM: McpCatalogItem = {
  id: 'filesystem',
  name: 'Filesystem',
  description: 'Read and write files in a directory',
  category: 'Files',
  homepage: 'https://example.com',
  official: true,
  transport: 'stdio',
  url: null,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  required_env: [],
};

const REMOTE_ITEM: McpCatalogItem = {
  id: 'remote',
  name: 'Remote Server',
  description: 'A hosted MCP server',
  category: null,
  homepage: null,
  transport: 'http',
  url: 'https://mcp.example.com',
  command: null,
  args: [],
  required_env: [],
};

beforeEach(() => {
  clearMockInvokeHandlers();
});

describe('McpCatalog', () => {
  it('shows the empty state when the catalog has no entries', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => []);
    renderWithProviders(<McpCatalog open onOpenChange={() => {}} onSelectItem={() => {}} />);

    expect(await screen.findByText('The catalog is empty')).toBeTruthy();
  });

  it('renders entries and calls onSelectItem when a local server is added', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => [LOCAL_ITEM]);
    const onSelectItem = vi.fn();
    renderWithProviders(<McpCatalog open onOpenChange={() => {}} onSelectItem={onSelectItem} />);

    const addButton = await screen.findByRole('button', { name: /add/i });
    fireEvent.click(addButton);
    expect(onSelectItem).toHaveBeenCalledWith(LOCAL_ITEM);
  });

  it('shows an Official badge and "No API key" for official no-key entries', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => [LOCAL_ITEM]);
    renderWithProviders(<McpCatalog open onOpenChange={() => {}} onSelectItem={() => {}} />);

    await screen.findByText('Filesystem');
    expect(screen.getByText('Official')).toBeTruthy();
    expect(screen.getByText('No API key')).toBeTruthy();
  });

  it('lets remote (http) entries be added', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => [REMOTE_ITEM]);
    const onSelectItem = vi.fn();
    renderWithProviders(<McpCatalog open onOpenChange={() => {}} onSelectItem={onSelectItem} />);

    const addButton = (await screen.findByRole('button', { name: /add/i })) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);
    expect(onSelectItem).toHaveBeenCalledWith(REMOTE_ITEM);
  });

  it('filters entries by the search query', async () => {
    setMockInvokeHandler('mcp_catalog_list', () => [LOCAL_ITEM, REMOTE_ITEM]);
    renderWithProviders(<McpCatalog open onOpenChange={() => {}} onSelectItem={() => {}} />);

    await screen.findByText('Filesystem');
    fireEvent.change(screen.getByPlaceholderText('Search servers…'), {
      target: { value: 'remote' },
    });

    await waitFor(() => {
      expect(screen.queryByText('Filesystem')).toBeNull();
    });
    expect(screen.getByText('Remote Server')).toBeTruthy();
  });
});
