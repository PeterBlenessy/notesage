// @vitest-environment jsdom
//
// Regression tests for the ACP findings of the 2026-11-22 audit (§2):
//   - retry targets the FAILED conversation (prompt, history, session);
//   - Stop during agent cold-spawn / session creation / listener setup stops
//     the send instead of being ignored;
//   - cancel escalation is per conversation;
//   - several mounted `useAcpLifecycle` instances share the unresponsive
//     monitor without disabling each other.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { useSessionRunStore } from '@/stores/session-run-store';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    acpSessionSetMode: vi.fn().mockResolvedValue(undefined),
    acpSessionSetConfigOption: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/useAcpSessionListeners', () => ({
  setupAcpChatListeners: vi.fn(),
  buildAcpChatCleanup: vi.fn(),
}));

vi.mock('@/lib/ai/acp-agent-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/acp-agent-state')>();
  return {
    ...actual,
    getAcpAgent: vi.fn(() => null),
    getAllAcpAgents: vi.fn(() => []),
    getAllAcpAgentEntries: vi.fn(() => []),
    stopAcpAgent: vi.fn(),
    stopAllAcpAgents: vi.fn(),
    ensureAcpAgent: vi.fn().mockResolvedValue('inst-1'),
    updateAcpAgentInstanceId: vi.fn(),
  };
});

import { useAcpLifecycle, getRetryCallback } from '@/hooks/useAcpLifecycle';
import { UNRESPONSIVE_TIMEOUT_MS, clearUnresponsiveTimer } from '@/hooks/acp/unresponsive-monitor';
import { setupAcpChatListeners, buildAcpChatCleanup } from '@/hooks/useAcpSessionListeners';
import * as acpAgentState from '@/lib/ai/acp-agent-state';
import type { Connection } from '@/lib/ai/connections';
import type { ChatMessage } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    label: 'Test Agent',
    capabilities: ['interactive', 'agent_tasks'],
    addedAt: Date.now(),
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
  } as unknown as Connection;
}

function makeAgent(instanceId: string, chatSessionId: string | null = null): acpAgentState.AcpAgentState {
  return { instanceId, connectionId: 'conn-test', sandboxScopeKey: '', configKey: '', chatSessionId } as acpAgentState.AcpAgentState;
}

function seedConversation(id: string, prior?: { question: string; answer: string }) {
  const messages: ChatMessage[] = prior
    ? [
        { id: `${id}-u0`, role: 'user', content: prior.question, timestamp: 10, parentId: null },
        { id: `${id}-a0`, role: 'assistant', content: prior.answer, timestamp: 11, parentId: `${id}-u0` },
      ]
    : [];
  return {
    id,
    title: id,
    messages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    activeLeafId: prior ? `${id}-a0` : null,
  };
}

function renderLifecycle() {
  const connection = makeConnection();
  return renderHook(() => useAcpLifecycle({ effectiveConnection: connection, acpSystemMessage: 'sys' }));
}

const flushAsync = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const invokesOf = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);
const assistantOf = (convId: string) =>
  useChatStore.getState().conversations.find((c) => c.id === convId)?.messages
    .filter((m) => m.role === 'assistant').slice(-1)[0];

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Listener handles as `setupAcpChatListeners` returns them. */
function makeListeners() {
  return { unlisten: vi.fn(), unlistenPermission: vi.fn(), getStreamedContent: () => '', flush: vi.fn() };
}

let sessionCounter = 0;

beforeEach(() => {
  sessionCounter = 0;
  useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  usePermissionStore.setState({ requests: [] });
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  useAgentStatusStore.getState().clearStatus();

  vi.mocked(setupAcpChatListeners).mockReset();
  vi.mocked(setupAcpChatListeners).mockImplementation(async () => makeListeners());
  vi.mocked(buildAcpChatCleanup).mockReset();
  vi.mocked(buildAcpChatCleanup).mockImplementation(() => vi.fn());
  vi.mocked(acpAgentState.ensureAcpAgent).mockReset();
  vi.mocked(acpAgentState.ensureAcpAgent).mockResolvedValue('inst-1');
  vi.mocked(acpAgentState.getAcpAgent).mockReset();
  vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(makeAgent('inst-1'));

  setMockInvokeHandler('acp_session_new', () => ({
    session_id: `sess-${++sessionCounter}`,
    available_models: [],
    current_model: null,
    modes: null,
    config_options: null,
  }));
  setMockInvokeHandler('acp_session_cancel', () => undefined);
  setMockInvokeHandler('acp_permission_respond', () => undefined);
  setMockInvokeHandler('acp_is_agent_alive', () => true);
  setMockInvokeHandler('acp_session_prompt', () => 'end_turn');
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  clearUnresponsiveTimer();
});

// ---------------------------------------------------------------------------
// Retry targets the failed conversation
// ---------------------------------------------------------------------------

describe('useAcpLifecycle — retry targets the failed conversation', () => {
  it('replays the failed conversation\'s own prompt and history while another chat is in flight and on screen', async () => {
    useChatStore.setState({
      conversations: [
        seedConversation('conv-a', { question: 'A-prior-question', answer: 'A-prior-answer' }),
        seedConversation('conv-b', { question: 'B-prior-question', answer: 'B-prior-answer' }),
      ],
      activeConversationId: 'conv-a',
    });

    // Prompts 1 (A) and 2 (B) stay in flight; prompt 3 is A's retry.
    const promptA = deferred<string>();
    const promptB = deferred<string>();
    const prompts: Array<{ content: string; sessionId: string }> = [];
    setMockInvokeHandler('acp_session_prompt', (args) => {
      const { content, sessionId } = args as { content: string; sessionId: string };
      prompts.push({ content, sessionId });
      if (prompts.length === 1) return promptA.promise;
      if (prompts.length === 2) return promptB.promise;
      return 'end_turn';
    });

    const { result } = renderLifecycle();

    let sendA: Promise<void> = Promise.resolve();
    let sendB: Promise<void> = Promise.resolve();
    await act(async () => {
      sendA = result.current.acpSendChatMessage('message for A', [], { conversationId: 'conv-a' });
      await new Promise((r) => setTimeout(r, 0));
    });
    // The user moves to B and sends there too. B is now on screen and its
    // send is the most recent one.
    await act(async () => {
      useChatStore.getState().setActiveConversation('conv-b');
      sendB = result.current.acpSendChatMessage('message for B', [], { conversationId: 'conv-b' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(prompts).toHaveLength(2);

    // A's agent dies → connection error → automatic retry with restore.
    await act(async () => {
      promptA.reject(new Error('Prompt failed: broken pipe'));
      await sendA;
    });

    expect(prompts).toHaveLength(3);
    const retry = prompts[2];
    // A's prompt — the single `lastPromptRef` slot used to hold B's.
    expect(retry.content).toContain('message for A');
    expect(retry.content).not.toContain('message for B');
    // A's history — the retry used to read the conversation on screen (B).
    expect(retry.content).toContain('A-prior-question');
    expect(retry.content).not.toContain('B-prior-question');
    expect(retry.content).not.toContain('B-prior-answer');
    // A's message was retried and settled; B's turn was left alone.
    expect(assistantOf('conv-a')?.isError).toBeFalsy();
    expect(useSessionRunStore.getState().runs['conv-b']?.status).toBe('running');

    await act(async () => {
      promptB.resolve('end_turn');
      await sendB;
    });
  });

  it('the banner Retry reaches the instance that holds the prompt, not the one that rendered last', async () => {
    useChatStore.setState({ conversations: [seedConversation('conv-a')], activeConversationId: 'conv-a' });
    const prompts: string[] = [];
    setMockInvokeHandler('acp_session_prompt', (args) => {
      prompts.push((args as { content: string }).content);
      return 'end_turn';
    });

    // The command bar's instance sends…
    const commandBar = renderLifecycle();
    await act(async () => {
      await commandBar.result.current.acpSendChatMessage('hello agent', [], { conversationId: 'conv-a' });
    });
    expect(prompts).toHaveLength(1);

    // …then a bubble menu mounts and renders (selection change). Its instance
    // has no prompt; rendering it used to install ITS retry on the monitor.
    const bubbleMenu = renderLifecycle();
    bubbleMenu.rerender();

    await act(async () => { await getRetryCallback()?.(); });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('hello agent');

    bubbleMenu.unmount();
    commandBar.unmount();
  });
});

// ---------------------------------------------------------------------------
// Stop before the prompt is sent
// ---------------------------------------------------------------------------

describe('useAcpLifecycle — Stop before the prompt is sent', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [seedConversation('conv-a')], activeConversationId: 'conv-a' });
  });

  it('Stop during the agent cold-spawn: nothing is prompted, nothing streams', async () => {
    const spawn = deferred<string>();
    vi.mocked(acpAgentState.ensureAcpAgent).mockReturnValue(spawn.promise);
    // No agent yet — it is still spawning.
    vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(null as unknown as acpAgentState.AcpAgentState);

    const { result } = renderLifecycle();
    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = result.current.acpSendChatMessage('hello', []);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useSessionRunStore.getState().runs['conv-a']?.status).toBe('running');

    act(() => { result.current.acpCancelChat(); });
    expect(useSessionRunStore.getState().runs['conv-a']).toBeUndefined();
    // The stopped (empty) reply is marked, not left looking pending.
    expect(assistantOf('conv-a')?.interrupted).toBe(true);

    // The spawn completes seconds later.
    vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(makeAgent('inst-1'));
    await act(async () => {
      spawn.resolve('inst-1');
      await send;
    });
    await flushAsync();

    expect(invokesOf('acp_session_new')).toHaveLength(0);
    expect(setupAcpChatListeners).not.toHaveBeenCalled();
    expect(invokesOf('acp_session_prompt')).toHaveLength(0);
    // The run stays cleared and the message is not turned into an error.
    expect(useSessionRunStore.getState().runs['conv-a']).toBeUndefined();
    expect(useChatStore.getState().isLoading).toBe(false);
    expect(assistantOf('conv-a')?.isError).toBeFalsy();
  });

  it('Stop during session creation: the session is kept but the prompt is not sent', async () => {
    const session = deferred<unknown>();
    setMockInvokeHandler('acp_session_new', () => session.promise);

    const { result } = renderLifecycle();
    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = result.current.acpSendChatMessage('hello', []);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(invokesOf('acp_session_new')).toHaveLength(1);

    act(() => { result.current.acpCancelChat(); });

    await act(async () => {
      session.resolve({ session_id: 'sess-late', available_models: [], current_model: null, modes: null, config_options: null });
      await send;
    });
    await flushAsync();

    expect(setupAcpChatListeners).not.toHaveBeenCalled();
    expect(invokesOf('acp_session_prompt')).toHaveLength(0);
    expect(useSessionRunStore.getState().runs['conv-a']).toBeUndefined();
  });

  it('Stop during listener setup: the late listeners are dropped and never registered', async () => {
    const listeners = makeListeners();
    const setup = deferred<ReturnType<typeof makeListeners>>();
    vi.mocked(setupAcpChatListeners).mockReturnValue(setup.promise as never);

    const { result } = renderLifecycle();
    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = result.current.acpSendChatMessage('hello', []);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(setupAcpChatListeners).toHaveBeenCalledTimes(1);

    act(() => { result.current.acpCancelChat(); });

    await act(async () => {
      setup.resolve(listeners);
      await send;
    });
    await flushAsync();

    expect(listeners.unlisten).toHaveBeenCalledTimes(1);
    expect(listeners.unlistenPermission).toHaveBeenCalledTimes(1);
    expect(buildAcpChatCleanup).not.toHaveBeenCalled();
    expect(invokesOf('acp_session_prompt')).toHaveLength(0);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it('a Stop with nothing sent does not cancel the session or arm the 5s escalation', async () => {
    vi.useFakeTimers();
    const spawn = deferred<string>();
    vi.mocked(acpAgentState.ensureAcpAgent).mockReturnValue(spawn.promise);
    // A warm agent that already has a session from an earlier turn.
    vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(makeAgent('inst-1', 'sess-existing'));

    const { result } = renderLifecycle();
    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = result.current.acpSendChatMessage('hello', []);
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => { result.current.acpCancelChat(); });
    await act(async () => {
      spawn.resolve('inst-1');
      await send;
      await vi.advanceTimersByTimeAsync(6_000);
    });

    // No turn was running, so no confirmation could ever arrive: the
    // escalation would always have fired a spurious "unresponsive" banner.
    expect(invokesOf('acp_session_cancel')).toHaveLength(0);
    expect(useAgentStatusStore.getState().status).not.toBe('unresponsive');
  });

  it('a Stop AFTER the prompt was sent still cancels the session on the agent', async () => {
    const prompt = deferred<string>();
    setMockInvokeHandler('acp_session_prompt', () => prompt.promise);
    const agent = makeAgent('inst-1');
    vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(agent);

    const { result, unmount } = renderLifecycle();
    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = result.current.acpSendChatMessage('hello', []);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(invokesOf('acp_session_prompt')).toHaveLength(1);

    act(() => { result.current.acpCancelChat(); });
    expect(invokesOf('acp_session_cancel')).toHaveLength(1);

    await act(async () => {
      prompt.resolve('cancelled');
      await send;
    });
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Cancel escalation is per conversation
// ---------------------------------------------------------------------------

describe('useAcpLifecycle — cancel escalation is per conversation', () => {
  it('confirming A\'s cancel neither clears B\'s escalation nor leaves A\'s timer armed', async () => {
    vi.useFakeTimers();
    useChatStore.setState({
      conversations: [seedConversation('conv-a'), seedConversation('conv-b')],
      activeConversationId: 'conv-a',
    });
    const agents: Record<string, acpAgentState.AcpAgentState> = {
      'conv-a': makeAgent('inst-a', 'sess-a'),
      'conv-b': makeAgent('inst-b', 'sess-b'),
    };
    vi.mocked(acpAgentState.getAcpAgent).mockImplementation(
      (id?: string | null) => (id ? agents[id] : undefined) as acpAgentState.AcpAgentState,
    );

    const { result, unmount } = renderLifecycle();
    const listenersBefore = getListenerCount('acp-session-update');

    // t=0: stop A. t=1s: stop B.
    await act(async () => {
      result.current.acpCancelChat('conv-a');
      await vi.advanceTimersByTimeAsync(1_000);
      result.current.acpCancelChat('conv-b');
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // t=2s: A's agent confirms the cancel. B's never does.
    await act(async () => {
      emitMockEvent('acp-session-update', {
        instanceId: 'inst-a',
        sessionId: 'sess-a',
        update: { sessionUpdate: 'agent_turn_complete' },
      });
      await vi.advanceTimersByTimeAsync(3_500);
    });

    // t=5.5s: A was confirmed, so no banner yet. With the shared refs, A's
    // orphaned timer fired here (and B's had been cleared by A's confirmation).
    expect(useAgentStatusStore.getState().status).not.toBe('unresponsive');

    // t=6.5s: B's own 5s have passed without a confirmation.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(useAgentStatusStore.getState().status).toBe('unresponsive');

    // Both confirmation listeners are gone.
    expect(getListenerCount('acp-session-update')).toBe(listenersBefore);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Several instances share the unresponsive monitor
// ---------------------------------------------------------------------------

describe('useAcpLifecycle — instances do not disable each other\'s hung-agent detection', () => {
  it('a sibling instance unmounting leaves the sender\'s inactivity timer working', async () => {
    vi.useFakeTimers();
    useChatStore.setState({ conversations: [seedConversation('conv-a')], activeConversationId: 'conv-a' });
    const prompt = deferred<string>();
    setMockInvokeHandler('acp_session_prompt', () => prompt.promise);

    const commandBar = renderLifecycle();
    const bubbleMenu = renderLifecycle();
    // The bubble menu goes away (selection cleared, tab switched). Its unmount
    // used to null the monitor's only callback, so `start()` returned early
    // for every later send.
    bubbleMenu.unmount();

    let send: Promise<void> = Promise.resolve();
    await act(async () => {
      send = commandBar.result.current.acpSendChatMessage('hello', []);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invokesOf('acp_session_prompt')).toHaveLength(1);

    // The agent goes silent for the whole timeout.
    await act(async () => { await vi.advanceTimersByTimeAsync(UNRESPONSIVE_TIMEOUT_MS + 10); });

    expect(invokesOf('acp_is_agent_alive')).toHaveLength(1);
    expect(useAgentStatusStore.getState().status).toBe('unresponsive');

    await act(async () => {
      prompt.resolve('end_turn');
      await send;
    });
    commandBar.unmount();
  });
});
