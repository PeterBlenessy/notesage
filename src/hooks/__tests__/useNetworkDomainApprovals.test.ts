// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

// Control the ACP agent registry so we can map an instance → conversation + connection.
vi.mock('@/lib/ai/acp-agent-state', () => ({
  DEFAULT_AGENT_KEY: '__default__',
  TASK_AGENT_KEY: '__task__',
  getAllAcpAgentEntries: vi.fn(() => [] as Array<[string, { instanceId: string; connectionId: string }]>),
}));

import { useNetworkDomainApprovals } from '@/hooks/useNetworkDomainApprovals';
import * as acpAgentState from '@/lib/ai/acp-agent-state';
import { usePermissionStore } from '@/stores/permission-store';
import { useDomainRequestStore } from '@/stores/domain-request-store';
import { useSessionRunStore } from '@/stores/session-run-store';

function setRegistry(entries: Array<[string, { instanceId: string; connectionId: string }]>): void {
  vi.mocked(acpAgentState.getAllAcpAgentEntries).mockReturnValue(
    entries as unknown as ReturnType<typeof acpAgentState.getAllAcpAgentEntries>,
  );
}

function emitRequest(over: Partial<{ instanceId: string; agentId: string; domain: string; port: number; requestId: string }> = {}) {
  emitMockEvent('network-domain-request', {
    instanceId: 'inst-1',
    agentId: 'claude-agent-acp',
    domain: 'telemetry.example.com',
    port: 443,
    requestId: 'req-1',
    ...over,
  });
}

beforeEach(() => {
  setMockInvokeHandler('network_domain_respond', () => undefined);
  setRegistry([['conv-A', { instanceId: 'inst-1', connectionId: 'conn-x' }]]);
  useDomainRequestStore.setState({ requests: [] });
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  usePermissionStore.setState({ domainAlwaysAllowed: {}, domainSessionAllowed: {} } as Partial<ReturnType<typeof usePermissionStore.getState>>);
  vi.mocked(invoke).mockClear();
});

describe('useNetworkDomainApprovals', () => {
  it('auto-approves a domain already in the connection allowlist (no card)', () => {
    usePermissionStore.setState({
      domainAlwaysAllowed: { 'conn-x': { global: ['telemetry.example.com'] } },
    } as Partial<ReturnType<typeof usePermissionStore.getState>>);

    renderHook(() => useNetworkDomainApprovals());
    emitRequest();

    expect(invoke).toHaveBeenCalledWith('network_domain_respond', {
      instanceId: 'inst-1',
      requestId: 'req-1',
      decision: 'allow_once',
    });
    expect(useDomainRequestStore.getState().requests).toHaveLength(0);
  });

  it('auto-approves a built-in provider domain even with no connection match', () => {
    setRegistry([]); // instance not in registry → connectionId null
    renderHook(() => useNetworkDomainApprovals());
    emitRequest({ domain: 'api.anthropic.com', requestId: 'req-builtin' });

    expect(invoke).toHaveBeenCalledWith('network_domain_respond', expect.objectContaining({ decision: 'allow_once' }));
    expect(useDomainRequestStore.getState().requests).toHaveLength(0);
  });

  it('parks an unknown domain as a card (no auto-approve)', () => {
    renderHook(() => useNetworkDomainApprovals());
    emitRequest({ domain: 'sketchy.example.com', requestId: 'req-2' });

    expect(invoke).not.toHaveBeenCalled();
    const reqs = useDomainRequestStore.getState().requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ domain: 'sketchy.example.com', connectionId: 'conn-x' });
  });

  it('flips the owning conversation to awaiting_permission when it has a live turn (orb/history parity)', () => {
    useSessionRunStore.getState().setRun('conv-A', { status: 'running', path: 'acp', startedAt: 1 });
    renderHook(() => useNetworkDomainApprovals());
    emitRequest({ domain: 'sketchy.example.com', requestId: 'req-3' });

    expect(useSessionRunStore.getState().runs['conv-A']?.status).toBe('awaiting_permission');
  });

  it('does NOT create a run for a conversation with no live turn (eager-spawn telemetry)', () => {
    renderHook(() => useNetworkDomainApprovals());
    emitRequest({ domain: 'sketchy.example.com', requestId: 'req-4' });

    // Card is parked, but no phantom run is created.
    expect(useDomainRequestStore.getState().requests).toHaveLength(1);
    expect(useSessionRunStore.getState().runs['conv-A']).toBeUndefined();
  });

  it('removes a card when the proxy resolves it (timeout/deny)', () => {
    renderHook(() => useNetworkDomainApprovals());
    emitRequest({ domain: 'sketchy.example.com', requestId: 'req-5' });
    expect(useDomainRequestStore.getState().requests).toHaveLength(1);

    emitMockEvent('network-domain-resolved', { requestId: 'req-5' });
    expect(useDomainRequestStore.getState().requests).toHaveLength(0);
  });
});
