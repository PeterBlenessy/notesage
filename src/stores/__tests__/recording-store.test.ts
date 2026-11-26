// @vitest-environment jsdom
/**
 * recording-store: the phase, the non-rendering level channel, warnings,
 * model downloads (U30), and the dead state that is gone (U31).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { toast } from 'sonner';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import {
  isDefaultModelDownloaded,
  nextDownloadState,
  publishRecordingLevels,
  readRecordingLevels,
  resetRecordingLevels,
  useRecordingStore,
} from '@/stores/recording-store';

const MB = 1024 * 1024;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRecordingLevels();
  useRecordingStore.setState({
    phase: 'idle',
    isRecording: false,
    isPaused: false,
    recordedSeconds: 0,
    warnings: [],
    activeDownloads: {},
    downloadErrors: {},
    availableModels: [],
    modelsLoaded: false,
    defaultModel: 'large-v3-turbo-q5_0',
    lastUsedSource: 'microphone',
  });
});

describe('dead state (U31)', () => {
  it('no longer carries the unused transcription progress', () => {
    const state = useRecordingStore.getState() as unknown as Record<string, unknown>;
    expect('transcriptionProgress' in state).toBe(false);
    expect('setTranscriptionProgress' in state).toBe(false);
  });

  it('the source fields are live: starting records the source and makes it the next default', () => {
    useRecordingStore.getState().startRecording('both');
    expect(useRecordingStore.getState().recordingSource).toBe('both');
    expect(useRecordingStore.getState().lastUsedSource).toBe('both');
    useRecordingStore.getState().setLastUsedSource('system');
    expect(useRecordingStore.getState().lastUsedSource).toBe('system');
    // The live recording's source does not change under it.
    expect(useRecordingStore.getState().recordingSource).toBe('both');
  });

  it('persists the source choice, the model and the language — and nothing live', () => {
    const persisted = useRecordingStore.persist.getOptions().partialize?.(useRecordingStore.getState());
    expect(Object.keys(persisted as object).sort()).toEqual(['defaultModel', 'lastUsedSource', 'speechLanguage']);
  });

  it('falls back to the microphone when storage holds a source it does not know', () => {
    const merge = useRecordingStore.persist.getOptions().merge!;
    const current = useRecordingStore.getState();
    expect(merge({ lastUsedSource: 'loopback' }, current).lastUsedSource).toBe('microphone');
    expect(merge({ lastUsedSource: 'both' }, current).lastUsedSource).toBe('both');
    expect(merge(null, current).lastUsedSource).toBe('microphone');
  });
});

describe('phase', () => {
  it('start, pause, resume and stop keep phase, isRecording and isPaused in step', () => {
    const s = () => useRecordingStore.getState();
    s().startRecording('microphone');
    expect([s().phase, s().isRecording, s().isPaused]).toEqual(['recording', true, false]);
    s().pauseRecording();
    expect([s().phase, s().isRecording, s().isPaused]).toEqual(['paused', true, true]);
    s().resumeRecording();
    expect([s().phase, s().isRecording, s().isPaused]).toEqual(['recording', true, false]);
    s().stopRecording();
    expect([s().phase, s().isRecording, s().isPaused]).toEqual(['idle', false, false]);
  });

  it('a new recording starts clean: no time, no warnings from the last one', () => {
    useRecordingStore.setState({ recordedSeconds: 99, warnings: [{ kind: 'low-disk', source: null }] });
    useRecordingStore.getState().startRecording('microphone');
    expect(useRecordingStore.getState().recordedSeconds).toBe(0);
    expect(useRecordingStore.getState().warnings).toEqual([]);
  });

  it('writes recorded seconds only when the whole second changes', () => {
    let writes = 0;
    const unsubscribe = useRecordingStore.subscribe(() => { writes += 1; });
    const set = useRecordingStore.getState().setRecordedSeconds;
    set(1.1);
    set(1.6);
    set(1.99);
    set(2);
    unsubscribe();
    expect(writes).toBe(2);
    expect(useRecordingStore.getState().recordedSeconds).toBe(2);
  });
});

describe('warnings', () => {
  it('keeps one per kind and source, and dismisses precisely', () => {
    const s = useRecordingStore.getState();
    s.addWarning({ kind: 'silence', source: 'microphone' });
    s.addWarning({ kind: 'silence', source: 'microphone' });
    s.addWarning({ kind: 'silence', source: 'system' });
    s.addWarning({ kind: 'low-disk', source: null });
    expect(useRecordingStore.getState().warnings).toHaveLength(3);

    s.dismissWarning('silence', 'system');
    expect(useRecordingStore.getState().warnings).toEqual([
      { kind: 'silence', source: 'microphone' },
      { kind: 'low-disk', source: null },
    ]);
    // Without a source: every warning of that kind.
    s.dismissWarning('silence');
    expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'low-disk', source: null }]);
  });

  it('does not write the store when there is nothing to dismiss', () => {
    let writes = 0;
    const unsubscribe = useRecordingStore.subscribe(() => { writes += 1; });
    useRecordingStore.getState().dismissWarning('silence');
    unsubscribe();
    expect(writes).toBe(0);
  });
});

describe('levels live outside the store (U8)', () => {
  it('publishing levels writes NO store state', () => {
    let writes = 0;
    const unsubscribe = useRecordingStore.subscribe(() => { writes += 1; });
    for (let i = 0; i < 100; i++) publishRecordingLevels({ mic: i / 100, system: null });
    unsubscribe();
    expect(writes).toBe(0);
    expect(readRecordingLevels().mic).toBe(0.99);
    expect(readRecordingLevels().system).toBeNull();
    expect(readRecordingLevels().at).toBeGreaterThan(0);
  });

  it('clamps to 0..1 and treats junk as "not captured"', () => {
    publishRecordingLevels({ mic: 3, system: -1 });
    expect(readRecordingLevels().mic).toBe(1);
    expect(readRecordingLevels().system).toBe(0);
    publishRecordingLevels({ mic: Number.NaN, system: null });
    expect(readRecordingLevels().mic).toBeNull();
  });
});

describe('download progress (U30)', () => {
  it('reports percent, bytes, a smoothed speed and an estimate', () => {
    const total = 500 * MB;
    let step = nextDownloadState(undefined, 0, total, 0);
    expect(step.state).toMatchObject({ progress: 0, downloadedBytes: 0, totalBytes: total, etaSecs: null });

    // 5 MB/s for one second: 1%.
    step = nextDownloadState(step.tracker, 5 * MB, total, 1000);
    expect(step.state?.progress).toBe(1);
    expect(step.state?.bytesPerSec).toBeCloseTo(5 * MB, -3);
    expect(step.state?.etaSecs).toBe(99);
  });

  it('emits nothing between whole percents', () => {
    const total = 1000 * MB;
    const first = nextDownloadState(undefined, 0, total, 0);
    // Ten events a second for half a percent.
    let tracker = first.tracker;
    let emitted = 0;
    for (let i = 1; i <= 50; i++) {
      const next = nextDownloadState(tracker, i * 0.1 * MB, total, i * 100);
      tracker = next.tracker;
      if (next.state) emitted += 1;
    }
    expect(emitted).toBe(0);
  });

  it('with no total from the server: no percent and no estimate, but megabytes still move', () => {
    let step = nextDownloadState(undefined, 0, 0, 0);
    expect(step.state).toMatchObject({ progress: 0, totalBytes: 0, etaSecs: null });
    // Below a megabyte: nothing to show yet.
    step = nextDownloadState(step.tracker, 0.5 * MB, 0, 500);
    expect(step.state).toBeNull();
    step = nextDownloadState(step.tracker, 3 * MB, 0, 1000);
    expect(step.state).toMatchObject({ progress: 0, downloadedBytes: 3 * MB, totalBytes: 0, etaSecs: null });
    expect(step.state?.bytesPerSec).toBeGreaterThan(0);
  });

  it('stores integer percents from the event stream, and only when they change', async () => {
    const gate = deferred<undefined>();
    setMockInvokeHandler('download_whisper_model', () => gate.promise);
    setMockInvokeHandler('list_whisper_models', () => []);
    useRecordingStore.getState().downloadModel('base');
    await settle();
    expect(useRecordingStore.getState().activeDownloads.base).toMatchObject({ progress: 0 });

    let writes = 0;
    const unsubscribe = useRecordingStore.subscribe(() => { writes += 1; });
    const total = 100 * MB;
    for (let i = 0; i <= 250; i++) {
      // 250 events covering 0..25%: 0.1% each.
      emitMockEvent('model-download-progress', { model: 'base', downloaded: (i / 1000) * total, total });
    }
    // Another model's events are not this download's.
    emitMockEvent('model-download-progress', { model: 'tiny', downloaded: total, total });
    unsubscribe();

    const state = useRecordingStore.getState().activeDownloads.base;
    expect(state.progress).toBe(25);
    expect(Number.isInteger(state.progress)).toBe(true);
    expect(state.totalBytes).toBe(total);
    // 26 distinct percents (0..25); the first event (0%) is the tracker's start.
    expect(writes).toBe(26);

    gate.resolve(undefined);
    await settle();
    expect(useRecordingStore.getState().activeDownloads.base).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('Model base downloaded');
  });

  it('a failed download is remembered, toasts with Retry, and retrying clears the error', async () => {
    let attempts = 0;
    setMockInvokeHandler('download_whisper_model', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Download stalled: no data received for 30 seconds');
      return undefined;
    });
    setMockInvokeHandler('list_whisper_models', () => [{ name: 'base', size_bytes: 1, downloaded: true }]);

    useRecordingStore.getState().downloadModel('base');
    await settle();
    expect(useRecordingStore.getState().activeDownloads.base).toBeUndefined();
    expect(useRecordingStore.getState().downloadErrors.base).toContain('Download stalled');

    const [message, options] = vi.mocked(toast.error).mock.calls[0];
    expect(String(message)).toBe(
      'Downloading base failed: Download stalled: no data received for 30 seconds',
    );
    const action = (options as { action: { label: string; onClick: () => void } }).action;
    expect(action.label).toBe('Retry');

    action.onClick();
    expect(useRecordingStore.getState().downloadErrors.base).toBeUndefined();
    await settle();
    expect(attempts).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('Model base downloaded');
  });

  it('a cancelled download is not an error', async () => {
    setMockInvokeHandler('download_whisper_model', () => {
      throw new Error('Download cancelled');
    });
    useRecordingStore.getState().downloadModel('base');
    await settle();
    expect(useRecordingStore.getState().downloadErrors.base).toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not start the same download twice', async () => {
    const start = vi.fn(() => new Promise(() => {}));
    setMockInvokeHandler('download_whisper_model', start);
    useRecordingStore.getState().downloadModel('base');
    useRecordingStore.getState().downloadModel('base');
    await settle();
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('models', () => {
  it('knows whether the selected model is on disk, and only claims it after a load', async () => {
    expect(useRecordingStore.getState().modelsLoaded).toBe(false);
    setMockInvokeHandler('list_whisper_models', () => [
      { name: 'large-v3-turbo-q5_0', size_bytes: 1, downloaded: false },
      { name: 'base', size_bytes: 1, downloaded: true },
    ]);
    await useRecordingStore.getState().refreshModels();
    expect(useRecordingStore.getState().modelsLoaded).toBe(true);
    expect(isDefaultModelDownloaded(useRecordingStore.getState())).toBe(false);
    useRecordingStore.getState().setDefaultModel('base');
    expect(isDefaultModelDownloaded(useRecordingStore.getState())).toBe(true);
  });

  it('a failed model list says so in the user\'s words and does not claim "loaded"', async () => {
    setMockInvokeHandler('list_whisper_models', () => {
      throw new Error('boom');
    });
    await useRecordingStore.getState().refreshModels();
    expect(useRecordingStore.getState().modelsLoaded).toBe(false);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain(
      'Could not load the transcription models',
    );
  });

  it('deleting the selected model moves the selection to one that is on disk', async () => {
    setMockInvokeHandler('delete_whisper_model', () => undefined);
    setMockInvokeHandler('list_whisper_models', () => [
      { name: 'large-v3-turbo-q5_0', size_bytes: 1, downloaded: false },
      { name: 'base', size_bytes: 1, downloaded: true },
    ]);
    await useRecordingStore.getState().deleteModel('large-v3-turbo-q5_0');
    expect(useRecordingStore.getState().defaultModel).toBe('base');
  });
});
