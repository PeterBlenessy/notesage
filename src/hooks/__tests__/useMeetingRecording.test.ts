// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import {
  useMeetingRecording,
  __resetLiveRecordingItemId,
} from '@/hooks/useMeetingRecording';
import { useRecordingStore } from '@/stores/recording-store';
import { useActivityStore } from '@/stores/activity-store';

vi.mock('@/hooks/useTranscriptionJob', () => ({
  startTranscription: vi.fn(),
}));

import { startTranscription } from '@/hooks/useTranscriptionJob';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AUDIO_INFO = {
  path: '/tmp/recordings/meeting/audio.wav',
  duration_secs: 5.2,
  sample_rate: 16000,
  source: 'microphone',
  rms: 0.05,
  peak: 0.3,
};

function resetStores() {
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
}

function recordingItems() {
  return useActivityStore.getState().tasks.filter((t) => t.kind === 'recording');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMeetingRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    setMockInvokeHandler('start_recording', () => undefined);
    setMockInvokeHandler('stop_recording', () => MOCK_AUDIO_INFO);
  });

  it('start adds a recording activity item; stop removes it and fires transcription', async () => {
    const { result, rerender } = renderHook(() => useMeetingRecording());

    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(recordingItems()).toHaveLength(1);

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(recordingItems()).toHaveLength(0);
    expect(startTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: MOCK_AUDIO_INFO.path }),
    );
  });

  it('forwards recording start/stop/length to the transcription job', async () => {
    const { result, rerender } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });
    // start path set recordingStartTime on the store.
    const startedAt = useRecordingStore.getState().recordingStartTime;
    expect(typeof startedAt).toBe('number');

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(startTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        audioPath: MOCK_AUDIO_INFO.path,
        recordingStartedAt: startedAt,
        recordingDurationSecs: MOCK_AUDIO_INFO.duration_secs,
        recordingStoppedAt: expect.any(Number),
      }),
    );
  });

  /**
   * Regression: the live recording item id used to live in a per-component
   * useRef. The StatusTray popover MicButton unmounts when the popover
   * closes, so stopping from a remounted (or different) surface left the
   * orb's "Recording" indicator stuck forever.
   */
  it('removes the orb item when stop comes from a different hook instance (popover remount)', async () => {
    // Surface A: MicButton instance that starts the recording, then unmounts
    // (user closes the StatusTray popover).
    const a = renderHook(() => useMeetingRecording());
    await act(async () => {
      await a.result.current.toggleRecording();
    });
    expect(recordingItems()).toHaveLength(1);
    a.unmount();

    // Surface B: fresh MicButton instance (popover reopened) stops it.
    const b = renderHook(() => useMeetingRecording());
    expect(b.result.current.isRecording).toBe(true);
    await act(async () => {
      await b.result.current.toggleRecording();
    });

    expect(recordingItems()).toHaveLength(0);
    expect(startTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: MOCK_AUDIO_INFO.path }),
    );
  });

  it('removes the orb item when the backend start fails (no stuck indicator)', async () => {
    setMockInvokeHandler('start_recording', () => {
      throw new Error('no microphone');
    });

    const { result } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });

    // useRecording swallows the error (toast) — the orb item must still be gone.
    expect(recordingItems()).toHaveLength(0);
    expect(useRecordingStore.getState().isRecording).toBe(false);
  });

  it('pause/resume round-trips the backend and tracks paused time in the store', async () => {
    vi.useFakeTimers();
    try {
      const pauseHandler = vi.fn(() => undefined);
      const resumeHandler = vi.fn(() => undefined);
      setMockInvokeHandler('pause_recording', pauseHandler);
      setMockInvokeHandler('resume_recording', resumeHandler);

      const { result } = renderHook(() => useMeetingRecording());
      await act(async () => {
        await result.current.toggleRecording();
      });
      expect(result.current.isPaused).toBe(false);

      await act(async () => {
        await result.current.pauseRecording();
      });
      expect(pauseHandler).toHaveBeenCalled();
      expect(useRecordingStore.getState().isPaused).toBe(true);

      // 30 s pass while paused — folded into pausedTotalMs on resume.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      await act(async () => {
        await result.current.resumeRecording();
      });
      expect(resumeHandler).toHaveBeenCalled();
      expect(useRecordingStore.getState().isPaused).toBe(false);
      expect(useRecordingStore.getState().pausedTotalMs).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopping while paused still stops, clears the item, and fires transcription', async () => {
    setMockInvokeHandler('pause_recording', () => undefined);

    const { result, rerender } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });
    await act(async () => {
      await result.current.pauseRecording();
    });
    expect(useRecordingStore.getState().isPaused).toBe(true);

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(recordingItems()).toHaveLength(0);
    expect(useRecordingStore.getState().isRecording).toBe(false);
    expect(useRecordingStore.getState().isPaused).toBe(false);
    expect(startTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: MOCK_AUDIO_INFO.path }),
    );
  });

  // ---------------------------------------------------------------------
  // Recording UX recovery (#698) — per-recording language override
  // ---------------------------------------------------------------------

  it("forwards the recording item's picked language override to the transcription job", async () => {
    const { result, rerender } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });

    const item = recordingItems()[0];
    expect(item).toBeTruthy();
    act(() => {
      useActivityStore.getState().setRecordingLanguage(item.id, 'sv');
    });

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(startTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: MOCK_AUDIO_INFO.path, language: 'sv' }),
    );
  });

  it('omits language when no per-recording override was picked (transcription job falls back to the global default)', async () => {
    const { result, rerender } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });

    const call = (startTranscription as ReturnType<typeof vi.fn>).mock.calls[0][0] as { language?: string };
    expect(call.language).toBeUndefined();
  });

  it('removes the orb item even when stop_recording errors', async () => {
    setMockInvokeHandler('stop_recording', () => {
      throw new Error('backend gone');
    });

    const { result, rerender } = renderHook(() => useMeetingRecording());
    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(recordingItems()).toHaveLength(1);

    rerender();
    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(recordingItems()).toHaveLength(0);
    expect(startTranscription).not.toHaveBeenCalled();
  });
});
