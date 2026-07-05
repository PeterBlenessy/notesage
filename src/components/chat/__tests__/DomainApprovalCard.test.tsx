// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { render, screen, setMockInvokeHandler } from '@/test/component-harness';
import userEvent from '@testing-library/user-event';
import { DomainApprovalCard, type DomainApprovalRequest } from '../DomainApprovalCard';
import { usePermissionStore } from '@/stores/permission-store';
import { useChatStore } from '@/stores/chat-store';

function makeRequest(overrides: Partial<DomainApprovalRequest> = {}): DomainApprovalRequest {
  return {
    instanceId: 'inst-1',
    agentId: 'claude-agent-acp',
    domain: 'api.custom.dev',
    port: 443,
    requestId: 'req-1',
    connectionId: 'conn-1',
    ...overrides,
  };
}

interface RespondArgs {
  instanceId: string;
  requestId: string;
  decision: string;
}

describe('DomainApprovalCard', () => {
  let respondCalls: RespondArgs[];

  beforeEach(() => {
    respondCalls = [];
    setMockInvokeHandler('network_domain_respond', (args) => {
      respondCalls.push(args as unknown as RespondArgs);
      return undefined;
    });
    usePermissionStore.setState({
      domainAlwaysAllowed: {},
      domainSessionAllowed: {},
    });
    useChatStore.setState({ conversations: [], activeConversationId: null });
  });

  async function openDropdownAndClick(label: string) {
    const user = userEvent.setup();
    // The split-button dropdown trigger is the chevron button (no accessible
    // name of its own) — grab it via the trigger's haspopup attribute.
    const trigger = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-haspopup') === 'menu');
    expect(trigger).toBeDefined();
    await user.click(trigger!);
    await user.click(await screen.findByText(label));
  }

  it('"Allow always" responds allow_always AND persists the domain scoped to the connection (global bucket)', async () => {
    render(<DomainApprovalCard request={makeRequest()} onResolved={() => {}} />);

    await openDropdownAndClick('Allow always');

    // Backend told to allow this request permanently for the live proxy…
    expect(respondCalls).toEqual([
      { instanceId: 'inst-1', requestId: 'req-1', decision: 'allow_always' },
    ]);
    // …and the grant is persisted frontend-side in the permission store
    // (this is what survives restart and feeds the spawn allowlist +
    // useNetworkDomainApprovals auto-approve).
    const persisted = usePermissionStore.getState().domainAlwaysAllowed;
    expect(persisted['conn-1']?.global).toContain('api.custom.dev');
    // Session list untouched — always-tier writes go to the persisted bucket.
    expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).toBeUndefined();
  });

  it('"Allow for this session" responds allow_session and writes ONLY the session list (not persisted)', async () => {
    render(<DomainApprovalCard request={makeRequest()} onResolved={() => {}} />);

    await openDropdownAndClick('Allow for this session');

    expect(respondCalls).toEqual([
      { instanceId: 'inst-1', requestId: 'req-1', decision: 'allow_session' },
    ]);
    expect(usePermissionStore.getState().domainSessionAllowed['conn-1']).toContain(
      'api.custom.dev',
    );
    expect(usePermissionStore.getState().domainAlwaysAllowed['conn-1']).toBeUndefined();
  });

  it('"Allow" (once) responds allow_once and persists nothing', async () => {
    const user = userEvent.setup();
    render(<DomainApprovalCard request={makeRequest()} onResolved={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Allow' }));

    expect(respondCalls).toEqual([
      { instanceId: 'inst-1', requestId: 'req-1', decision: 'allow_once' },
    ]);
    expect(usePermissionStore.getState().domainAlwaysAllowed).toEqual({});
    expect(usePermissionStore.getState().domainSessionAllowed).toEqual({});
  });

  it('"Deny" responds deny and persists nothing', async () => {
    const user = userEvent.setup();
    render(<DomainApprovalCard request={makeRequest()} onResolved={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));

    expect(respondCalls).toEqual([
      { instanceId: 'inst-1', requestId: 'req-1', decision: 'deny' },
    ]);
    expect(usePermissionStore.getState().domainAlwaysAllowed).toEqual({});
  });
});
