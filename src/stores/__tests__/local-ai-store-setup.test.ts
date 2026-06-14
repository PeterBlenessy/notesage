/**
 * Tests for the Local Agent setup-flow slice of local-ai-store (task #15):
 * the stage machine, degraded flag, persistence (stage+model, no transient
 * error), and the `selectLocalAgentNotice` selector.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    value: localStorageMock, writable: true, configurable: true,
  });
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  return { storageBacking };
});

vi.mock('@/lib/tauri', () => ({
  tauriApi: { listLocalModels: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { useLocalAIStore, selectLocalAgentNotice } from '../local-ai-store';

describe('local-ai-store — Local Agent setup slice (task #15)', () => {
  beforeEach(() => {
    useLocalAIStore.getState().resetLocalAgentSetup();
    useLocalAIStore.getState().setLocalAgentDegraded(null);
    storageBacking.clear();
  });

  it('advances stages and carries modelId forward across transitions', () => {
    const { setLocalAgentSetup } = useLocalAIStore.getState();
    setLocalAgentSetup({ stage: 'detecting' });
    setLocalAgentSetup({ stage: 'downloading', modelId: 'qwen2.5-coder-7b' });
    setLocalAgentSetup({ stage: 'configuring' });
    const s = useLocalAIStore.getState().localAgentSetup;
    expect(s.stage).toBe('configuring');
    expect(s.modelId).toBe('qwen2.5-coder-7b');
  });

  it('records failedStage + error on failure and clears them on recovery', () => {
    const { setLocalAgentSetup } = useLocalAIStore.getState();
    setLocalAgentSetup({ stage: 'failed', failedStage: 'verifying', error: 'smoke test failed' });
    let s = useLocalAIStore.getState().localAgentSetup;
    expect(s.stage).toBe('failed');
    expect(s.failedStage).toBe('verifying');
    expect(s.error).toBe('smoke test failed');

    // A non-failed transition clears the stale error/failedStage.
    setLocalAgentSetup({ stage: 'verifying' });
    s = useLocalAIStore.getState().localAgentSetup;
    expect(s.error).toBeUndefined();
    expect(s.failedStage).toBeUndefined();
  });

  it('reset returns to idle', () => {
    useLocalAIStore.getState().setLocalAgentSetup({ stage: 'ready', modelId: 'm' });
    useLocalAIStore.getState().resetLocalAgentSetup();
    expect(useLocalAIStore.getState().localAgentSetup).toEqual({ stage: 'idle' });
  });

  it('persists stage + modelId but never the transient error', () => {
    useLocalAIStore.getState().setLocalAgentSetup({
      stage: 'failed', failedStage: 'downloading', error: 'network error', modelId: 'm1',
    });
    const persisted = JSON.parse(storageBacking.get('notesage-local-ai') ?? '{}');
    expect(persisted.state.localAgentSetup).toEqual({ stage: 'failed', modelId: 'm1' });
    expect(persisted.state.localAgentSetup.error).toBeUndefined();
  });

  describe('selectLocalAgentNotice', () => {
    it('returns null when healthy', () => {
      expect(selectLocalAgentNotice(useLocalAIStore.getState())).toBeNull();
    });

    it('reports the degraded reason (runtime fallback)', () => {
      useLocalAIStore.getState().setLocalAgentDegraded('Local AI server is not running');
      const notice = selectLocalAgentNotice(useLocalAIStore.getState());
      expect(notice?.reason).toBe('Local AI server is not running');
    });

    it('reports the failed setup stage so Fix can reopen at that stage', () => {
      useLocalAIStore.getState().setLocalAgentSetup({
        stage: 'failed', failedStage: 'verifying', error: 'smoke failed',
      });
      const notice = selectLocalAgentNotice(useLocalAIStore.getState());
      expect(notice).toEqual({ reason: 'smoke failed', failedStage: 'verifying' });
    });
  });
});
