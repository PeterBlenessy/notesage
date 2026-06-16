// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, getListenerCount } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Module mocks — must be before importing the hook under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
  },
}));

vi.mock('@/hooks/useAcpSessionListeners', () => ({
  setupAcpChatListeners: vi.fn().mockResolvedValue({
    unlistenUpdate: vi.fn(),
    unlistenPermission: vi.fn(),
    unlistenUsage: vi.fn(),
  }),
  buildAcpChatCleanup: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@/lib/ai/acp-agent-state', () => ({
  acpAgent: null,
  getAcpAgent: vi.fn(() => null),
  getAllAcpAgents: vi.fn(() => []),
  getAllAcpAgentEntries: vi.fn(() => []),
  stopAcpAgent: vi.fn(),
  stopAllAcpAgents: vi.fn(),
  ensureAcpAgent: vi.fn().mockResolvedValue('test-instance-id'),
  updateAcpAgentInstanceId: vi.fn(),
  clearAcpAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks are configured
// ---------------------------------------------------------------------------

import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';
import type { Connection } from '@/lib/ai/connections';

// Get mutable reference to the mocked module
import * as acpAgentState from '@/lib/ai/acp-agent-state';

/**
 * Configure the per-conversation ACP registry mock to behave as if a single
 * agent is registered (or none, when `agent` is null) — `getAcpAgent` returns it
 * for any conversation key and `getAllAcpAgents` reports the live set. Replaces
 * the old `acpAgentState.acpAgent = …` singleton poke now that the hook reads the
 * registry accessors (task #2).
 */
function setMockAgent(agent: acpAgentState.AcpAgentState | null): void {
  vi.mocked(acpAgentState.getAcpAgent).mockReturnValue(agent);
  vi.mocked(acpAgentState.getAllAcpAgents).mockReturnValue(agent ? [agent] : []);
  vi.mocked(acpAgentState.getAllAcpAgentEntries).mockReturnValue(
    agent ? [['conv-test', agent]] : [],
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    label: 'Test Agent',
    capabilities: ['interactive', 'agent_tasks'],
    addedAt: Date.now(),
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    ...overrides,
  } as Connection;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAcpLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Default invoke handlers
    setMockInvokeHandler('acp_session_cancel', () => undefined);
    setMockInvokeHandler('acp_permission_respond', () => undefined);
    setMockInvokeHandler('acp_is_agent_alive', () => true);
    setMockInvokeHandler('acp_agent_stop', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset the mocked ACP registry state
    setMockAgent(null);
    // Reset stores so workspace/chat/permission state doesn't leak between tests
    useWorkspaceStore.setState({ projects: [], explorerFolders: [] } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    useChatStore.setState({ isLoading: false });
    usePermissionStore.setState({ requests: [] });
    vi.mocked(invoke).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  describe('acpCancelChat — cancel escalation listener leak', () => {
    it('should not leak event listener when 5s escalation timeout fires before listen resolves', async () => {
      // Set up acpAgent with an active session so the cancel path is entered
      setMockAgent({
        instanceId: 'test-instance-id',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        configKey: '',
        chatSessionId: 'session-123',
      });

      const connection = makeConnection();

      const { result } = renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'You are a test assistant',
        })
      );

      // Count listeners on 'acp-session-update' before cancel
      const listenersBefore = getListenerCount('acp-session-update');

      // Call acpCancelChat — this sets up a listen() call and a 5s timeout
      act(() => {
        result.current.acpCancelChat();
      });

      // The listen() call is async — its .then() stores the unlisten ref.
      // Advance time past the 5s escalation timeout BEFORE the promise resolves.
      // In our mock, listen resolves on the microtask queue, so we need to
      // advance timers first, then flush promises.
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Flush all pending microtasks (the listen promise .then())
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // After the escalation timeout + promise resolution, no listener should remain
      const listenersAfter = getListenerCount('acp-session-update');
      expect(listenersAfter).toBe(listenersBefore);
    });

    it('[task #29] workspace change during active turn cancels turn, drains permissions, shows toast', async () => {
      // Seed: workspace has one project, agent is attached, a turn is in
      // flight AND there's a pending permission request for the agent.
      useWorkspaceStore.setState({
        projects: [{ path: '/work/projA', fileTree: [] }],
        explorerFolders: [],
      } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

      setMockAgent({
        instanceId: 'inst-workspace-29',
        connectionId: 'conn-test',
        sandboxScopeKey: '/work/projA',
        configKey: '',
        chatSessionId: 'sess-active-29',
      });

      // Simulate a pending permission card for this instance.
      usePermissionStore.getState().addRequest({
        id: 'perm-1',
        instanceId: 'inst-workspace-29',
        sessionId: 'sess-active-29',
        requestId: 'req-abc',
        toolKind: 'write',
        toolTitle: 'Writing file',
        toolInput: '{}',
        options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow' }],
        timestamp: Date.now(),
      });

      // Mark chat as loading so the workspace-change effect sees an active turn.
      act(() => { useChatStore.getState().setLoading(true); });

      const connection = makeConnection();
      renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'sys',
        })
      );

      // Sanity-check pre-conditions before the attack.
      expect(
        usePermissionStore.getState().requests.filter((r) => r.instanceId === 'inst-workspace-29'),
      ).toHaveLength(1);

      // Change workspace folders — this fires the workspace-change effect.
      await act(async () => {
        useWorkspaceStore.setState({
          projects: [{ path: '/work/projB', fileTree: [] }],
          explorerFolders: [],
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
      });

      // 1. acp_session_cancel called for the in-flight turn.
      expect(invoke).toHaveBeenCalledWith('acp_session_cancel', {
        instanceId: 'inst-workspace-29',
        sessionId: 'sess-active-29',
      });

      // 2. Pending permission denied and drained.
      expect(invoke).toHaveBeenCalledWith('acp_permission_respond', {
        instanceId: 'inst-workspace-29',
        requestId: 'req-abc',
        optionId: null,
      });
      expect(
        usePermissionStore.getState().requests.filter((r) => r.instanceId === 'inst-workspace-29'),
      ).toHaveLength(0);

      // 3. Context-reset toast surfaced.
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining('Context reset'),
        expect.objectContaining({ id: 'acp-workspace-context-reset' }),
      );

      // Every agent is then torn down (the registry, not a single singleton).
      expect(acpAgentState.stopAllAcpAgents).toHaveBeenCalled();

      // Chat loading flag cleared so the UI exits the streaming state.
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('[task #29] workspace change with no active turn does not cancel or deny (just respawn)', async () => {
      useWorkspaceStore.setState({
        projects: [{ path: '/work/projA', fileTree: [] }],
        explorerFolders: [],
      } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

      setMockAgent({
        instanceId: 'inst-workspace-idle',
        connectionId: 'conn-test',
        sandboxScopeKey: '/work/projA',
        configKey: '',
        chatSessionId: 'sess-idle',
      });

      // No pending permissions, chat not loading.
      act(() => { useChatStore.getState().setLoading(false); });

      const connection = makeConnection();
      renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'sys',
        })
      );

      const invokeMock = vi.mocked(invoke);
      invokeMock.mockClear();
      vi.mocked(toast.info).mockClear();

      await act(async () => {
        useWorkspaceStore.setState({
          projects: [{ path: '/work/projB', fileTree: [] }],
          explorerFolders: [],
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
      });

      // No cancel, no deny, no toast — only the agent teardown ran.
      const cancelCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'acp_session_cancel');
      const denyCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'acp_permission_respond');
      expect(cancelCalls).toHaveLength(0);
      expect(denyCalls).toHaveLength(0);
      expect(toast.info).not.toHaveBeenCalled();
      expect(acpAgentState.stopAllAcpAgents).toHaveBeenCalled();
    });

    it('should clean up listener when cancel confirmation arrives before 5s timeout', async () => {
      setMockAgent({
        instanceId: 'test-instance-id',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        configKey: '',
        chatSessionId: 'session-123',
      });

      const connection = makeConnection();

      const { result } = renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'You are a test assistant',
        })
      );

      const listenersBefore = getListenerCount('acp-session-update');

      act(() => {
        result.current.acpCancelChat();
      });

      // Let listen() promise resolve
      await act(async () => {
        await Promise.resolve();
      });

      // Now simulate the agent confirming the cancel
      const { emitMockEvent } = await import('@/test/tauri-mock');
      act(() => {
        emitMockEvent('acp-session-update', {
          instanceId: 'test-instance-id',
          update: { sessionUpdate: 'agent_turn_complete' },
        });
      });

      // The listener should have been cleaned up by the cancel confirmation
      const listenersAfter = getListenerCount('acp-session-update');
      expect(listenersAfter).toBe(listenersBefore);
    });
  });

  describe('acpSendChatMessage — attachment activity log (task #30)', () => {
    it('logs one `attachment` activity per attachedFilePath on the user message', async () => {
      vi.useRealTimers(); // This test drives real async flow; fake timers would stall promises.

      // Make every mock invoke a no-op — we only need send to reach (and get past)
      // the attachment-logging site at the top of acpSendChatMessage. The rest
      // of the flow (session_new, prompt) will run against mock handlers and
      // either succeed silently or throw; either way activities are already
      // recorded at that point.
      setMockInvokeHandler('acp_session_new', () => ({
        session_id: 'sess-attach-test',
        available_models: [],
        current_model: null,
        modes: null,
        config_options: null,
      }));
      setMockInvokeHandler('acp_session_prompt', () => undefined);

      // Seed a chat store with an active conversation so addMessage has a home.
      useChatStore.getState().clearMessages();

      // Attach an already-initialized acpAgent so the hook reuses the session.
      setMockAgent({
        instanceId: 'inst-attach-test',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        configKey: '',
        chatSessionId: null, // forces session_new path
      });

      const connection = makeConnection();
      const { result } = renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'sys',
        })
      );

      await act(async () => {
        // Fire-and-forget — the send may fail later in the pipeline once the
        // mock session ends, but attachment activities are appended BEFORE any
        // of that runs.
        try {
          await result.current.acpSendChatMessage('hello', [], {
            attachedFilePaths: [
              '/workspace/project-A/notes.md',
              '/workspace/project-A/research.md',
            ],
          });
        } catch {
          // ignored — downstream pipeline is out of scope for this test
        }
      });

      const conv = useChatStore.getState().conversations[0];
      const userMsg = conv?.messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      const attachments = (userMsg!.activities ?? []).filter((a) => a.kind === 'attachment');
      expect(attachments).toHaveLength(2);
      expect(attachments[0]).toMatchObject({
        kind: 'attachment',
        label: 'notes.md',
        detail: '/workspace/project-A/notes.md',
        status: 'done',
      });
      expect(attachments[1]).toMatchObject({
        kind: 'attachment',
        label: 'research.md',
        detail: '/workspace/project-A/research.md',
        status: 'done',
      });
    });

    it('does not log attachments when attachedFilePaths is missing', async () => {
      vi.useRealTimers();

      setMockInvokeHandler('acp_session_new', () => ({
        session_id: 'sess-noop',
        available_models: [],
        current_model: null,
        modes: null,
        config_options: null,
      }));
      setMockInvokeHandler('acp_session_prompt', () => undefined);

      useChatStore.getState().clearMessages();

      setMockAgent({
        instanceId: 'inst-attach-empty',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        configKey: '',
        chatSessionId: null,
      });

      const connection = makeConnection();
      const { result } = renderHook(() =>
        useAcpLifecycle({
          effectiveConnection: connection,
          acpSystemMessage: 'sys',
        })
      );

      await act(async () => {
        try {
          await result.current.acpSendChatMessage('hello', []);
        } catch {
          // ignored
        }
      });

      const conv = useChatStore.getState().conversations[0];
      const userMsg = conv?.messages.find((m) => m.role === 'user');
      const attachments = (userMsg?.activities ?? []).filter((a) => a.kind === 'attachment');
      expect(attachments).toHaveLength(0);
    });
  });
});
