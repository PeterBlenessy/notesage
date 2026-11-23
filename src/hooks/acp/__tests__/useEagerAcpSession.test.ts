// @vitest-environment jsdom
//
// Audit 2026-11-22 §2 — the eager session run kept going after a conversation
// switch: it wrote the restored session onto whichever conversation was active
// by then, could pair one conversation's agent with another's stored session,
// and the module lock silently dropped the switched-to conversation's restore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    acpSessionSetConfigOption: vi.fn().mockResolvedValue(undefined),
    acpSessionSetMode: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/ai/acp-session-restore', () => ({
  restoreOrCreateAcpSession: vi.fn(),
}));

vi.mock('@/hooks/acp/session-config', () => ({
  reapplySessionMode: vi.fn(),
  applyConnectionModelOption: vi.fn().mockResolvedValue(undefined),
  cacheAgentModels: vi.fn(),
}));

vi.mock('@/lib/ai/acp-agent-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/acp-agent-state')>();
  return {
    ...actual,
    getAcpAgent: vi.fn(),
    ensureAcpAgent: vi.fn(),
    setSessionModes: vi.fn(),
    setSessionConfigOptions: vi.fn(),
    backfillAcpCapabilities: vi.fn(),
  };
});

import { useEagerAcpSession } from '@/hooks/acp/useEagerAcpSession';
import { restoreOrCreateAcpSession } from '@/lib/ai/acp-session-restore';
import * as acpAgentState from '@/lib/ai/acp-agent-state';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSessionResult } from '@/lib/ai/acp-utils';

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const connection = {
  id: 'conn-acp',
  provider: 'anthropic',
  authMethod: 'agent_managed',
  label: 'Agent',
  credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
  capabilities: ['interactive'],
} as unknown as Connection;

const NO_PATHS: string[] = [];

function session(id: string): AcpSessionResult {
  return { session_id: id, available_models: [], current_model: null, modes: null, config_options: null } as unknown as AcpSessionResult;
}

function seedConversation(id: string, acpSessionId: string) {
  return {
    id,
    title: id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: acpSessionId, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    activeLeafId: null,
    acpSessionId,
  };
}

const storedSession = (convId: string) =>
  useChatStore.getState().conversations.find((c) => c.id === convId)?.acpSessionId;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let agents: Record<string, acpAgentState.AcpAgentState>;

beforeEach(() => {
  vi.clearAllMocks();
  agents = {
    'conv-a': { instanceId: 'inst-conv-a', connectionId: 'conn-acp', sandboxScopeKey: '', configKey: '', chatSessionId: null } as acpAgentState.AcpAgentState,
    'conv-b': { instanceId: 'inst-conv-b', connectionId: 'conn-acp', sandboxScopeKey: '', configKey: '', chatSessionId: null } as acpAgentState.AcpAgentState,
  };
  vi.mocked(acpAgentState.getAcpAgent).mockImplementation(
    (id?: string | null) => (id ? agents[id] : undefined) as acpAgentState.AcpAgentState,
  );
  vi.mocked(acpAgentState.ensureAcpAgent).mockImplementation(
    async (_conn, _cwd, _scope, _reason, opts) => `inst-${opts?.conversationId}`,
  );
  useChatStore.setState({
    conversations: [seedConversation('conv-a', 'sess-a-stored'), seedConversation('conv-b', 'sess-b-stored')],
    activeConversationId: 'conv-a',
  });
});

function renderEager() {
  return renderHook(
    ({ convId }: { convId: string }) =>
      useEagerAcpSession({ effectiveConnection: connection, selectedProjectPaths: NO_PATHS, activeConversationId: convId }),
    { initialProps: { convId: 'conv-a' } },
  );
}

function switchTo(hook: ReturnType<typeof renderEager>, convId: string) {
  act(() => {
    useChatStore.getState().setActiveConversation(convId);
    hook.rerender({ convId });
  });
}

describe('useEagerAcpSession — conversation switch mid-flight', () => {
  it('writes a late restore to its own conversation, then restores the one switched to', async () => {
    const restoreA = deferred<AcpSessionResult>();
    vi.mocked(restoreOrCreateAcpSession)
      .mockImplementationOnce(() => restoreA.promise)
      .mockImplementationOnce(async () => session('sess-b-restored'));

    const hook = renderEager();
    await settle();
    expect(restoreOrCreateAcpSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(restoreOrCreateAcpSession).mock.calls[0][0]).toMatchObject({
      instanceId: 'inst-conv-a',
      storedSessionId: 'sess-a-stored',
    });

    // The user switches to B while A's restore is still in flight.
    switchTo(hook, 'conv-b');
    await settle();

    await act(async () => {
      restoreA.resolve(session('sess-a-restored'));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();

    // A's session landed on A — `setSegmentSessionId` used to be called with
    // no conversation id and wrote it onto the active one (B).
    expect(storedSession('conv-a')).toBe('sess-a-restored');
    expect(agents['conv-a'].chatSessionId).toBe('sess-a-restored');
    // Only B's run fed the pickers; A's did not touch the conversation on screen.
    expect(acpAgentState.setSessionModes).toHaveBeenCalledTimes(1);

    // B got its own restore once the lock cleared — it used to be dropped.
    expect(restoreOrCreateAcpSession).toHaveBeenCalledTimes(2);
    expect(vi.mocked(restoreOrCreateAcpSession).mock.calls[1][0]).toMatchObject({
      instanceId: 'inst-conv-b',
      storedSessionId: 'sess-b-stored',
    });
    expect(storedSession('conv-b')).toBe('sess-b-restored');
    expect(agents['conv-b'].chatSessionId).toBe('sess-b-restored');

    hook.unmount();
  });

  it('never restores one conversation\'s stored session onto another conversation\'s agent', async () => {
    const spawnA = deferred<string>();
    vi.mocked(acpAgentState.ensureAcpAgent)
      .mockImplementationOnce(() => spawnA.promise)
      .mockImplementation(async (_conn, _cwd, _scope, _reason, opts) => `inst-${opts?.conversationId}`);
    vi.mocked(restoreOrCreateAcpSession).mockImplementation(async (args) => session(`${args.storedSessionId}-restored`));

    const hook = renderEager();
    await settle();
    expect(acpAgentState.ensureAcpAgent).toHaveBeenCalledTimes(1);

    // Switch during A's agent spawn. The run used to re-read "the active
    // conversation" after this await and take B's stored session for A's agent.
    switchTo(hook, 'conv-b');
    await settle();
    await act(async () => {
      spawnA.resolve('inst-conv-a');
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();

    const pairings = vi.mocked(restoreOrCreateAcpSession).mock.calls.map(([args]) => [args.instanceId, args.storedSessionId]);
    expect(pairings).not.toContainEqual(['inst-conv-a', 'sess-b-stored']);
    expect(pairings).toContainEqual(['inst-conv-b', 'sess-b-stored']);
    // A was left as it was: its run stopped at the first await after the switch.
    expect(storedSession('conv-a')).toBe('sess-a-stored');
    expect(storedSession('conv-b')).toBe('sess-b-stored-restored');

    hook.unmount();
  });

  it('does not overwrite a session a send bound while the restore was in flight', async () => {
    const restoreA = deferred<AcpSessionResult>();
    vi.mocked(restoreOrCreateAcpSession).mockImplementationOnce(() => restoreA.promise);

    const hook = renderEager();
    await settle();

    // The user sends immediately; the send path creates and binds its session.
    agents['conv-a'].chatSessionId = 'sess-from-send';
    await act(async () => {
      restoreA.resolve(session('sess-a-restored'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(agents['conv-a'].chatSessionId).toBe('sess-from-send');
    expect(storedSession('conv-a')).toBe('sess-a-stored');

    hook.unmount();
  });
});
