// @vitest-environment jsdom
//
// Regression coverage for the background transcription orchestrator (audit
// tests A1). Locks the four-state job lifecycle (running → progress → done /
// error), the jobId-scoped progress routing, and the "failed job stays
// re-runnable in the inbox" guarantee.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { useTranscriptionJob, startTranscription } from '@/hooks/useTranscriptionJob';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import type { TranscriptionResult } from '@/lib/tauri';

// `sonner` is mocked by `@/test/tauri-mock` (toast.error is a vi.fn) — use that
// rather than re-mocking it here (the harness mock wins the hoist race anyway).
const toastError = toast.error as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Module mocks — isolate the hook from the real Tauri command + bundle I/O.
// ---------------------------------------------------------------------------

const { transcribeFile, renderTranscript, writeTranscriptToBundle } = vi.hoisted(() => ({
  transcribeFile: vi.fn(),
  renderTranscript: vi.fn(() => '# Transcript\n\nhello world'),
  writeTranscriptToBundle: vi.fn(async () => '/inbox/Meeting A/transcript.md'),
}));

vi.mock('@/lib/tauri', () => ({ tauriApi: { transcribeFile } }));
vi.mock('@/lib/transcription/render-transcript', () => ({ renderTranscript }));
vi.mock('@/lib/transcription/bundle', () => ({ writeTranscriptToBundle }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const AUDIO = '/x/Meeting A/audio.wav';
const SUCCESS: TranscriptionResult = {
  segments: [{ start: 0, end: 1, text: 'hi', speaker_id: null, speaker_name: null }],
  duration_secs: 1.5,
  language: 'en',
};

beforeEach(() => {
  vi.clearAllMocks();
  useActivityStore.setState({ tasks: [] });
  useRecordingStore.setState({ defaultModel: 'small', speechLanguage: 'sv' });
});

function jobTask() {
  return useActivityStore.getState().tasks[0];
}

describe('useTranscriptionJob', () => {
  it('runs the success path: transcribe → render → bundle → done', async () => {
    const d = deferred<TranscriptionResult>();
    transcribeFile.mockReturnValue(d.promise);

    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO, documentId: 'doc-1' }));

    // Activity item is added synchronously, before any await.
    const jobId = jobTask().id;
    expect(jobTask().status).toBe('running');
    expect(jobTask().label).toBe('Meeting A');

    // transcribeFile is invoked with the configured model + language once the
    // progress listener is registered.
    await waitFor(() => expect(transcribeFile).toHaveBeenCalled());
    expect(transcribeFile).toHaveBeenCalledWith(jobId, AUDIO, 'small', 'sv');

    await act(async () => {
      d.resolve(SUCCESS);
      await d.promise.catch(() => {});
    });

    await waitFor(() => expect(jobTask().status).toBe('done'));
    expect(renderTranscript).toHaveBeenCalledWith(SUCCESS.segments, expect.objectContaining({ title: 'Meeting A' }));
    expect(writeTranscriptToBundle).toHaveBeenCalledWith(AUDIO, expect.any(String));
    expect(jobTask().transcriptPath).toBe('/inbox/Meeting A/transcript.md');
    expect(jobTask().progress).toBe(100);
  });

  it('passes the "auto" language through to the backend (no English coercion)', async () => {
    // Regression lock: the store default is 'auto', which must reach the
    // backend verbatim so Whisper auto-detects the language. A truthy 'auto'
    // must not be dropped to undefined nor silently turned into 'en'.
    useRecordingStore.setState({ defaultModel: 'small', speechLanguage: 'auto' });
    const d = deferred<TranscriptionResult>();
    transcribeFile.mockReturnValue(d.promise);

    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const jobId = jobTask().id;

    await waitFor(() => expect(transcribeFile).toHaveBeenCalled());
    expect(transcribeFile).toHaveBeenCalledWith(jobId, AUDIO, 'small', 'auto');
  });

  it('routes transcription-progress only for the matching jobId', async () => {
    const d = deferred<TranscriptionResult>();
    transcribeFile.mockReturnValue(d.promise); // keep job in-flight

    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const jobId = jobTask().id;

    await waitFor(() => expect(transcribeFile).toHaveBeenCalled());

    act(() => emitMockEvent('transcription-progress', { jobId, percent: 42 }));
    expect(jobTask().progress).toBe(42);

    // A progress event for a different job must NOT bleed into this task.
    act(() => emitMockEvent('transcription-progress', { jobId: 'other-job', percent: 99 }));
    expect(jobTask().progress).toBe(42);

    // tidy up the in-flight job
    await act(async () => {
      d.resolve(SUCCESS);
      await d.promise.catch(() => {});
    });
  });

  it('on transcribe failure marks the job errored and leaves it re-runnable', async () => {
    const d = deferred<TranscriptionResult>();
    transcribeFile.mockReturnValue(d.promise);

    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(transcribeFile).toHaveBeenCalled());

    await act(async () => {
      d.reject(new Error('whisper boom'));
      await d.promise.catch(() => {});
    });

    await waitFor(() => expect(jobTask().status).toBe('error'));
    expect(toastError).toHaveBeenCalled();
    // No note written, and the audio path is retained so the bundle can be
    // re-transcribed from the inbox.
    expect(writeTranscriptToBundle).not.toHaveBeenCalled();
    expect(jobTask().transcriptPath).toBeUndefined();
    expect(jobTask().audioPath).toBe(AUDIO);
  });

  it('ignores start events after unmount', () => {
    const { unmount } = renderHook(() => useTranscriptionJob());
    unmount();
    act(() => startTranscription({ audioPath: AUDIO }));
    expect(useActivityStore.getState().tasks).toHaveLength(0);
    expect(transcribeFile).not.toHaveBeenCalled();
  });
});
