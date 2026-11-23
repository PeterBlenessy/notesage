// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler, emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { useRecording } from '@/hooks/useRecording';
import { useRecordingStore } from '@/stores/recording-store';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useRecordingStore.setState({
    isRecording: false,
    recordingSource: 'microphone',
    recordingStartTime: null,
    transcriptionProgress: 0,
    availableModels: [],
    activeDownloads: {},
    defaultModel: 'base',
    speechLanguage: 'en',
    lastUsedSource: 'microphone',
  });
}

const MOCK_AUDIO_INFO = {
  duration_secs: 5.2,
  sample_count: 83200,
  sample_rate: 16000,
  source: 'microphone',
  rms: 0.05,
  peak: 0.3,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- startRecording ----

  describe('startRecording', () => {
    it('calls Tauri start_recording and updates store', async () => {
      const startHandler = vi.fn(() => undefined);
      setMockInvokeHandler('start_recording', startHandler);

      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      expect(startHandler).toHaveBeenCalledWith({ source: 'microphone' });
      expect(result.current.isRecording).toBe(true);
      expect(result.current.source).toBe('microphone');
    });

    it('shows error toast when start_recording fails', async () => {
      setMockInvokeHandler('start_recording', () => {
        throw new Error('Device unavailable');
      });

      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start recording'),
      );
      expect(result.current.isRecording).toBe(false);
    });
  });

  // ---- stopRecording ----

  describe('stopRecording', () => {
    it('calls Tauri stop_recording and returns audio info', async () => {
      setMockInvokeHandler('start_recording', () => undefined);
      setMockInvokeHandler('stop_recording', () => MOCK_AUDIO_INFO);

      const { result } = renderHook(() => useRecording());

      // Start first so store is in recording state
      await act(async () => {
        await result.current.startRecording('microphone');
      });
      expect(result.current.isRecording).toBe(true);

      let info: unknown;
      await act(async () => {
        info = await result.current.stopRecording();
      });

      expect(info).toEqual(MOCK_AUDIO_INFO);
      expect(result.current.isRecording).toBe(false);
    });

    it('shows error toast when stop_recording fails and returns null', async () => {
      setMockInvokeHandler('start_recording', () => undefined);
      setMockInvokeHandler('stop_recording', () => {
        throw new Error('Not recording');
      });

      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      let info: unknown;
      await act(async () => {
        info = await result.current.stopRecording();
      });

      expect(info).toBeNull();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop recording'),
      );
      // Store should still be reset to not-recording
      expect(result.current.isRecording).toBe(false);
    });

    it('shows warning toast when peak is near-zero (silence)', async () => {
      const silentInfo = { ...MOCK_AUDIO_INFO, peak: 0.00001, sample_count: 16000 };
      setMockInvokeHandler('start_recording', () => undefined);
      setMockInvokeHandler('stop_recording', () => silentInfo);

      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });
      await act(async () => {
        await result.current.stopRecording();
      });

      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('No audio detected'),
        expect.objectContaining({ duration: 8000 }),
      );
    });
  });

  // ---- isRecording state transitions ----

  describe('isRecording state transitions', () => {
    it('transitions false → true → false through start/stop', async () => {
      setMockInvokeHandler('start_recording', () => undefined);
      setMockInvokeHandler('stop_recording', () => MOCK_AUDIO_INFO);

      const { result } = renderHook(() => useRecording());

      expect(result.current.isRecording).toBe(false);

      await act(async () => {
        await result.current.startRecording('microphone');
      });
      expect(result.current.isRecording).toBe(true);

      await act(async () => {
        await result.current.stopRecording();
      });
      expect(result.current.isRecording).toBe(false);
    });
  });

  // ---- elapsed time timer ----

  describe('elapsed time timer', () => {
    it('increments elapsed time every second while recording', async () => {
      setMockInvokeHandler('start_recording', () => undefined);

      const { result } = renderHook(() => useRecording());

      expect(result.current.elapsedTime).toBe(0);

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      // Advance 3 seconds
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.elapsedTime).toBeGreaterThanOrEqual(2);
    });

    it('resets elapsed time when recording stops', async () => {
      setMockInvokeHandler('start_recording', () => undefined);
      setMockInvokeHandler('stop_recording', () => MOCK_AUDIO_INFO);

      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.elapsedTime).toBeGreaterThanOrEqual(1);

      await act(async () => {
        await result.current.stopRecording();
      });

      expect(result.current.elapsedTime).toBe(0);
    });
  });

  // ---- recording level events ----

  // Audit 2026-11-22 §3: the backend emits `recording-level` once per audio
  // callback (~50–100/s). The hook used to mirror it into `micLevel` /
  // `systemLevel` state that nothing read, re-rendering every consumer —
  // including the App root — at that rate.
  describe('recording level events', () => {
    it('does not listen for recording-level events or re-render on them', async () => {
      setMockInvokeHandler('start_recording', () => undefined);

      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useRecording();
      });

      await act(async () => {
        await result.current.startRecording('microphone');
      });
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(getListenerCount('recording-level')).toBe(0);

      const before = renders;
      act(() => {
        for (let i = 0; i < 50; i++) {
          emitMockEvent('recording-level', { mic: 0.75, system: 0.42 });
        }
      });
      expect(renders).toBe(before);
      expect(result.current).not.toHaveProperty('micLevel');
      expect(result.current).not.toHaveProperty('systemLevel');
    });

    it('does not re-render on unrelated recording-store writes', async () => {
      let renders = 0;
      renderHook(() => {
        renders++;
        return useRecording();
      });

      const before = renders;
      act(() => {
        useRecordingStore.getState().setTranscriptionProgress(0.5);
        useRecordingStore.setState({ activeDownloads: { base: { progress: 0.3 } } });
      });
      expect(renders).toBe(before);
    });
  });

  // ---- cleanup on unmount ----

  describe('cleanup on unmount', () => {
    it('clears timer and event listeners on unmount', async () => {
      setMockInvokeHandler('start_recording', () => undefined);

      const { result, unmount } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      // Allow the listen promise to resolve
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      unmount();

      // After unmount, emitting an event should not throw or update state
      // (the unlisten was called, so the listener is removed)
      act(() => {
        emitMockEvent('recording-level', { mic: 0.9, system: 0.8 });
      });

      // Timer should not keep running — advancing time should not cause errors
      vi.advanceTimersByTime(5000);
    });
  });

  // ---- source reflects store ----

  describe('source reflects store', () => {
    it('returns recordingSource from the store', async () => {
      setMockInvokeHandler('start_recording', () => undefined);

      const { result } = renderHook(() => useRecording());

      expect(result.current.source).toBe('microphone');

      await act(async () => {
        await result.current.startRecording('microphone');
      });

      expect(result.current.source).toBe('microphone');
    });

    it('reflects store changes to recordingSource', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        useRecordingStore.setState({ recordingSource: 'system' });
      });

      expect(result.current.source).toBe('system');
    });
  });
});
