/**
 * Tests for the Local Agent setup-flow slice of local-ai-store (task #15):
 * the stage machine and persistence (stage+model, never the transient error).
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

import { useLocalAIStore, setupStateFor } from '../local-ai-store';

describe('local-ai-store — Local Agent setup slice (task #15)', () => {
  beforeEach(() => {
    useLocalAIStore.getState().resetLocalAgentSetup();
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

  it('persists stage + modelId + engine but never the transient error', () => {
    useLocalAIStore.getState().setLocalAgentSetup({
      stage: 'failed', failedStage: 'downloading', error: 'network error', modelId: 'm1',
    });
    const persisted = JSON.parse(storageBacking.get('notesage-local-ai') ?? '{}');
    // `engine` joined the persisted shape so a relaunch can still tell whose
    // flow this is; the point of the test is unchanged — the transient error
    // and failedStage stay out.
    expect(persisted.state.localAgentSetup).toEqual({
      stage: 'failed', modelId: 'm1', engine: 'goose',
    });
    expect(persisted.state.localAgentSetup.error).toBeUndefined();
    expect(persisted.state.localAgentSetup.failedStage).toBeUndefined();
  });
});

/**
 * Two engines, one state machine.
 *
 * The setup flow was untagged, so `stage: 'ready'` from whichever engine was
 * installed first was read as the second engine's completed setup: the dialog
 * opened with every step ticked, ran nothing, and the second agent could never
 * be added.
 *
 * This is the SECOND time this shape has bitten. The first was remove-then-
 * re-add, patched by resetting on removal — a fix for one path through an
 * ambiguity rather than for the ambiguity. Hence a tag, and hence these.
 */
describe('local-ai-store — two coexisting Local Agent engines', () => {
  beforeEach(() => {
    useLocalAIStore.getState().resetLocalAgentSetup();
    useLocalAIStore.setState({ localAgentSetupEngine: 'goose' });
    storageBacking.clear();
  });

  it("does not show one engine's finished setup as the other's", () => {
    const store = () => useLocalAIStore.getState();
    // Goose completes.
    store().setLocalAgentSetupDialogOpen(true, 'goose');
    store().setLocalAgentSetup({ stage: 'ready', modelId: 'qwen2.5-coder-7b' });
    expect(setupStateFor(store().localAgentSetup, 'goose').stage).toBe('ready');

    // Now add pi. The reported symptom was this reading 'ready'.
    expect(setupStateFor(store().localAgentSetup, 'pi').stage).toBe('idle');
  });

  it('clears the stale flow when the dialog opens for the other engine', () => {
    const store = () => useLocalAIStore.getState();
    store().setLocalAgentSetupDialogOpen(true, 'goose');
    store().setLocalAgentSetup({ stage: 'ready', modelId: 'qwen2.5-coder-7b' });

    store().setLocalAgentSetupDialogOpen(true, 'pi');
    expect(store().localAgentSetup.stage).toBe('idle');
    // The model was chosen for Goose; it is not pi's choice to inherit.
    expect(store().localAgentSetup.modelId).toBeUndefined();
  });

  it('keeps a flow intact when the dialog re-opens for the SAME engine', () => {
    // Resume-after-interruption must still work — the fix must not turn every
    // re-open into a reset.
    const store = () => useLocalAIStore.getState();
    store().setLocalAgentSetupDialogOpen(true, 'pi');
    store().setLocalAgentSetup({ stage: 'downloading', modelId: 'qwen2.5-coder-7b' });
    store().setLocalAgentSetupDialogOpen(false);
    store().setLocalAgentSetupDialogOpen(true, 'pi');

    expect(store().localAgentSetup.stage).toBe('downloading');
    expect(store().localAgentSetup.modelId).toBe('qwen2.5-coder-7b');
  });

  it('persists the engine tag, so a relaunch cannot re-orphan the flow', () => {
    const store = () => useLocalAIStore.getState();
    store().setLocalAgentSetupDialogOpen(true, 'pi');
    store().setLocalAgentSetup({ stage: 'verifying', modelId: 'qwen2.5-coder-7b' });

    const persisted = JSON.parse(storageBacking.get('notesage-local-ai') ?? '{}');
    expect(persisted.state.localAgentSetup.engine).toBe('pi');
    // Without the tag surviving the write, the next launch is back to the
    // original ambiguity — the stage would be read by whichever engine asks.
    expect(setupStateFor(persisted.state.localAgentSetup, 'goose').stage).toBe('idle');
  });

  it('hands back the SAME idle object every time it rejects a foreign flow', () => {
    // `useLocalAgentSetup` calls this inside a Zustand selector, so the return
    // value IS `useSyncExternalStore`'s snapshot. A fresh `{ stage: 'idle' }`
    // per call never equals itself, which React reports as "The result of
    // getSnapshot should be cached to avoid an infinite loop" and escalates to
    // error #185 — the app logged its startup and then stopped, with no window
    // (Peter, 0.54.4, 2026-09-06). Reference equality is the whole fix, so it
    // is what this asserts; `toEqual` would pass against the bug.
    const foreign = { stage: 'ready' as const, engine: 'goose' as const };
    const first = setupStateFor(foreign, 'pi');
    const second = setupStateFor(foreign, 'pi');
    expect(first).toBe(second);
    expect(first.stage).toBe('idle');
  });

  it('returns the stored object itself when the flow IS this engine\'s', () => {
    // The other half of snapshot stability: an owned flow must pass through by
    // reference, not be copied, or every read is a new snapshot again.
    const own = { stage: 'downloading' as const, engine: 'pi' as const };
    expect(setupStateFor(own, 'pi')).toBe(own);
  });

  it('treats an untagged persisted flow as the asking engine', () => {
    // State written before the tag existed. Everyone upgrading has exactly one
    // engine, so honouring it preserves their resume; the alternative silently
    // discards an in-flight setup on upgrade.
    expect(setupStateFor({ stage: 'downloading' }, 'goose').stage).toBe('downloading');
    expect(setupStateFor({ stage: 'downloading' }, 'pi').stage).toBe('downloading');
  });
});
