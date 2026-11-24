// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { render, act } from '@/test/component-harness';
import { ToolCallPermissionCard } from '../ToolCallPermissionCard';
import { useSessionRunStore } from '@/stores/session-run-store';
import type { PendingToolPermission } from '@/stores/tool-permission-store';

function makeRequest(overrides: Partial<PendingToolPermission> = {}): PendingToolPermission {
  return {
    id: 'tc-1',
    name: 'write_file',
    arguments: { path: '/p/x' },
    resolve: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('ToolCallPermissionCard — foreground-aware auto-deny (task #7)', () => {
  it('auto-denies after 30s when the request is for the foreground conversation', () => {
    useSessionRunStore.setState({ foregroundConversationId: 'conv-A' });
    const resolve = vi.fn();
    render(<ToolCallPermissionCard request={makeRequest({ conversationId: 'conv-A', resolve })} />);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(resolve).toHaveBeenCalledWith('deny');
  });

  it('does NOT auto-deny when the request is for a backgrounded conversation', () => {
    useSessionRunStore.setState({ foregroundConversationId: 'conv-A' });
    const resolve = vi.fn();
    // Request belongs to conv-B, but conv-A is foreground → no countdown.
    render(<ToolCallPermissionCard request={makeRequest({ conversationId: 'conv-B', resolve })} />);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats a request with no conversationId as foreground (legacy behavior)', () => {
    const resolve = vi.fn();
    render(<ToolCallPermissionCard request={makeRequest({ conversationId: null, resolve })} />);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(resolve).toHaveBeenCalledWith('deny');
  });
});

describe('ToolCallPermissionCard — MCP tool calls', () => {
  const mcpRequest = () =>
    makeRequest({
      name: 'mcp__My_Server__files_read',
      arguments: { path: '/notes/a.md', recursive: true },
      mcp: { serverName: 'My Server', toolName: 'files/read' },
    });

  it('names the server and the original tool, and shows the arguments', () => {
    const { container, getByTestId } = render(<ToolCallPermissionCard request={mcpRequest()} />);
    expect(getByTestId('mcp-tool-name').textContent).toBe('MCP tool call: files/read');
    expect(getByTestId('mcp-server-name').textContent).toBe('MCP server: My Server');
    expect(container.querySelector('pre')?.textContent).toBe('path: /notes/a.md\nrecursive: true');
    // The model-facing identifier is not what the user is asked about.
    expect(container.textContent).not.toContain('mcp__My_Server__files_read');
  });

  it('keeps the plain label for a built-in tool', () => {
    const { container, queryByTestId } = render(<ToolCallPermissionCard request={makeRequest()} />);
    expect(queryByTestId('mcp-server-name')).toBeNull();
    expect(container.textContent).toContain('Tool call: write_file');
  });

  it('confirms the decision with the server and tool name', () => {
    const request = mcpRequest();
    const { container } = render(<ToolCallPermissionCard request={request} />);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(request.resolve).toHaveBeenCalledWith('deny');
    expect(container.textContent).toContain('"My Server: files/read" timed out');
  });
});
