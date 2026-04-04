// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, getListenerCount } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';

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
  stopAcpAgent: vi.fn(),
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
    // Reset the mocked acpAgent state
    (acpAgentState as { acpAgent: typeof acpAgentState.acpAgent }).acpAgent = null;
  });

  describe('acpCancelChat — cancel escalation listener leak', () => {
    it('should not leak event listener when 5s escalation timeout fires before listen resolves', async () => {
      // Set up acpAgent with an active session so the cancel path is entered
      (acpAgentState as { acpAgent: typeof acpAgentState.acpAgent }).acpAgent = {
        instanceId: 'test-instance-id',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        chatSessionId: 'session-123',
      };

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

    it('should clean up listener when cancel confirmation arrives before 5s timeout', async () => {
      (acpAgentState as { acpAgent: typeof acpAgentState.acpAgent }).acpAgent = {
        instanceId: 'test-instance-id',
        connectionId: 'conn-test',
        sandboxScopeKey: '',
        chatSessionId: 'session-123',
      };

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
});
