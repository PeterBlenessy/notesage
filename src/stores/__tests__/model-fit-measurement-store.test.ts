/**
 * Tests for the Phase 2 runtime-calibration measurement store:
 * rolling-median tok/s, rolling-max RAM, sampleCount, chip-change discard,
 * and that recording makes no network call (privacy regression lock).
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

import { useModelFitMeasurementStore } from '../model-fit-measurement-store';

const reset = () => useModelFitMeasurementStore.setState({ measurements: {}, chipName: null });

const GB = 1e9;

describe('model-fit-measurement-store', () => {
  beforeEach(() => {
    storageBacking.clear();
    reset();
  });

  it('records a measurement with sane fields', () => {
    useModelFitMeasurementStore.getState().recordMeasurement({
      modelId: 'qwen3-8b',
      tokPerSec: 24,
      peakRamBytes: 6 * GB,
      decodeTokens: 128,
      chipName: 'Apple M3 Pro',
    });
    const m = useModelFitMeasurementStore.getState().getMeasurement('qwen3-8b')!;
    expect(m.measuredTokPerSec).toBe(24);
    expect(m.peakRamBytes).toBe(6 * GB);
    expect(m.sampleCount).toBe(1);
    expect(useModelFitMeasurementStore.getState().chipName).toBe('Apple M3 Pro');
  });

  it('rolls tok/s as a median and RAM as a max across samples', () => {
    const rec = useModelFitMeasurementStore.getState().recordMeasurement;
    rec({ modelId: 'm', tokPerSec: 10, peakRamBytes: 5 * GB, decodeTokens: 100, chipName: 'M3' });
    rec({ modelId: 'm', tokPerSec: 30, peakRamBytes: 7 * GB, decodeTokens: 100, chipName: 'M3' });
    rec({ modelId: 'm', tokPerSec: 20, peakRamBytes: 4 * GB, decodeTokens: 100, chipName: 'M3' });
    const m = useModelFitMeasurementStore.getState().getMeasurement('m')!;
    expect(m.measuredTokPerSec).toBe(20); // median of [10,20,30]
    expect(m.peakRamBytes).toBe(7 * GB); // max
    expect(m.sampleCount).toBe(3);
  });

  it('ignores non-positive / non-finite tok/s', () => {
    const rec = useModelFitMeasurementStore.getState().recordMeasurement;
    rec({ modelId: 'm', tokPerSec: 0, peakRamBytes: 1 * GB, decodeTokens: 100, chipName: 'M3' });
    rec({ modelId: 'm', tokPerSec: NaN, peakRamBytes: 1 * GB, decodeTokens: 100, chipName: 'M3' });
    expect(useModelFitMeasurementStore.getState().getMeasurement('m')).toBeUndefined();
  });

  it('discards prior measurements when the chip changes', () => {
    const rec = useModelFitMeasurementStore.getState().recordMeasurement;
    rec({ modelId: 'a', tokPerSec: 20, peakRamBytes: 5 * GB, decodeTokens: 100, chipName: 'Apple M1' });
    rec({ modelId: 'b', tokPerSec: 40, peakRamBytes: 5 * GB, decodeTokens: 100, chipName: 'Apple M3 Max' });
    const state = useModelFitMeasurementStore.getState();
    expect(state.chipName).toBe('Apple M3 Max');
    expect(state.getMeasurement('a')).toBeUndefined(); // discarded
    expect(state.getMeasurement('b')).toBeDefined();
  });

  it('clear() empties measurements and chip', () => {
    const s = useModelFitMeasurementStore.getState();
    s.recordMeasurement({ modelId: 'a', tokPerSec: 20, peakRamBytes: 5 * GB, decodeTokens: 100, chipName: 'M3' });
    s.clear();
    expect(useModelFitMeasurementStore.getState().measurements).toEqual({});
    expect(useModelFitMeasurementStore.getState().chipName).toBeNull();
  });

  // Privacy regression lock: recording a measurement must never hit the network.
  it('makes no network call when recording', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    useModelFitMeasurementStore.getState().recordMeasurement({
      modelId: 'm',
      tokPerSec: 20,
      peakRamBytes: 5 * GB,
      decodeTokens: 100,
      chipName: 'M3',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
