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
import { emitMockEvent, getListenerCount, registerRecordingHandlers } from '@/test/tauri-mock';
import { useRecordingShortcut } from '@/hooks/useRecordingShortcut';
import { __resetLiveRecordingItemId } from '@/hooks/useMeetingRecording';
import { stopRecordedTimeTicker } from '@/hooks/useRecording';
import { readRecordingLevels, resetRecordingLevels, useRecordingStore } from '@/stores/recording-store';
import { useActivityStore } from '@/stores/activity-store';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('@/hooks/useTranscriptionJob', () => ({
  startTranscription: vi.fn(),
}));

vi.mock('@/stores/recordings-store', () => ({
  useRecordingsStore: { getState: () => ({ openRecordings: vi.fn(), refresh: vi.fn() }) },
}));

import { startTranscription } from '@/hooks/useTranscriptionJob';

async function dispatch(name: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event(name));
    // start/stop are async chains of mocked invokes — let them settle.
    await vi.advanceTimersByTimeAsync(0);
  });
}

const pressShortcut = () => dispatch('notesage:toggle-recording');
const pressPause = () => dispatch('notesage:toggle-recording-pause');

describe('useRecordingShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useRecordingStore.setState({
      phase: 'idle',
      isRecording: false,
      recordingSource: 'microphone',
      recordingStartTime: null,
      isPaused: false,
      pauseStartedAt: null,
      pausedTotalMs: 0,
      recordedSeconds: 0,
      warnings: [],
      lastUsedSource: 'microphone',
    });
    useActivityStore.setState({ tasks: [] });
    useSettingsStore.setState({
      icloudNotesagePath: null,
      notesRootPath: '~/Notesage',
      homeDir: '/Users/me',
    });
    resetRecordingLevels();
    __resetLiveRecordingItemId();
    registerRecordingHandlers();
  });

  afterEach(() => {
    stopRecordedTimeTicker();
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

    // A recording in progress: ten seconds of recorded-time ticks, a burst of
    // level events, a warning, pause/resume, and unrelated store writes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      for (let i = 0; i < 100; i++) {
        emitMockEvent('recording-level', { mic: 0.5, system: 0.5 });
      }
      emitMockEvent('recording-warning', { kind: 'low-disk', message: 'x', fatal: false });
      useRecordingStore.getState().pauseRecording();
      useRecordingStore.getState().resumeRecording();
      useRecordingStore.getState().setRecordedSeconds(10);
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
      audioPath: '/Users/me/Notesage/Recordings/Recording 2026-11-25 101500/audio.m4a',
    });
  });

  it('pauses and resumes on the pause event (⌘⇧U), and ignores it when idle', async () => {
    renderHook(() => useRecordingShortcut());

    await pressPause();
    expect(useRecordingStore.getState().phase).toBe('idle');

    await pressShortcut();
    await pressPause();
    expect(useRecordingStore.getState().phase).toBe('paused');
    await pressPause();
    expect(useRecordingStore.getState().phase).toBe('recording');
  });

  it('is where the backend events are heard: levels and warnings arrive whatever is on screen', async () => {
    renderHook(() => useRecordingShortcut());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getListenerCount('recording-level')).toBe(1);
    expect(getListenerCount('recording-warning')).toBe(1);

    await pressShortcut();
    emitMockEvent('recording-level', { mic: 0.25, system: null });
    expect(readRecordingLevels().mic).toBe(0.25);
    emitMockEvent('recording-warning', { kind: 'low-disk', message: 'x', fatal: false });
    expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'low-disk', source: null }]);
  });

  it('stops listening on unmount', async () => {
    const { unmount } = renderHook(() => useRecordingShortcut());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await pressShortcut();
    expect(useRecordingStore.getState().isRecording).toBe(false);
    expect(getListenerCount('recording-level')).toBe(0);
    expect(getListenerCount('recording-warning')).toBe(0);
  });
});
