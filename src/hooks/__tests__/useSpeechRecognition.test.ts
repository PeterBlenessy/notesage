// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler, getListenerCount, emitMockEvent } from '@/test/tauri-mock';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useRecordingStore } from '@/stores/recording-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useRecordingStore.setState({
    isRecording: false,
    isDictating: false,
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

/** Register default Tauri IPC handlers for whisper dictation */
function setupDefaultHandlers() {
  setMockInvokeHandler('list_whisper_models', () => [
    { name: 'base', size_bytes: 142000000, downloaded: true, path: '/models/base.bin' },
  ]);
  setMockInvokeHandler('start_dictation', () => undefined);
  setMockInvokeHandler('stop_dictation', () => undefined);
  setMockInvokeHandler('download_whisper_model', () => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    resetStore();
    setupDefaultHandlers();
    // Ensure Web Speech API is not available so we go through whisper path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).SpeechRecognition;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts whisper dictation and registers exactly one listener', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startDictation();
    });

    expect(result.current.isDictating).toBe(true);
    expect(getListenerCount('dictation-result')).toBe(1);
  });

  it('cleans up listener on stopDictation', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startDictation();
    });

    expect(getListenerCount('dictation-result')).toBe(1);

    await act(async () => {
      await result.current.stopDictation();
    });

    expect(result.current.isDictating).toBe(false);
    expect(getListenerCount('dictation-result')).toBe(0);
  });

  it('stop during startup prevents dictation from completing', async () => {
    // Make listWhisperModels slow to create a window where stop can arrive
    // before isDictating is set to true
    let resolveModels: ((v: unknown) => void) | null = null;
    setMockInvokeHandler('list_whisper_models', () => {
      return new Promise((resolve) => {
        resolveModels = resolve;
      });
    });

    const startDictationSpy = vi.fn();
    setMockInvokeHandler('start_dictation', startDictationSpy);

    const { result } = renderHook(() => useSpeechRecognition());

    // Start dictation — will hang waiting for listWhisperModels
    let startPromise: Promise<void>;
    act(() => {
      startPromise = result.current.startDictation();
    });

    // Stop while start is still in flight (isDictating is still false)
    // The bug: stopDictation returns early because isDictating is false,
    // so it doesn't bump the generation counter or clean up.
    await act(async () => {
      await result.current.stopDictation();
    });

    // Now resolve the models call — the start should detect it was cancelled
    await act(async () => {
      resolveModels!([
        { name: 'base', size_bytes: 142000000, downloaded: true, path: '/models/base.bin' },
      ]);
      await startPromise!;
    });

    // After the fix: the start should have been cancelled, so no dictation
    // should be running and no dangling listeners
    expect(result.current.isDictating).toBe(false);
    expect(getListenerCount('dictation-result')).toBe(0);
    // start_dictation should NOT have been called since we cancelled
    expect(startDictationSpy).not.toHaveBeenCalled();
  });

  it('rapid start-stop-start leaves only one active dictation-result listener', async () => {
    // Make listWhisperModels slow for the first call to create a race window
    let callCount = 0;
    setMockInvokeHandler('list_whisper_models', async () => {
      callCount++;
      if (callCount === 1) {
        // First call: add a delay to simulate slow IPC
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return [
        { name: 'base', size_bytes: 142000000, downloaded: true, path: '/models/base.bin' },
      ];
    });

    const { result } = renderHook(() => useSpeechRecognition());

    // Start dictation (will be slow due to first listWhisperModels call)
    let firstStartPromise: Promise<void>;
    act(() => {
      firstStartPromise = result.current.startDictation();
    });

    // Stop before first start finishes
    await act(async () => {
      await result.current.stopDictation();
    });

    // Start again immediately
    let secondStartPromise: Promise<void>;
    act(() => {
      secondStartPromise = result.current.startDictation();
    });

    // Wait for both to settle
    await act(async () => {
      await firstStartPromise!;
      await secondStartPromise!;
    });

    // Only one listener should be active (the second start's)
    expect(getListenerCount('dictation-result')).toBe(1);
    expect(result.current.isDictating).toBe(true);
  });

  it('dictation-result events are processed correctly', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startDictation();
    });

    // Emit a text event
    await act(async () => {
      emitMockEvent('dictation-result', { text: 'hello world', is_final: false });
    });

    expect(result.current.finalText).toContain('hello world');

    // Emit final event
    await act(async () => {
      emitMockEvent('dictation-result', { text: '', is_final: true });
    });

    expect(result.current.isDictating).toBe(false);
  });
});
