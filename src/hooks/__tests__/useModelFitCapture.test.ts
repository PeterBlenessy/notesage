// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type Handler = (event: { payload: unknown }) => void;

const { handlers, unlistenCalls, mockGetRss, mockRecord } = vi.hoisted(() => ({
  handlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
  unlistenCalls: [] as string[],
  mockGetRss: vi.fn<() => Promise<number>>(),
  mockRecord: vi.fn<(args: Record<string, unknown>) => void>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
    return () => {
      unlistenCalls.push(name);
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter((h) => h !== handler),
      );
    };
  }),
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: { getLocalServerRss: () => mockGetRss() },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/stores/local-ai-store', () => ({
  useLocalAIStore: {
    getState: () => ({
      activeModelId: 'qwen-test',
      hardwareProfile: { chip_name: 'Apple M3' },
    }),
  },
}));

vi.mock('@/stores/model-fit-measurement-store', () => ({
  useModelFitMeasurementStore: {
    getState: () => ({ recordMeasurement: mockRecord }),
  },
}));

import {
  useModelFitCapture,
  LOCAL_GENERATION_STARTED_EVENT,
  LOCAL_GENERATION_FINISHED_EVENT,
} from '../useModelFitCapture';

/** Deliver a backend event to every listener registered under `name`. */
function emit(name: string, payload: unknown): void {
  for (const handler of handlers.get(name) ?? []) handler({ payload });
}

/** Let the hook's async subscription (and any RSS poll promise) settle. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  unlistenCalls.length = 0;
  mockGetRss.mockReset();
  mockGetRss.mockResolvedValue(0);
  mockRecord.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useModelFitCapture', () => {
  it('subscribes to the global generation events, not the per-stream names', async () => {
    renderHook(() => useModelFitCapture());
    await flush();

    expect([...handlers.keys()].sort()).toEqual([
      'ai-local-generation-finished',
      'ai-local-generation-started',
    ]);
    // These are only ever emitted as `<name>:<streamId>`; listening on the
    // plain names is the bug that stopped calibration from recording.
    expect(handlers.has('ai-stream-chunk')).toBe(false);
    expect(handlers.has('ai-stream-done')).toBe(false);
  });

  it('records a measurement with the peak RSS seen during the generation', async () => {
    mockGetRss
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(3_000);
    renderHook(() => useModelFitCapture());
    await flush();

    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 's1' });
    await flush(); // immediate first sample
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 's1', tokPerSec: 42.5, tokens: 128 });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith({
      modelId: 'qwen-test',
      tokPerSec: 42.5,
      peakRamBytes: 5_000,
      decodeTokens: 128,
      chipName: 'Apple M3',
    });
  });

  it('stops polling RSS once the generation has finished', async () => {
    renderHook(() => useModelFitCapture());
    await flush();

    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 's1' });
    await vi.advanceTimersByTimeAsync(600);
    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 's1', tokPerSec: null, tokens: null });
    const callsAtFinish = mockGetRss.mock.calls.length;
    expect(callsAtFinish).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockGetRss.mock.calls.length).toBe(callsAtFinish);
  });

  it('keeps overlapping generations apart by streamId', async () => {
    renderHook(() => useModelFitCapture());
    await flush();

    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 'a' });
    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 'b' });
    await flush();

    // `a` finishes with its own timings; `b` is still running.
    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 'a', tokPerSec: 10, tokens: 100 });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({ tokPerSec: 10, decodeTokens: 100 });

    // Polling continues for `b`.
    const calls = mockGetRss.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);
    expect(mockGetRss.mock.calls.length).toBeGreaterThan(calls);

    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 'b', tokPerSec: 20, tokens: 200 });
    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockRecord.mock.calls[1][0]).toMatchObject({ tokPerSec: 20, decodeTokens: 200 });
  });

  it('records nothing for a cancelled run or a decode that is too short', async () => {
    renderHook(() => useModelFitCapture());
    await flush();

    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 'cancelled' });
    emit(LOCAL_GENERATION_FINISHED_EVENT, {
      streamId: 'cancelled',
      tokPerSec: null,
      tokens: null,
    });
    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 'short' });
    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 'short', tokPerSec: 50, tokens: 31 });

    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('ignores a finish for a generation it never saw start', async () => {
    renderHook(() => useModelFitCapture());
    await flush();

    emit(LOCAL_GENERATION_FINISHED_EVENT, { streamId: 'unknown', tokPerSec: 50, tokens: 500 });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('unlistens and stops polling on unmount', async () => {
    const { unmount } = renderHook(() => useModelFitCapture());
    await flush();
    emit(LOCAL_GENERATION_STARTED_EVENT, { streamId: 's1' });
    await flush();

    unmount();
    expect(unlistenCalls.sort()).toEqual([
      'ai-local-generation-finished',
      'ai-local-generation-started',
    ]);
    const calls = mockGetRss.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockGetRss.mock.calls.length).toBe(calls);
  });
});
