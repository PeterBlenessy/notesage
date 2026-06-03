import { useEffect, useRef, useState } from 'react';
import { tauriApi } from '@/lib/tauri';
import type { LocalModelInfo } from '@/lib/tauri';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { toModelFitInput, capabilitySource } from '@/lib/ai/model-fit';

/**
 * Orchestrates the hardware-aware model-fit verdicts for a set of models:
 *
 *  1. Detects the hardware profile once per session (cached in the store).
 *  2. Estimates fit + tok/s for every candidate with a usable input.
 *  3. Reads GGUF capabilities (FIM / tool template) per model, best-effort,
 *     deduped — a failed read just leaves the model "unverified".
 *
 * The store is the source of truth (`fitById` / `capsById`); this hook only
 * populates it. Returns coarse loading flags for skeleton states.
 */
export function useModelFit(models: LocalModelInfo[]) {
  const hardwareProfile = useLocalAIStore((s) => s.hardwareProfile);
  const planningCtx = useSettingsStore((s) => s.localPlanningContext);
  const [fitsLoading, setFitsLoading] = useState(false);
  const [capsLoading, setCapsLoading] = useState(false);

  // Models whose capabilities we've already requested (avoid refetch storms).
  const capsRequested = useRef<Set<string>>(new Set());

  // 1. Detect hardware profile once.
  useEffect(() => {
    if (hardwareProfile) return;
    let cancelled = false;
    tauriApi
      .detectHardwareProfile()
      .then((p) => {
        if (!cancelled) useLocalAIStore.getState().setHardwareProfile(p);
      })
      .catch((e) => console.warn('[model-fit] hardware detect failed:', e));
    return () => {
      cancelled = true;
    };
  }, [hardwareProfile]);

  // Stable key for the candidate set.
  const modelsKey = models.map((m) => m.id).sort().join(',');

  // 2. Estimate fit when profile + models are available.
  useEffect(() => {
    if (!hardwareProfile || models.length === 0) return;
    const inputs = models
      .map((m) =>
        toModelFitInput({
          id: m.id,
          size_bytes: m.size_bytes,
          parameters: m.parameters,
          quantization: m.quantization,
          filename: m.filename,
        }),
      )
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (inputs.length === 0) return;

    let cancelled = false;
    setFitsLoading(true);
    tauriApi
      .estimateModelFit(inputs, hardwareProfile, planningCtx)
      .then((results) => {
        if (!cancelled) useLocalAIStore.getState().setModelFits(results);
      })
      .catch((e) => console.warn('[model-fit] estimate failed:', e))
      .finally(() => {
        if (!cancelled) setFitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareProfile, planningCtx, modelsKey]);

  // 3. Read capabilities per model, best-effort + deduped.
  useEffect(() => {
    if (models.length === 0) return;
    const toFetch = models.filter((m) => !capsRequested.current.has(m.id));
    if (toFetch.length === 0) return;

    let cancelled = false;
    setCapsLoading(true);
    Promise.all(
      toFetch.map(async (m) => {
        capsRequested.current.add(m.id);
        const { resolveUrl, localPath } = capabilitySource(m);
        if (!resolveUrl && !localPath) return;
        try {
          const caps = await tauriApi.readGgufCapabilities(resolveUrl, localPath);
          if (!cancelled) useLocalAIStore.getState().setModelCaps(m.id, caps);
        } catch {
          // Unverified — UI falls back to the catalog flag with a marker.
        }
      }),
    ).finally(() => {
      if (!cancelled) setCapsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey]);

  return { hardwareProfile, fitsLoading, capsLoading };
}
