import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useModelFitMeasurementStore } from '@/stores/model-fit-measurement-store';

/**
 * Phase 2 runtime calibration capture. Mounted once, app-wide. For **local**
 * generations only, records a real measurement: the model's decode tok/s +
 * token count from llama-server, plus the peak RSS of the local server polled
 * during the generation.
 *
 * It listens on two GLOBAL events the bundled-server path emits around every
 * generation (`local_inference.rs` `LocalGenerationSpan`), each carrying the
 * `streamId` in its payload:
 *
 *   ai-local-generation-started   { streamId }
 *   ai-local-generation-finished  { streamId, tokPerSec, tokens }
 *
 * It must NOT listen on `ai-stream-chunk` / `ai-stream-done`: those are
 * emitted as `<name>:<streamId>` and Tauri does no wildcard matching, so an
 * app-wide listener on the plain names never fires — which is how calibration
 * silently stopped recording.
 *
 * Nothing here is transmitted anywhere — the sample is written to the local
 * measurement store and stays on-device.
 */
const MIN_DECODE_TOKENS = 32;
const RSS_POLL_MS = 300;

export const LOCAL_GENERATION_STARTED_EVENT = 'ai-local-generation-started';
export const LOCAL_GENERATION_FINISHED_EVENT = 'ai-local-generation-finished';

interface GenerationStartedPayload {
  streamId: string;
}

interface GenerationFinishedPayload {
  streamId: string;
  tokPerSec: number | null;
  tokens: number | null;
}

export function useModelFitCapture() {
  useEffect(() => {
    // Peak RSS seen so far, per in-flight generation (keyed by streamId).
    const peakRssByStream = new Map<string, number>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
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
          // One server serves every local generation, so a sample counts
          // towards each generation in flight when it was taken.
          for (const [streamId, peak] of peakRssByStream) {
            if (rss > peak) peakRssByStream.set(streamId, rss);
          }
        } catch {
          /* server not running / no permission — ignore */
        }
      };
      void tick();
      pollTimer = setInterval(tick, RSS_POLL_MS);
    };

    const onStarted = (payload: GenerationStartedPayload) => {
      if (typeof payload?.streamId !== 'string') return;
      peakRssByStream.set(payload.streamId, 0);
      startPolling();
    };

    const onFinished = (payload: GenerationFinishedPayload) => {
      if (typeof payload?.streamId !== 'string') return;
      const peakRss = peakRssByStream.get(payload.streamId);
      // Not one we saw start (e.g. it began before this hook mounted): there
      // is no RSS reading to pair the timings with, so skip the sample.
      if (peakRss === undefined) return;
      peakRssByStream.delete(payload.streamId);
      if (peakRssByStream.size === 0) stopPolling();

      // Cancelled / failed / tool-call turns report no timings; also require
      // a meaningful decode length.
      const { tokPerSec, tokens } = payload;
      if (!tokPerSec || !tokens || tokens < MIN_DECODE_TOKENS) return;

      const { activeModelId, hardwareProfile } = useLocalAIStore.getState();
      if (!activeModelId) return;
      useModelFitMeasurementStore.getState().recordMeasurement({
        modelId: activeModelId,
        tokPerSec,
        peakRamBytes: peakRss,
        decodeTokens: tokens,
        chipName: hardwareProfile?.chip_name ?? 'unknown',
      });
    };

    void (async () => {
      const subs: Array<Promise<UnlistenFn>> = [
        listen<GenerationStartedPayload>(LOCAL_GENERATION_STARTED_EVENT, (e) =>
          onStarted(e.payload),
        ),
        listen<GenerationFinishedPayload>(LOCAL_GENERATION_FINISHED_EVENT, (e) =>
          onFinished(e.payload),
        ),
      ];
      const resolved = await Promise.all(subs);
      if (disposed) {
        resolved.forEach((u) => u());
        return;
      }
      unlisteners.push(...resolved);
    })().catch((err: unknown) => {
      log.warn('model-fit', 'Failed to subscribe to local generation events', err);
    });

    return () => {
      disposed = true;
      stopPolling();
      peakRssByStream.clear();
      unlisteners.forEach((u) => u());
    };
  }, []);
}
