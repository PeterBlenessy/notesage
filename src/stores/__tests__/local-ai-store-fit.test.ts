/**
 * Tests for the hardware-aware model-fit slice of local-ai-store:
 * setHardwareProfile, setModelFits (merge by id), setModelCaps, clearModelFits,
 * and that these runtime fields are NOT persisted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key) => storageBacking.get(key) ?? null,
    setItem: (key, value) => {
      storageBacking.set(key, value);
    },
    removeItem: (key) => {
      storageBacking.delete(key);
    },
    clear: () => {
      storageBacking.clear();
    },
    get length() {
      return storageBacking.size;
    },
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

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    listLocalModels: vi.fn().mockResolvedValue([]),
    detectHardwareProfile: vi.fn(),
    estimateModelFit: vi.fn(),
    readGgufCapabilities: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useLocalAIStore } from '../local-ai-store';
import type { ModelFitResult, GgufCapabilities, HardwareProfile } from '@/lib/tauri';

function fit(id: string, partial: Partial<ModelFitResult> = {}): ModelFitResult {
  return {
    id,
    est_ram_bytes: 5_000_000_000,
    fit: 'fits',
    est_tok_per_sec: 20,
    speed: 'fast',
    runnable: true,
    reasons: [],
    ...partial,
  };
}

const profile: HardwareProfile = {
  total_ram_bytes: 16_000_000_000,
  available_ram_bytes: 12_000_000_000,
  chip_name: 'Apple M3 Pro',
  bandwidth_gbs: 150,
  is_unified: true,
  backend: 'metal',
};

const someCaps: GgufCapabilities = {
  architecture: 'qwen2',
  context_length: 32768,
  has_fim_tokens: true,
  has_tool_template: false,
  has_thinking: false,
  gguf_version: 3,
  truncated: false,
};

describe('local-ai-store — model-fit slice', () => {
  beforeEach(() => {
    storageBacking.clear();
    vi.clearAllMocks();
    useLocalAIStore.setState({ hardwareProfile: null, fitById: {}, capsById: {} });
  });

  it('setHardwareProfile stores the profile', () => {
    useLocalAIStore.getState().setHardwareProfile(profile);
    expect(useLocalAIStore.getState().hardwareProfile?.chip_name).toBe('Apple M3 Pro');
  });

  it('setModelFits merges by id and overwrites prior verdicts', () => {
    const s = useLocalAIStore.getState();
    s.setModelFits([fit('a', { est_tok_per_sec: 10 }), fit('b')]);
    expect(Object.keys(useLocalAIStore.getState().fitById).sort()).toEqual(['a', 'b']);

    // Re-run for 'a' only — keeps 'b', updates 'a'.
    s.setModelFits([fit('a', { est_tok_per_sec: 25 })]);
    expect(useLocalAIStore.getState().fitById.a.est_tok_per_sec).toBe(25);
    expect(useLocalAIStore.getState().fitById.b).toBeDefined();
  });

  it('setModelCaps stores caps per id', () => {
    useLocalAIStore.getState().setModelCaps('a', someCaps);
    expect(useLocalAIStore.getState().capsById.a.has_fim_tokens).toBe(true);
  });

  it('clearModelFits empties both maps', () => {
    const s = useLocalAIStore.getState();
    s.setModelFits([fit('a')]);
    s.setModelCaps('a', someCaps);
    s.clearModelFits();
    expect(useLocalAIStore.getState().fitById).toEqual({});
    expect(useLocalAIStore.getState().capsById).toEqual({});
  });

  it('does not persist the runtime fit fields', () => {
    const s = useLocalAIStore.getState();
    s.setHardwareProfile(profile);
    s.setModelFits([fit('a')]);
    s.setModelCaps('a', someCaps);
    const persisted = storageBacking.get('notesage-local-ai');
    if (persisted) {
      const parsed = JSON.parse(persisted);
      expect(parsed.state?.hardwareProfile ?? null).toBeNull();
      expect(parsed.state?.fitById ?? undefined).toBeUndefined();
      expect(parsed.state?.capsById ?? undefined).toBeUndefined();
    }
  });
});
