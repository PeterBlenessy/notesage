// @vitest-environment jsdom
/**
 * Tests for multi-instance synchronisation of useSpeechRecognition.
 *
 * Bug report: issue #213 — audio pipeline broken.
 *
 * Root cause: useSpeechRecognition maintains local React state (`isDictating`)
 * that is independent per hook instance. Multiple components mount MicButton
 * (Toolbar + StatusTray), each calling useSpeechRecognition(), creating
 * independent instances. When instance A starts dictation, instance B still
 * has isDictating=false locally, so:
 *   - Clicking instance B's MicButton starts a second dictation instead of
 *     stopping the first.
 *   - Instance B's finalText never changes, so text is never inserted into
 *     the editor from that instance.
 *   - The status bar (which reads store state) disagrees with the MicButton
 *     icons (which read local state).
 *
 * Fix: useSpeechRecognition must derive its returned `isDictating` from the
 * Zustand store, not from local React state, so all instances share the same
 * truth about whether dictation is currently active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
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

describe('useSpeechRecognition — multi-instance sync (issue #213)', () => {
  beforeEach(() => {
    resetStore();
    setupDefaultHandlers();
    // No Web Speech API — always use whisper path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).SpeechRecognition;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC1: Status bar and mic icon reflect the SAME recording state
  // The store is the single source of truth. When instance A starts dictation,
  // instance B must immediately see isDictating=true without having called
  // startDictation itself.
  // -------------------------------------------------------------------------

  it('instance B reflects isDictating=true when instance A starts dictation', async () => {
    // Simulate instance A (e.g. Toolbar MicButton)
    const instanceA = renderHook(() => useSpeechRecognition());
    // Simulate instance B (e.g. StatusTray MicButton) — mounted independently
    const instanceB = renderHook(() => useSpeechRecognition());

    // Instance A starts dictation
    await act(async () => {
      await instanceA.result.current.startDictation();
    });

    // Instance A should report isDictating=true (already tested elsewhere)
    expect(instanceA.result.current.isDictating).toBe(true);

    // Instance B must also report isDictating=true — it reads the shared store,
    // not its own local state. This is the bug: currently returns false.
    expect(instanceB.result.current.isDictating).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC2: Clicking mic icon while recording is active STOPS it, does not restart.
  // If instance B sees isDictating=true (above test), then calling stopDictation
  // via instance B must actually stop the dictation.
  // -------------------------------------------------------------------------

  it('instance B stopDictation stops the session started by instance A', async () => {
    const stopDictationSpy = vi.fn(() => Promise.resolve());
    setMockInvokeHandler('stop_dictation', stopDictationSpy);

    const instanceA = renderHook(() => useSpeechRecognition());
    const instanceB = renderHook(() => useSpeechRecognition());

    // Instance A starts dictation
    await act(async () => {
      await instanceA.result.current.startDictation();
    });

    expect(instanceA.result.current.isDictating).toBe(true);
    expect(instanceB.result.current.isDictating).toBe(true);

    // Instance B stops dictation (user clicks the StatusTray mic button)
    await act(async () => {
      await instanceB.result.current.stopDictation();
    });

    // Both instances must report isDictating=false
    expect(instanceA.result.current.isDictating).toBe(false);
    expect(instanceB.result.current.isDictating).toBe(false);

    // The backend stop command must have been called exactly once
    expect(stopDictationSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // AC3: After stopping, both indicators return to non-recording state.
  // Store isDictating must be false after stopDictation.
  // -------------------------------------------------------------------------

  it('store isDictating is false after stopDictation via any instance', async () => {
    const instanceA = renderHook(() => useSpeechRecognition());
    const instanceB = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await instanceA.result.current.startDictation();
    });

    // Verify store is updated
    expect(useRecordingStore.getState().isDictating).toBe(true);

    // Stop via instance B
    await act(async () => {
      await instanceB.result.current.stopDictation();
    });

    // Store must be updated to false
    expect(useRecordingStore.getState().isDictating).toBe(false);

    // Both hook instances must read the updated store
    expect(instanceA.result.current.isDictating).toBe(false);
    expect(instanceB.result.current.isDictating).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC4: No spurious auto-start.
  // A freshly mounted hook instance must NOT report isDictating=true unless
  // the store already has isDictating=true (e.g. from a genuine in-progress
  // dictation). After resetStore() the store has isDictating=false.
  // -------------------------------------------------------------------------

  it('freshly mounted instance reports isDictating=false when store is idle', () => {
    // Store is reset to idle by beforeEach
    expect(useRecordingStore.getState().isDictating).toBe(false);

    const { result } = renderHook(() => useSpeechRecognition());

    // Must be false — no auto-start
    expect(result.current.isDictating).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC5: Transcribed text is inserted at cursor position.
  // The finalText returned by any instance must update when dictation-result
  // events arrive, even if that instance did not call startDictation.
  //
  // Specifically: instance A started dictation; the backend emits
  // dictation-result events. Instance B must also accumulate the finalText
  // so that its MicButton can insert the text into the editor.
  //
  // Note: in the post-fix architecture, text insertion is handled by a single
  // shared callback or by the hook reporting the latest text from the store,
  // not by each instance maintaining independent finalText. This test verifies
  // that at minimum, instance A (the one that started dictation) has finalText
  // populated after the event — the insertion-at-cursor is covered by the
  // MicButton useEffect watching finalText.
  // -------------------------------------------------------------------------

  it('finalText is populated after dictation-result text event for the starting instance', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      await result.current.startDictation();
    });

    expect(result.current.isDictating).toBe(true);

    // Backend emits partial text
    await act(async () => {
      emitMockEvent('dictation-result', { text: 'hello world', is_final: false });
    });

    expect(result.current.finalText).toContain('hello world');

    // Backend signals end of dictation
    await act(async () => {
      emitMockEvent('dictation-result', { text: '', is_final: true });
    });

    // Dictation ended — isDictating must be false and text preserved
    expect(result.current.isDictating).toBe(false);
    expect(result.current.finalText).toContain('hello world');
  });

  // -------------------------------------------------------------------------
  // Edge case: instance B must not start a new dictation session when it
  // calls stopDictation while isDictating=false (e.g. after already stopped).
  // -------------------------------------------------------------------------

  it('calling stopDictation on idle instance does not call stop_dictation backend', async () => {
    const stopDictationSpy = vi.fn(() => Promise.resolve());
    setMockInvokeHandler('stop_dictation', stopDictationSpy);

    const { result } = renderHook(() => useSpeechRecognition());

    // Store is idle — no dictation running
    expect(result.current.isDictating).toBe(false);

    // Calling stop when idle should be a no-op
    await act(async () => {
      await result.current.stopDictation();
    });

    // Backend should NOT be called when there is nothing to stop
    expect(stopDictationSpy).not.toHaveBeenCalled();
  });
});
