// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler, getListenerCount } from '@/test/tauri-mock';
import {
  pauseRecordingCapture,
  recordingErrorText,
  recordingSourceLabel,
  resumeRecordingCapture,
  startRecordedTimeTicker,
  stopRecordedTimeTicker,
  useRecording,
} from '@/hooks/useRecording';
import { useRecordingStore } from '@/stores/recording-store';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useRecordingStore.setState({
    phase: 'idle',
    isRecording: false,
    recordingSource: 'microphone',
    recordingStartTime: null,
    isPaused: false,
    pauseStartedAt: null,
    pausedTotalMs: 0,
    recordedSeconds: 0,
    availableModels: [],
    activeDownloads: {},
    defaultModel: 'base',
    speechLanguage: 'en',
    lastUsedSource: 'microphone',
  });
}

/** Put the store in "a recording is live", the way the flow does. */
function goLive() {
  useRecordingStore.getState().startRecording('microphone');
}

describe('useRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    stopRecordedTimeTicker();
    vi.useRealTimers();
  });

  it('returns the idle state', () => {
    const { result } = renderHook(() => useRecording());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.source).toBe('microphone');
  });

  it('does not listen to recording-level: levels never reach React state', () => {
    renderHook(() => useRecording());
    expect(getListenerCount('recording-level')).toBe(0);
  });

  // -----------------------------------------------------------------
  // Pause / resume
  // -----------------------------------------------------------------

  it('pause and resume call the backend and move the phase', async () => {
    const pause = vi.fn(() => undefined);
    const resume = vi.fn(() => undefined);
    setMockInvokeHandler('pause_recording', pause);
    setMockInvokeHandler('resume_recording', resume);
    goLive();

    await pauseRecordingCapture();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().phase).toBe('paused');
    expect(useRecordingStore.getState().isPaused).toBe(true);
    expect(useRecordingStore.getState().announcement.text).toBe('Recording paused');

    await resumeRecordingCapture();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().phase).toBe('recording');
    expect(useRecordingStore.getState().announcement.text).toBe('Recording resumed');
  });

  it('pause does nothing unless a recording is running; resume nothing unless paused', async () => {
    const pause = vi.fn(() => undefined);
    const resume = vi.fn(() => undefined);
    setMockInvokeHandler('pause_recording', pause);
    setMockInvokeHandler('resume_recording', resume);

    await pauseRecordingCapture();
    await resumeRecordingCapture();
    goLive();
    await resumeRecordingCapture();
    useRecordingStore.getState().setPhase('stopping');
    await pauseRecordingCapture();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failed pause leaves the recording running and says why', async () => {
    setMockInvokeHandler('pause_recording', () => {
      throw new Error('stream busy');
    });
    goLive();
    await pauseRecordingCapture();
    expect(useRecordingStore.getState().phase).toBe('recording');
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toBe(
      'Could not pause the recording: stream busy',
    );
  });

  it('folds a pause stretch into pausedTotalMs', async () => {
    vi.useFakeTimers();
    setMockInvokeHandler('pause_recording', () => undefined);
    setMockInvokeHandler('resume_recording', () => undefined);
    goLive();
    await pauseRecordingCapture();
    vi.advanceTimersByTime(30_000);
    await resumeRecordingCapture();
    expect(useRecordingStore.getState().pausedTotalMs).toBe(30_000);
  });

  // -----------------------------------------------------------------
  // The recorded-time clock (U8, U9)
  // -----------------------------------------------------------------

  describe('recorded time', () => {
    it('shows what the backend has WRITTEN, not the wall clock', async () => {
      vi.useFakeTimers();
      let written = 0;
      setMockInvokeHandler('get_recording_state', () => ({
        recording: true,
        paused: false,
        source: 'microphone',
        started_at_ms: Date.now(),
        elapsed_recorded_ms: written,
      }));
      goLive();
      const { result } = renderHook(() => useRecording());
      startRecordedTimeTicker();

      // Ten wall-clock seconds pass but only four seconds of audio landed
      // (a device stalled): the timer says four.
      written = 4_200;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(useRecordingStore.getState().recordedSeconds).toBe(4);
      expect(result.current.elapsedTime).toBe(4);
    });

    it('falls back to the pause-aware wall clock when the backend has no such command', async () => {
      vi.useFakeTimers();
      setMockInvokeHandler('get_recording_state', () => {
        throw new Error('unknown command');
      });
      setMockInvokeHandler('pause_recording', () => undefined);
      setMockInvokeHandler('resume_recording', () => undefined);
      goLive();
      startRecordedTimeTicker();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(useRecordingStore.getState().recordedSeconds).toBe(10);

      // Frozen while paused; the paused stretch is not counted afterwards.
      await pauseRecordingCapture();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(useRecordingStore.getState().recordedSeconds).toBe(10);
      await resumeRecordingCapture();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(useRecordingStore.getState().recordedSeconds).toBe(15);
    });

    it('writes the store once per second, not once per tick', async () => {
      vi.useFakeTimers();
      setMockInvokeHandler('get_recording_state', () => {
        throw new Error('unknown command');
      });
      goLive();
      let writes = 0;
      const unsubscribe = useRecordingStore.subscribe(() => {
        writes += 1;
      });
      startRecordedTimeTicker();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      unsubscribe();
      // Ten ticks at 500 ms, five whole seconds.
      expect(writes).toBe(5);
    });

    it('stops with the recording', async () => {
      vi.useFakeTimers();
      const state = vi.fn(() => ({
        recording: true,
        paused: false,
        source: 'microphone',
        started_at_ms: 0,
        elapsed_recorded_ms: 1000,
      }));
      setMockInvokeHandler('get_recording_state', state);
      goLive();
      startRecordedTimeTicker();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      stopRecordedTimeTicker();
      const calls = state.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(state.mock.calls.length).toBe(calls);
    });

    it('reads zero when nothing is being recorded', () => {
      useRecordingStore.setState({ recordedSeconds: 42 });
      const { result } = renderHook(() => useRecording());
      expect(result.current.elapsedTime).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  // Words
  // -----------------------------------------------------------------

  it('names the three sources', () => {
    expect(recordingSourceLabel('microphone')).toBe('Microphone');
    expect(recordingSourceLabel('system')).toBe('System audio');
    expect(recordingSourceLabel('both')).toBe('Microphone + system audio');
  });

  it("translates the backend's start failures (its exact strings) and keeps unknown ones verbatim", () => {
    expect(recordingErrorText(new Error('System audio recording requires macOS 14.2 or later'))).toBe(
      'Needs macOS 14.2 or later',
    );
    expect(recordingErrorText('System audio recording is not available on this platform')).toBe(
      'Needs macOS 14.2 or later',
    );
    expect(recordingErrorText('Microphone access is denied: enable it in System Settings')).toContain(
      'Allow the microphone',
    );
    expect(recordingErrorText('Not enough free disk space to record (120 MB free)')).toBe(
      'Not enough free disk space',
    );
    expect(recordingErrorText('Recording already in progress')).toBe('A recording is already in progress');
    expect(recordingErrorText('No microphone available')).toBe('No microphone was found');
    expect(recordingErrorText(new Error('something novel'))).toBe('something novel');
  });

  it('does not put a familiar sentence over an unrelated failure', () => {
    // "unsupported" and "system" appear in errors that are about neither
    // macOS 14.2 nor a permission.
    for (const raw of [
      'Failed to open stream: unsupported sample format',
      'System audio cannot be captured from this output device (it has inputs)',
      'Failed to create the staging folder: permission denied (os error 13)',
    ]) {
      expect(recordingErrorText(raw)).toBe(raw);
    }
  });
});
