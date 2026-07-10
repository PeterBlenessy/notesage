// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { clearMockInvokeHandlers } from '@/test/tauri-mock';
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
});
