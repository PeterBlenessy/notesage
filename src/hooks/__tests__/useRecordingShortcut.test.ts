// @vitest-environment jsdom
/**
 * Regression test for audit 2026-11-22 §3 (HIGH): `useRecordingShortcut` is
 * mounted in `App`, so any state it holds re-renders the whole tree. It used
 * to go through `useMeetingRecording()` → `useRecording()`, which ticked
 * `elapsedTime` every second and mirrored `recording-level` events
 * (~50–100/s) into state for the entire recording.
 *
 * The shortcut must act on the recording without subscribing to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { useRecordingShortcut } from '@/hooks/useRecordingShortcut';
import { __resetLiveRecordingItemId } from '@/hooks/useMeetingRecording';
import { useRecordingStore } from '@/stores/recording-store';
import { useActivityStore } from '@/stores/activity-store';

vi.mock('@/hooks/useTranscriptionJob', () => ({
  startTranscription: vi.fn(),
}));

import { startTranscription } from '@/hooks/useTranscriptionJob';

const MOCK_AUDIO_INFO = {
  path: '/tmp/recordings/meeting/audio.wav',
  duration_secs: 5.2,
  sample_rate: 16000,
  source: 'microphone',
  rms: 0.05,
  peak: 0.3,
};

async function pressShortcut(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('notesage:toggle-recording'));
    // start/stop are async chains of mocked invokes — let them settle.
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useRecordingShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      recordingSource: 'microphone',
      recordingStartTime: null,
      isPaused: false,
      pauseStartedAt: null,
      pausedTotalMs: 0,
    });
    useActivityStore.setState({ tasks: [] });
    __resetLiveRecordingItemId();
    setMockInvokeHandler('start_recording', () => undefined);
    setMockInvokeHandler('stop_recording', () => MOCK_AUDIO_INFO);
    setMockInvokeHandler('file_size', () => 166_444);
    setMockInvokeHandler('get_device_name', () => 'Mac');
    setMockInvokeHandler('write_file', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never re-renders its host while a recording starts, runs and stops', async () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      useRecordingShortcut();
    });
    expect(renders).toBe(1);

    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(true);

    // A recording in progress: ten seconds of elapsed-time ticks, a burst of
    // audio-callback level events, pause/resume, and unrelated store writes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      for (let i = 0; i < 100; i++) {
        emitMockEvent('recording-level', { mic: 0.5, system: 0.5 });
      }
      useRecordingStore.getState().pauseRecording();
      useRecordingStore.getState().resumeRecording();
      useRecordingStore.getState().setTranscriptionProgress(0.4);
    });

    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(false);

    expect(renders).toBe(1);
  });

  it('still toggles: starts when idle, stops and dispatches the transcription when recording', async () => {
    renderHook(() => useRecordingShortcut());

    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(true);
    expect(useActivityStore.getState().tasks.filter((t) => t.kind === 'recording')).toHaveLength(1);

    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(false);
    expect(useActivityStore.getState().tasks.filter((t) => t.kind === 'recording')).toHaveLength(0);
    expect(startTranscription).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startTranscription).mock.calls[0][0]).toMatchObject({
      audioPath: MOCK_AUDIO_INFO.path,
    });
  });

  it('stops listening on unmount', async () => {
    const { unmount } = renderHook(() => useRecordingShortcut());
    unmount();
    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(false);
  });
});
