// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { render, screen, fireEvent } from '@/test/component-harness';
import { InlineHistoryPermission } from '../InlineHistoryPermission';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore } from '@/stores/tool-permission-store';
import { useChatStore } from '@/stores/chat-store';

beforeEach(() => {
  usePermissionStore.setState({ requests: [], sessionAllowed: new Set(), alwaysAllowed: [] });
  useToolPermissionStore.setState({ pending: null });
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

describe('InlineHistoryPermission (task #10)', () => {
  it('renders nothing when the conversation has no pending request', () => {
    const { container } = render(<InlineHistoryPermission conversationId="conv-A" />);
    expect(container.firstChild).toBeNull();
  });

  it('resolves a direct-API request inline via Allow', () => {
    const resolve = vi.fn();
    useToolPermissionStore.setState({
      pending: { id: 't1', name: 'write_file', arguments: { path: '/p/x' }, resolve, conversationId: 'conv-A' },
    });
    render(<InlineHistoryPermission conversationId="conv-A" />);
    expect(screen.getByTestId('inline-history-permission')).toBeTruthy();

    fireEvent.click(screen.getByText('Allow'));
    expect(resolve).toHaveBeenCalledWith('allow');
  });

  it('does not show a direct request that belongs to another conversation', () => {
    useToolPermissionStore.setState({
      pending: { id: 't1', name: 'write_file', arguments: {}, resolve: vi.fn(), conversationId: 'conv-OTHER' },
    });
    const { container } = render(<InlineHistoryPermission conversationId="conv-A" />);
    expect(container.firstChild).toBeNull();
  });

  it('resolves an ACP request inline via Deny (responds null + removes request)', () => {
    const calls: Record<string, unknown>[] = [];
    setMockInvokeHandler('acp_permission_respond', (args) => { calls.push(args as Record<string, unknown>); });
    useChatStore.getState().createConversation();
    usePermissionStore.getState().addRequest({
      id: 'r1', instanceId: 'inst-1', sessionId: 'sess-1', requestId: 'rq-1',
      toolKind: 'write', toolTitle: 'Write file', toolInput: '/p/x',
      options: [{ optionId: 'opt-allow', kind: 'allow', name: 'Allow' }],
      timestamp: 1, conversationId: 'conv-A',
    });

    render(<InlineHistoryPermission conversationId="conv-A" />);
    fireEvent.click(screen.getByText('Deny'));

    expect(calls[0]).toMatchObject({ requestId: 'rq-1', optionId: null });
    expect(usePermissionStore.getState().requests).toHaveLength(0);
  });
});
