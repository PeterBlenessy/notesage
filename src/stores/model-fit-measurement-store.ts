import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * A measured runtime sample for one local model on the current machine.
 * `measuredTokPerSec` is the rolling median of recent samples; `peakRamBytes`
 * the rolling max. See PRD 2026-06-03-model-fit-runtime-calibration.
 */
export interface RuntimeMeasurement {
  modelId: string;
  measuredTokPerSec: number;
  peakRamBytes: number;
  decodeTokens: number;
  sampleCount: number;
  measuredAt: string;
  /** Recent tok/s samples (capped) used to compute the rolling median. */
  tpsSamples: number[];
}

const MAX_SAMPLES = 9;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface ModelFitMeasurementStore {
  /** Hardware these measurements were taken on; measurements are discarded
   *  when the chip changes (they don't transfer between machines). */
  chipName: string | null;
  measurements: Record<string, RuntimeMeasurement>;

  recordMeasurement: (args: {
    modelId: string;
    tokPerSec: number;
    peakRamBytes: number;
    decodeTokens: number;
    chipName: string;
  }) => void;
  getMeasurement: (modelId: string) => RuntimeMeasurement | undefined;
  clear: () => void;
}

export const useModelFitMeasurementStore = create<ModelFitMeasurementStore>()(
  persist(
    (set, get) => ({
      chipName: null,
      measurements: {},

      recordMeasurement: ({ modelId, tokPerSec, peakRamBytes, decodeTokens, chipName }) => {
        if (!Number.isFinite(tokPerSec) || tokPerSec <= 0) return;
        set((s) => {
          // Chip changed → discard prior measurements (they don't transfer).
          const base =
            s.chipName && s.chipName !== chipName ? {} : s.measurements;
          const prev = base[modelId];
          const tpsSamples = [...(prev?.tpsSamples ?? []), tokPerSec].slice(-MAX_SAMPLES);
          const next: RuntimeMeasurement = {
            modelId,
            measuredTokPerSec: median(tpsSamples),
            peakRamBytes: Math.max(prev?.peakRamBytes ?? 0, peakRamBytes),
            decodeTokens,
            sampleCount: (prev?.sampleCount ?? 0) + 1,
            measuredAt: new Date().toISOString(),
            tpsSamples,
          };
          return { chipName, measurements: { ...base, [modelId]: next } };
        });
      },

      getMeasurement: (modelId) => get().measurements[modelId],

      clear: () => set({ measurements: {}, chipName: null }),
    }),
    { name: 'notesage-model-fit-measurements' },
  ),
);
