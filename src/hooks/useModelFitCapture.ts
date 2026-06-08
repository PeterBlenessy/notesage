import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useModelFitMeasurementStore } from '@/stores/model-fit-measurement-store';

/**
 * Phase 2 runtime calibration capture. Mounted once, app-wide. Watches the AI
 * stream events and, for **local** generations only (the `ai-stream-timings`
 * event is emitted exclusively by the bundled-server path), records a real
 * measurement: the model's decode tok/s + token count from llama-server, plus
 * the peak RSS of the local server polled during the generation.
 *
 * Nothing here is transmitted anywhere — the sample is written to the local
 * measurement store and stays on-device.
 */
const MIN_DECODE_TOKENS = 32;
const RSS_POLL_MS = 300;

export function useModelFitCapture() {
  useEffect(() => {
    let active = false;
    let peakRss = 0;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pending: { tokPerSec: number | null; tokens: number | null } | null = null;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer !== null) return;
      const tick = async () => {
        try {
          const rss = await tauriApi.getLocalServerRss();
          if (rss > peakRss) peakRss = rss;
        } catch {
          /* server not running / no permission — ignore */
        }
      };
      void tick();
      pollTimer = setInterval(tick, RSS_POLL_MS);
    };

    // First content/thinking chunk of a generation → start tracking.
    const onChunk = () => {
      if (active) return;
      active = true;
      peakRss = 0;
      pending = null;
      startPolling();
    };

    void (async () => {
      const subs: Array<Promise<UnlistenFn>> = [
        listen('ai-stream-chunk', onChunk),
        listen('ai-stream-thinking-chunk', onChunk),
        listen<{ tokPerSec: number | null; tokens: number | null }>('ai-stream-timings', (e) => {
          pending = { tokPerSec: e.payload.tokPerSec, tokens: e.payload.tokens };
        }),
        listen('ai-stream-done', () => {
          stopPolling();
          // Only local runs emit timings; require a meaningful decode length.
          if (
            pending &&
            pending.tokPerSec &&
            pending.tokens &&
            pending.tokens >= MIN_DECODE_TOKENS
          ) {
            const { activeModelId, hardwareProfile } = useLocalAIStore.getState();
            if (activeModelId) {
              useModelFitMeasurementStore.getState().recordMeasurement({
                modelId: activeModelId,
                tokPerSec: pending.tokPerSec,
                peakRamBytes: peakRss,
                decodeTokens: pending.tokens,
                chipName: hardwareProfile?.chip_name ?? 'unknown',
              });
            }
          }
          active = false;
          pending = null;
          peakRss = 0;
        }),
      ];
      const resolved = await Promise.all(subs);
      if (disposed) {
        resolved.forEach((u) => u());
        return;
      }
      unlisteners.push(...resolved);
    })();

    return () => {
      disposed = true;
      stopPolling();
      unlisteners.forEach((u) => u());
    };
  }, []);
}
