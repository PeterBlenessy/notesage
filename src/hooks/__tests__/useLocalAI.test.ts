// @vitest-environment jsdom

/**
 * Tests for the listener cleanup race condition fix in useLocalAI.
 *
 * The fix replaces `return () => { unlisten.then((fn) => fn()); }` with the
 * mounted-flag pattern so that unmounting before the listen() Promise resolves
 * does not leak the listener.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { getListenerCount, setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the hook under test
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
    getSystemMemory: vi.fn().mockResolvedValue(8192),
    listLocalModels: vi.fn().mockResolvedValue([]),
    getLocalServerStatus: vi.fn().mockResolvedValue({ running: false, port: null }),
    getRuntimeModelMetadata: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/stores/local-ai-store', () => {
  const store = {
    activeModelId: null,
    contextLength: 4096,
    gpuLayers: -1,
    serverStatus: 'stopped' as const,
    binaryStatus: 'unknown' as const,
    models: [],
    setServerStatus: vi.fn(),
    setServerPort: vi.fn(),
    setServerStatusReason: vi.fn(),
    setSystemMemory: vi.fn(),
    setModels: vi.fn(),
    checkBinary: vi.fn().mockResolvedValue(undefined),
    getState: () => store,
  };
  return {
    useLocalAIStore: Object.assign(vi.fn((selector: (s: typeof store) => unknown) => selector(store)), {
      getState: () => store,
    }),
  };
});

vi.mock('@/stores/settings-store', () => {
  const store = { startupReady: true };
  return {
    useSettingsStore: vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
  };
});

vi.mock('@/stores/connections-store', () => {
  const store = { connections: [], updateConnection: vi.fn() };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks are configured
// ---------------------------------------------------------------------------

import { useLocalAI } from '@/hooks/useLocalAI';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLocalAI — listener cleanup pattern', () => {
  beforeEach(() => {
    setMockInvokeHandler('health_check', () => undefined);
  });

  it('registers a listener for local-server-status on mount', async () => {
    const { unmount } = renderHook(() => useLocalAI());

    // Allow the listen() promise to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(getListenerCount('local-server-status')).toBe(1);
    unmount();
  });

  it('calls the unlisten function on unmount, removing the listener', async () => {
    const { unmount } = renderHook(() => useLocalAI());

    // Allow the listen() promise to resolve so unlisten is assigned
    await act(async () => {
      await Promise.resolve();
    });

    expect(getListenerCount('local-server-status')).toBe(1);

    unmount();

    // The cleanup function must have removed the listener
    expect(getListenerCount('local-server-status')).toBe(0);
  });

  it('does not throw or leak if unmounted before the listen() Promise resolves', async () => {
    // Render and immediately unmount — cleanup runs before the promise resolves
    const { unmount } = renderHook(() => useLocalAI());

    // Unmount synchronously, before awaiting Promise.resolve()
    unmount();

    // Now let the promise resolve (the unlisten fn is now stale / captured in closure)
    await act(async () => {
      await Promise.resolve();
    });

    // No listener should be registered (either unlisten was called or never registered)
    expect(getListenerCount('local-server-status')).toBe(0);
  });

  it('handles the running=true server status event correctly', async () => {
    const { useLocalAIStore } = await import('@/stores/local-ai-store');
    const store = useLocalAIStore.getState();

    renderHook(() => useLocalAI());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitMockEvent('local-server-status', { running: true, port: 8080, model: 'test-model' });
    });

    expect(store.setServerStatus).toHaveBeenCalledWith('running');
    expect(store.setServerPort).toHaveBeenCalledWith(8080);
    expect(store.setServerStatusReason).toHaveBeenCalledWith(null);
  });

  it('handles the running=false server status event correctly', async () => {
    const { useLocalAIStore } = await import('@/stores/local-ai-store');
    const store = useLocalAIStore.getState();

    renderHook(() => useLocalAI());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitMockEvent('local-server-status', { running: false, port: null, model: null });
    });

    expect(store.setServerStatus).toHaveBeenCalledWith('stopped');
    expect(store.setServerPort).toHaveBeenCalledWith(null);
    expect(store.setServerStatusReason).toHaveBeenCalledWith('Server stopped unexpectedly');
  });
});
