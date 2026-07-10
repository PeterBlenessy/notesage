// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { ToolRow } from '../ToolRow';
import type { McpToolInfo } from '@/stores/mcp-store';

function makeTool(overrides: Partial<McpToolInfo> = {}): McpToolInfo {
  return {
    name: 'search_files',
    description: 'Search the filesystem',
    input_schema: {},
    server_id: 'srv-1',
    ...overrides,
  };
}

describe('ToolRow', () => {
  it('renders the tool name and its description', () => {
    renderWithProviders(<ToolRow tool={makeTool()} />);
    expect(screen.getByText('search_files')).toBeTruthy();
    expect(screen.getByText('Search the filesystem')).toBeTruthy();
  });

  it('renders the name but omits the description paragraph when description is null', () => {
    renderWithProviders(<ToolRow tool={makeTool({ name: 'noop', description: null })} />);
    expect(screen.getByText('noop')).toBeTruthy();
    expect(screen.queryByText('Search the filesystem')).toBeNull();
  });

  it('omits the description paragraph when description is an empty string', () => {
    renderWithProviders(<ToolRow tool={makeTool({ name: 'blank', description: '' })} />);
    expect(screen.getByText('blank')).toBeTruthy();
    expect(screen.queryByText('Search the filesystem')).toBeNull();
  });
});
