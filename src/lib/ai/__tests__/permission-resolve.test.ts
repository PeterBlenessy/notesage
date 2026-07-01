import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { usePermissionStore, type PermissionRequest } from '@/stores/permission-store';
import { useChatStore } from '@/stores/chat-store';
import { resolveAcpPermission, resolveDirectPermission } from '@/lib/ai/permission-resolve';
import type { PendingToolPermission } from '@/stores/tool-permission-store';

function makeAcp(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'req-1',
    instanceId: 'inst-1',
    sessionId: 'sess-1',
    requestId: 'rq-1',
    toolKind: 'write',
    toolTitle: 'Write file',
    toolInput: '/p/x',
    options: [{ optionId: 'opt-allow', kind: 'allow', name: 'Allow' }],
    timestamp: 1,
    conversationId: 'conv-A',
    ...overrides,
  };
}

beforeEach(() => {
  usePermissionStore.setState({ requests: [], sessionAllowed: new Set(), alwaysAllowed: [] });
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

describe('resolveAcpPermission (task #10)', () => {
  it('allow → responds with the first option and removes the request', () => {
    const calls: Record<string, unknown>[] = [];
    setMockInvokeHandler('acp_permission_respond', (args) => { calls.push(args as Record<string, unknown>); });
    const req = makeAcp();
    usePermissionStore.getState().addRequest(req);

    resolveAcpPermission(req, 'allow', 'Write file');

    expect(calls[0]).toMatchObject({ requestId: 'rq-1', optionId: 'opt-allow' });
    expect(usePermissionStore.getState().requests).toHaveLength(0);
  });

  it('deny → responds with null option, posts a denial message, removes the request', () => {
    const calls: Record<string, unknown>[] = [];
    setMockInvokeHandler('acp_permission_respond', (args) => { calls.push(args as Record<string, unknown>); });
    useChatStore.getState().createConversation();
    const req = makeAcp();
    usePermissionStore.getState().addRequest(req);

    resolveAcpPermission(req, 'deny', 'Write file');

    expect(calls[0]).toMatchObject({ requestId: 'rq-1', optionId: null });
    expect(usePermissionStore.getState().requests).toHaveLength(0);
    const msgs = useChatStore.getState().conversations[0].messages;
    expect(msgs[msgs.length - 1]?.content).toContain('was denied');
  });

  it('session → persists the tool kind and clears every pending request of that kind', () => {
    setMockInvokeHandler('acp_permission_respond', () => {});
    usePermissionStore.getState().addRequest(makeAcp({ id: 'a', requestId: 'a' }));
    usePermissionStore.getState().addRequest(makeAcp({ id: 'b', requestId: 'b' }));

    resolveAcpPermission(makeAcp({ id: 'a', requestId: 'a' }), 'session', 'Write file');

    expect(usePermissionStore.getState().sessionAllowed.has('write')).toBe(true);
    expect(usePermissionStore.getState().requests).toHaveLength(0);
  });
});

describe('resolveDirectPermission (task #10)', () => {
  it('forwards the tier to the pending request resolve callback', () => {
    const resolve = vi.fn();
    const pending: PendingToolPermission = { id: 't1', name: 'write_file', arguments: {}, resolve, conversationId: 'conv-A' };
    resolveDirectPermission(pending, 'session');
    expect(resolve).toHaveBeenCalledWith('session');
  });
});
