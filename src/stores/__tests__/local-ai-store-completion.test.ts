/**
 * Tests for the completion-server slice of local-ai-store (item #8 — the
 * `--jinja`/FIM conflict resolution). Covers the start/stop/refresh actions
 * and the persisted `completionModelId`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted runs before module-level store code so localStorage is in place
// for zustand persist hydration.
const { storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key) => storageBacking.get(key) ?? null,
    setItem: (key, value) => { storageBacking.set(key, value); },
    removeItem: (key) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (i) => [...storageBacking.keys()][i] ?? null,
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  return { storageBacking };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartCompletionServer = vi.fn();
const mockStopCompletionServer = vi.fn();
const mockGetCompletionServerStatus = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    startCompletionServer: (...args: unknown[]) => mockStartCompletionServer(...args),
    stopCompletionServer: () => mockStopCompletionServer(),
    getCompletionServerStatus: () => mockGetCompletionServerStatus(),
    // Unused but referenced by store initialization paths.
    listLocalModels: vi.fn().mockResolvedValue([]),
    startLocalServer: vi.fn(),
    stopLocalServer: vi.fn(),
    getLocalServerStatus: vi.fn(),
    checkLlamaServerAvailable: vi.fn(),
    downloadLocalModel: vi.fn(),
    cancelLocalModelDownload: vi.fn(),
    deleteLocalModel: vi.fn(),
    addCustomLocalModel: vi.fn(),
    removeCustomLocalModel: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useLocalAIStore } from '../local-ai-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetStore = () => {
  // Reset only the completion fields — leaves the main-server slice alone so
  // we don't mask a bug where one slice's reset clobbers the other.
  useLocalAIStore.setState({
    completionModelId: null,
    completionServerStatus: 'stopped',
    completionServerPort: null,
    completionServerError: null,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('local-ai-store — completion server slice', () => {
  beforeEach(() => {
    storageBacking.clear();
    vi.clearAllMocks();
    resetStore();
  });

  describe('initial state', () => {
    it('starts with no completion model and a stopped server', () => {
      const s = useLocalAIStore.getState();
      expect(s.completionModelId).toBeNull();
      expect(s.completionServerStatus).toBe('stopped');
      expect(s.completionServerPort).toBeNull();
      expect(s.completionServerError).toBeNull();
    });
  });

  describe('startCompletionServer', () => {
    it('transitions starting → running with the resolved port on success', async () => {
      mockStartCompletionServer.mockResolvedValueOnce(8195);

      const p = useLocalAIStore.getState().startCompletionServer('qwen2.5-coder-1.5b', 4096, -1);

      // While the call is in flight, status should be 'starting' so the UI
      // can render a spinner.
      expect(useLocalAIStore.getState().completionServerStatus).toBe('starting');

      await p;

      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('running');
      expect(s.completionServerPort).toBe(8195);
      expect(s.completionModelId).toBe('qwen2.5-coder-1.5b');
      expect(s.completionServerError).toBeNull();
    });

    it('forwards context length and gpu layers to the backend command', async () => {
      mockStartCompletionServer.mockResolvedValueOnce(8195);
      await useLocalAIStore
        .getState()
        .startCompletionServer('qwen2.5-coder-3b', 8192, 32);
      expect(mockStartCompletionServer).toHaveBeenCalledWith('qwen2.5-coder-3b', 8192, 32);
    });

    it('transitions to error state with the message on failure', async () => {
      mockStartCompletionServer.mockRejectedValueOnce('Model file not found');

      await useLocalAIStore
        .getState()
        .startCompletionServer('qwen2.5-coder-1.5b', 4096, -1);

      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('error');
      expect(s.completionServerError).toContain('Model file not found');
      expect(s.completionServerPort).toBeNull();
    });

    it('clears a previous error state on successful retry', async () => {
      // First start fails…
      mockStartCompletionServer.mockRejectedValueOnce('boom');
      await useLocalAIStore
        .getState()
        .startCompletionServer('qwen2.5-coder-1.5b');
      expect(useLocalAIStore.getState().completionServerStatus).toBe('error');

      // …second start succeeds. Error should be cleared, not lingering.
      mockStartCompletionServer.mockResolvedValueOnce(8195);
      await useLocalAIStore
        .getState()
        .startCompletionServer('qwen2.5-coder-1.5b');
      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('running');
      expect(s.completionServerError).toBeNull();
    });
  });

  describe('stopCompletionServer', () => {
    it('returns to stopped state and clears the port', async () => {
      useLocalAIStore.setState({
        completionServerStatus: 'running',
        completionServerPort: 8195,
        completionModelId: 'qwen2.5-coder-1.5b',
      });

      mockStopCompletionServer.mockResolvedValueOnce(undefined);
      await useLocalAIStore.getState().stopCompletionServer();

      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('stopped');
      expect(s.completionServerPort).toBeNull();
      expect(s.completionServerError).toBeNull();
      // The user's persisted choice is intentionally NOT cleared on stop —
      // they can restart with the same model without re-picking.
      expect(s.completionModelId).toBe('qwen2.5-coder-1.5b');
    });

    it('reaches stopped state even when the backend errors (best-effort)', async () => {
      useLocalAIStore.setState({
        completionServerStatus: 'running',
        completionServerPort: 8195,
      });
      mockStopCompletionServer.mockRejectedValueOnce('backend went away');

      await useLocalAIStore.getState().stopCompletionServer();

      // The UI must not wedge on a backend failure — local state is the
      // source of truth for the spinner.
      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('stopped');
      expect(s.completionServerPort).toBeNull();
    });
  });

  describe('refreshCompletionServerStatus', () => {
    it('hydrates from a running backend', async () => {
      mockGetCompletionServerStatus.mockResolvedValueOnce({
        running: true,
        port: 8197,
        model: 'qwen2.5-coder-7b',
      });

      await useLocalAIStore.getState().refreshCompletionServerStatus();

      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('running');
      expect(s.completionServerPort).toBe(8197);
      expect(s.completionModelId).toBe('qwen2.5-coder-7b');
    });

    it('hydrates from a stopped backend without clearing persisted model choice', async () => {
      useLocalAIStore.setState({ completionModelId: 'persisted-choice' });
      mockGetCompletionServerStatus.mockResolvedValueOnce({
        running: false,
        port: null,
        model: null,
      });

      await useLocalAIStore.getState().refreshCompletionServerStatus();

      const s = useLocalAIStore.getState();
      expect(s.completionServerStatus).toBe('stopped');
      expect(s.completionServerPort).toBeNull();
      // Persisted choice must survive a stopped-server refresh — otherwise the
      // user's dropdown selection vanishes on every panel mount.
      expect(s.completionModelId).toBe('persisted-choice');
    });

    it('does not throw when the backend command errors', async () => {
      mockGetCompletionServerStatus.mockRejectedValueOnce('not registered');
      // Should not propagate — UI mount shouldn't blow up if the command
      // isn't wired yet (e.g. version skew between front and back ends).
      await expect(
        useLocalAIStore.getState().refreshCompletionServerStatus(),
      ).resolves.toBeUndefined();
    });
  });

  describe('setCompletionModelId', () => {
    it('persists the picked model id without starting anything', () => {
      useLocalAIStore.getState().setCompletionModelId('qwen2.5-coder-3b');
      expect(useLocalAIStore.getState().completionModelId).toBe('qwen2.5-coder-3b');
      expect(useLocalAIStore.getState().completionServerStatus).toBe('stopped');
      expect(mockStartCompletionServer).not.toHaveBeenCalled();
    });
  });
});
