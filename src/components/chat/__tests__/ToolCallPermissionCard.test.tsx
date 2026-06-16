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
