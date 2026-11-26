// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import {
  emitMockEvent,
  registerRecordingHandlers,
  setMockInvokeHandler,
  type RecordingMockLog,
} from '@/test/tauri-mock';
import {
  __resetLiveRecordingItemId,
  discardMeetingRecording,
  initRecordingEvents,
  recordingsDestination,
  recoverOrphanRecordings,
  requestDiscardMeetingRecording,
  sourceUnavailableReason,
  startMeetingRecording,
  stopMeetingRecording,
  toggleMeetingRecording,
  togglePauseMeetingRecording,
  useMeetingRecording,
} from '@/hooks/useMeetingRecording';
import { stopRecordedTimeTicker } from '@/hooks/useRecording';
import { resetRecordingLevels, useRecordingStore } from '@/stores/recording-store';
import { useActivityStore } from '@/stores/activity-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import type { RecordingPreflight } from '@/lib/tauri';

vi.mock('@/hooks/useTranscriptionJob', () => ({
  startTranscription: vi.fn(),
}));

const openRecordings = vi.fn();
const refreshRecordings = vi.fn();
vi.mock('@/stores/recordings-store', () => ({
  useRecordingsStore: {
    getState: () => ({ openRecordings, refresh: refreshRecordings }),
  },
}));

import { startTranscription } from '@/hooks/useTranscriptionJob';
import { parseRecordingManifest } from '@/lib/transcription/manifest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGING = '/Users/me/.notesage/recordings-staging/Recording 2026-11-25 101500';
const LIBRARY = '/Users/me/Notesage/Recordings';
const FILED = `${LIBRARY}/Recording 2026-11-25 101500`;

let log: RecordingMockLog;

function resetStores() {
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
    discardConfirmOpen: false,
    lastUsedSource: 'microphone',
    speechLanguage: 'en',
    defaultModel: 'large-v3-turbo-q5_0',
    availableModels: [],
    modelsLoaded: false,
  });
  useActivityStore.setState({ tasks: [] });
  useSettingsStore.setState({
    icloudNotesagePath: null,
    notesRootPath: '~/Notesage',
    homeDir: '/Users/me',
  });
  useEditorStore.setState({ activeTabId: null, openDocuments: [] });
  resetRecordingLevels();
  __resetLiveRecordingItemId();
}

function recordingItems() {
  return useActivityStore.getState().tasks.filter((t) => t.kind === 'recording');
}

function count(command: string): number {
  return log.calls.filter((c) => c === command).length;
}

/** A promise the test resolves by hand, to hold a backend command open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function toastActions(kind: 'success' | 'error' | 'warning' | 'info') {
  return vi.mocked(toast[kind]).mock.calls.map(([message, options]) => ({
    message: String(message),
    action: (options as { action?: { label: string; onClick: () => void } } | undefined)?.action,
  }));
}

function openTab(filePath: string, fileType: string) {
  useEditorStore.setState({
    activeTabId: 'tab-1',
    openDocuments: [
      { id: 'tab-1', filePath, fileName: filePath.split('/').pop() ?? '', fileType },
    ] as unknown as ReturnType<typeof useEditorStore.getState>['openDocuments'],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('meeting recording flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    log = registerRecordingHandlers();
  });

  afterEach(() => {
    stopRecordedTimeTicker();
  });

  // -------------------------------------------------------------------
  // The phase state machine (U7)
  // -------------------------------------------------------------------
  describe('phase state machine', () => {
    it('idle → recording → idle, with one activity item for the life of the capture', async () => {
      expect(await startMeetingRecording()).toBe(true);
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(useRecordingStore.getState().isRecording).toBe(true);
      expect(recordingItems()).toHaveLength(1);

      await stopMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(useRecordingStore.getState().isRecording).toBe(false);
      expect(recordingItems()).toHaveLength(0);
    });

    it('a double toggle starts ONE recording: one start, one item, no failure toast', async () => {
      // Two presses before the first has resolved — a double click.
      const first = toggleMeetingRecording();
      const second = toggleMeetingRecording();
      await Promise.all([first, second]);

      expect(count('start_recording')).toBe(1);
      expect(count('stop_recording')).toBe(0);
      expect(recordingItems()).toHaveLength(1);
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a toggle while starting is ignored: the recording is not stopped the moment it begins', async () => {
      const gate = deferred<undefined>();
      setMockInvokeHandler('start_recording', () => gate.promise);

      const starting = startMeetingRecording();
      await flush();
      expect(useRecordingStore.getState().phase).toBe('starting');

      await toggleMeetingRecording();
      await stopMeetingRecording();
      expect(count('stop_recording')).toBe(0);

      gate.resolve(undefined);
      expect(await starting).toBe(true);
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(recordingItems()).toHaveLength(1);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a double stop stops ONCE and keeps the per-recording language', async () => {
      await startMeetingRecording();
      useActivityStore.getState().setRecordingLanguage(recordingItems()[0].id, 'sv');

      await Promise.all([toggleMeetingRecording(), toggleMeetingRecording()]);

      expect(count('stop_recording')).toBe(1);
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(startTranscription).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a start while the last recording is still being saved is refused', async () => {
      await startMeetingRecording();
      const gate = deferred<unknown>();
      const stopResult = {
        bundle_dir: STAGING,
        audio_path: `${STAGING}/audio.m4a`,
        tracks: [],
        duration_secs: 12,
        peak: 0.2,
        sample_rate: 48000,
        dropped_frames: 0,
        warnings: [],
      };
      setMockInvokeHandler('stop_recording', () => gate.promise);

      const stopping = stopMeetingRecording();
      await flush();
      expect(useRecordingStore.getState().phase).toBe('stopping');

      // The audio is being compressed: ⌘⇧R again must not start a second one.
      expect(await startMeetingRecording()).toBe(false);
      await toggleMeetingRecording();
      expect(count('start_recording')).toBe(1);

      gate.resolve(stopResult);
      await stopping;
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it('pause and resume move recording ⇄ paused, and do nothing when idle', async () => {
      await togglePauseMeetingRecording();
      expect(count('pause_recording')).toBe(0);

      await startMeetingRecording();
      await togglePauseMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('paused');
      expect(useRecordingStore.getState().isRecording).toBe(true);
      await togglePauseMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(count('pause_recording')).toBe(1);
      expect(count('resume_recording')).toBe(1);
    });

    it('stopping while paused saves like any other stop', async () => {
      await startMeetingRecording();
      await togglePauseMeetingRecording();
      await toggleMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(recordingItems()).toHaveLength(0);
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it('a failed start leaves nothing behind: idle, no item, one toast', async () => {
      setMockInvokeHandler('start_recording', () => {
        throw new Error('no microphone');
      });
      expect(await startMeetingRecording()).toBe(false);
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(recordingItems()).toHaveLength(0);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('no microphone');
    });

    it('a failed stop with the capture still running puts the controls back', async () => {
      await startMeetingRecording();
      setMockInvokeHandler('stop_recording', () => {
        throw new Error('encoder busy');
      });
      await stopMeetingRecording();
      // get_recording_state (the mock recorder) still says recording.
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(recordingItems()).toHaveLength(1);
      expect(startTranscription).not.toHaveBeenCalled();
      expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('still running');
    });

    it('a failed stop with the capture gone goes idle and says the audio is kept', async () => {
      await startMeetingRecording();
      setMockInvokeHandler('stop_recording', () => {
        throw new Error('backend gone');
      });
      setMockInvokeHandler('get_recording_state', () => ({
        recording: false,
        paused: false,
        source: null,
        started_at_ms: null,
        elapsed_recorded_ms: 0,
      }));
      await stopMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(recordingItems()).toHaveLength(0);
      expect(startTranscription).not.toHaveBeenCalled();
      expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('kept on this Mac');
    });

    it('a surface that mounts later can stop a recording another one started', async () => {
      const a = renderHook(() => useMeetingRecording());
      await act(async () => {
        await a.result.current.toggleRecording();
      });
      a.unmount();

      const b = renderHook(() => useMeetingRecording());
      expect(b.result.current.isRecording).toBe(true);
      expect(b.result.current.phase).toBe('recording');
      await act(async () => {
        await b.result.current.toggleRecording();
      });
      expect(recordingItems()).toHaveLength(0);
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------
  // Discard (U10)
  // -------------------------------------------------------------------
  describe('discard', () => {
    it('asking to discard only opens the confirmation; nothing is deleted yet', async () => {
      requestDiscardMeetingRecording();
      expect(useRecordingStore.getState().discardConfirmOpen).toBe(false);

      await startMeetingRecording();
      requestDiscardMeetingRecording();
      expect(useRecordingStore.getState().discardConfirmOpen).toBe(true);
      expect(count('discard_recording')).toBe(0);
      expect(useRecordingStore.getState().phase).toBe('recording');
    });

    it('discarding deletes: no manifest, no bundle in the library, no transcription', async () => {
      await startMeetingRecording();
      await discardMeetingRecording();

      expect(count('discard_recording')).toBe(1);
      expect(count('stop_recording')).toBe(0);
      expect(count('finalize_recording_bundle')).toBe(0);
      expect(log.written).toHaveLength(0);
      expect(startTranscription).not.toHaveBeenCalled();
      expect(recordingItems()).toHaveLength(0);
      expect(useRecordingStore.getState().phase).toBe('idle');
    });

    it('a failed discard changes nothing: the recording carries on', async () => {
      await startMeetingRecording();
      setMockInvokeHandler('discard_recording', () => {
        throw new Error('busy');
      });
      await discardMeetingRecording();
      expect(useRecordingStore.getState().phase).toBe('recording');
      expect(recordingItems()).toHaveLength(1);
      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('stopping never asks and never deletes, however short the recording', async () => {
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(useRecordingStore.getState().discardConfirmOpen).toBe(false);
      expect(count('discard_recording')).toBe(0);
      expect(count('finalize_recording_bundle')).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Manifest → finalize → transcription
  // -------------------------------------------------------------------
  describe('filing the finished recording', () => {
    it('writes recording.json into STAGING, then moves the bundle, then queues the job', async () => {
      await startMeetingRecording();
      const startedAt = useRecordingStore.getState().recordingStartTime!;
      await stopMeetingRecording();

      // The manifest is in the staging bundle…
      expect(log.written).toHaveLength(1);
      expect(log.written[0].path).toBe(`${STAGING}/recording.json`);
      // …and was written BEFORE the bundle moved into the library.
      const order = log.calls.filter((c) => c === 'write_file' || c === 'finalize_recording_bundle');
      expect(order).toEqual(['write_file', 'finalize_recording_bundle']);

      const manifest = parseRecordingManifest(log.written[0].content)!;
      expect(manifest).toMatchObject({
        version: 1,
        createdBy: { device: "Peter's Mac", app: 'notesage-macos' },
        durationSecs: 4503,
        source: 'microphone',
        audio: { file: 'audio.m4a', bytes: 1_234_567, codec: 'aac', sampleRate: 48_000, channels: 1 },
        transcription: null,
      });
      expect(Date.parse(manifest.startedAt)).toBe(Math.floor(startedAt / 1000) * 1000);

      // The job gets the bundle's LIBRARY path, not the staging one.
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(startTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPath: `${FILED}/audio.m4a`,
          recordingStartedAt: startedAt,
          recordingDurationSecs: 4503,
          recordingStoppedAt: expect.any(Number),
        }),
      );
      expect(refreshRecordings).toHaveBeenCalled();
    });

    it("moves the bundle into the library's Recordings folder: the scanner's expression", async () => {
      expect(recordingsDestination()).toBe(LIBRARY);
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(log.finalized).toEqual([{ stagingDir: STAGING, destRecordingsDir: LIBRARY }]);
    });

    it('prefers the synced library when iCloud sync is on', async () => {
      const icloud = '/Users/me/Library/Mobile Documents/iCloud~com~notesage/Documents';
      useSettingsStore.setState({ icloudNotesagePath: icloud });
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(log.finalized[0].destRecordingsDir).toBe(`${icloud}/Recordings`);
    });

    it('for "both", records the tracks in the manifest and hands mic + system to the job', async () => {
      await startMeetingRecording({ source: 'both' });
      expect(log.calls).toContain('start_recording');
      await stopMeetingRecording();

      const manifest = JSON.parse(log.written[0].content) as {
        source: string;
        tracks: { role: string; file: string }[];
      };
      expect(manifest.source).toBe('both');
      // Basenames inside the bundle, so they survive the move.
      expect(manifest.tracks).toEqual([
        { role: 'mix', file: 'audio.m4a' },
        { role: 'mic', file: 'mic.m4a' },
        { role: 'system', file: 'system.m4a' },
      ]);

      const detail = vi.mocked(startTranscription).mock.calls[0][0] as { tracks?: unknown };
      expect(detail.tracks).toEqual([
        { role: 'mic', path: `${FILED}/mic.m4a` },
        { role: 'system', path: `${FILED}/system.m4a` },
      ]);
    });

    it('passes no tracks for a single-source recording', async () => {
      await startMeetingRecording();
      await stopMeetingRecording();
      const detail = vi.mocked(startTranscription).mock.calls[0][0] as { tracks?: unknown };
      expect(detail.tracks).toBeUndefined();
    });

    it("carries the recording's language into the manifest and the job, and makes it the next default (T8)", async () => {
      await startMeetingRecording();
      useActivityStore.getState().setRecordingLanguage(recordingItems()[0].id, 'sv');
      await stopMeetingRecording();

      expect(parseRecordingManifest(log.written[0].content)?.language).toBe('sv');
      expect(startTranscription).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }));
      expect(useRecordingStore.getState().speechLanguage).toBe('sv');
    });

    it('omits the language when none was picked (the job falls back to the default)', async () => {
      await startMeetingRecording();
      await stopMeetingRecording();
      const detail = vi.mocked(startTranscription).mock.calls[0][0] as { language?: string };
      expect(detail.language).toBeUndefined();
      expect(useRecordingStore.getState().speechLanguage).toBe('en');
    });

    it('links the recording to the markdown document that was open when it started (U12)', async () => {
      openTab('/Users/me/Notesage/Meetings/standup.md', 'markdown');
      await startMeetingRecording();
      // Switching documents mid-recording does not change the link.
      openTab('/Users/me/Notesage/other.md', 'markdown');
      await stopMeetingRecording();
      expect(startTranscription).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: '/Users/me/Notesage/Meetings/standup.md' }),
      );
    });

    it('sets no document link when the open document is not markdown', async () => {
      openTab('/Users/me/Notesage/paper.pdf', 'pdf');
      await startMeetingRecording();
      await stopMeetingRecording();
      const detail = vi.mocked(startTranscription).mock.calls[0][0] as { documentId?: string };
      expect(detail.documentId).toBeUndefined();
    });

    it('still files and transcribes when the manifest cannot be written', async () => {
      setMockInvokeHandler('file_size', () => {
        throw new Error('stat failed');
      });
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(log.written).toHaveLength(0);
      expect(count('finalize_recording_bundle')).toBe(1);
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it('when the bundle cannot be moved, says the audio is safe and does not transcribe', async () => {
      setMockInvokeHandler('finalize_recording_bundle', () => {
        throw new Error('iCloud Drive is unavailable');
      });
      await startMeetingRecording();
      await stopMeetingRecording();

      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(startTranscription).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      const message = String(vi.mocked(toast.error).mock.calls[0][0]);
      expect(message).toContain('safe on this Mac');
      expect(message).toContain('1:15:03');
    });

    it('accepts the pre-contract stop result (a bare `path`)', async () => {
      setMockInvokeHandler('stop_recording', () => ({
        path: '/tmp/staging/Recording A/audio.wav',
        duration_secs: 5,
        sample_rate: 16000,
        source: 'microphone',
        rms: 0.05,
        peak: 0.3,
      }));
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(log.written[0].path).toBe('/tmp/staging/Recording A/recording.json');
      expect(log.finalized[0].stagingDir).toBe('/tmp/staging/Recording A');
      expect(parseRecordingManifest(log.written[0].content)?.audio.codec).toBe('pcm');
    });
  });

  // -------------------------------------------------------------------
  // After stop (U14)
  // -------------------------------------------------------------------
  describe('confirmation that the recording was saved', () => {
    it('toasts "Recording saved (1:15:03)" with an action that opens Recordings', async () => {
      await startMeetingRecording();
      await stopMeetingRecording();

      const saved = toastActions('success');
      expect(saved).toHaveLength(1);
      expect(saved[0].message).toBe('Recording saved (1:15:03)');
      expect(saved[0].action?.label).toBe('Open Recordings');
      saved[0].action?.onClick();
      expect(openRecordings).toHaveBeenCalledTimes(1);
    });

    it('says so when the saved recording is silent from start to end', async () => {
      setMockInvokeHandler('stop_recording', () => ({
        bundle_dir: STAGING,
        audio_path: `${STAGING}/audio.m4a`,
        tracks: [],
        duration_secs: 30,
        peak: 0,
        sample_rate: 48000,
        dropped_frames: 0,
        warnings: [],
      }));
      await startMeetingRecording();
      await stopMeetingRecording();
      expect(toast.success).not.toHaveBeenCalled();
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain('silent');
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain('Microphone');
    });

    // A refused "System Audio Recording" permission cannot be detected up
    // front on macOS: the backend's `system-silent` code at stop is the only
    // sign, so it must reach the user with the way to fix it.
    it('names a silent system-audio track and says where to allow it, even when the microphone was fine', async () => {
      setMockInvokeHandler('stop_recording', () => ({
        bundle_dir: STAGING,
        audio_path: `${STAGING}/audio.m4a`,
        tracks: [
          { role: 'mic', path: `${STAGING}/mic.m4a` },
          { role: 'system', path: `${STAGING}/system.m4a` },
        ],
        duration_secs: 4503,
        peak: 0.6,
        sample_rate: 48000,
        dropped_frames: 0,
        warnings: ['system-silent', 'drift: mic=+12ms system=-140ms'],
      }));
      await startMeetingRecording({ source: 'both' });
      await stopMeetingRecording();

      expect(toast.success).not.toHaveBeenCalled();
      const message = toastActions('warning').map((w) => w.message).join(' | ');
      expect(message).toContain('no sound reached it from System audio');
      expect(message).toContain('System Settings → Privacy & Security');
      // Still saved and still transcribed.
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it('a silent microphone track is named without the system-audio hint', async () => {
      setMockInvokeHandler('stop_recording', () => ({
        bundle_dir: STAGING,
        audio_path: `${STAGING}/audio.m4a`,
        tracks: [],
        duration_secs: 10,
        peak: 0.5,
        sample_rate: 48000,
        dropped_frames: 0,
        warnings: ['mic-silent'],
      }));
      await startMeetingRecording({ source: 'both' });
      await stopMeetingRecording();
      const message = toastActions('warning').map((w) => w.message).join(' | ');
      expect(message).toContain('from Microphone');
      expect(message).not.toContain('allow Notesage to record system audio');
    });
  });

  // -------------------------------------------------------------------
  // Preflight and source choice (N1, U5)
  // -------------------------------------------------------------------
  describe('preflight', () => {
    const base: RecordingPreflight = {
      microphone: 'granted',
      system_audio: 'available',
      input_device: 'MacBook Pro Microphone',
      output_device: 'MacBook Pro Speakers',
      free_bytes: 1e10,
    };

    it('explains each unavailable source, and treats "undetermined" as available', () => {
      expect(sourceUnavailableReason('both', base)).toBeNull();
      expect(sourceUnavailableReason('system', { ...base, system_audio: 'unsupported' })).toBe(
        'Needs macOS 14.2 or later',
      );
      expect(sourceUnavailableReason('both', { ...base, system_audio: 'denied' })).toBe(
        'Allow audio capture in System Settings → Privacy & Security',
      );
      // The microphone is unaffected by a system-audio problem.
      expect(sourceUnavailableReason('microphone', { ...base, system_audio: 'unsupported' })).toBeNull();
      expect(sourceUnavailableReason('microphone', { ...base, microphone: 'denied' })).toContain(
        'Allow the microphone',
      );
      // System audio alone does not need the microphone.
      expect(sourceUnavailableReason('system', { ...base, microphone: 'denied' })).toBeNull();
      // macOS asks when capture starts: not a refusal.
      expect(sourceUnavailableReason('both', { ...base, microphone: 'undetermined', system_audio: 'unknown' })).toBeNull();
      expect(sourceUnavailableReason('both', null)).toBeNull();
    });

    it('uses the source chosen last, and remembers the device names', async () => {
      useRecordingStore.setState({ lastUsedSource: 'system' });
      await startMeetingRecording();
      expect(useRecordingStore.getState().recordingSource).toBe('system');
      expect(useRecordingStore.getState().inputDevice).toBe('MacBook Pro Microphone');
      expect(useRecordingStore.getState().outputDevice).toBe('MacBook Pro Speakers');
    });

    it('never records less than asked: an unavailable source is refused, with the reason and a microphone-only offer', async () => {
      setMockInvokeHandler('recording_preflight', () => ({ ...base, system_audio: 'unsupported' }));
      const started: string[] = [];
      setMockInvokeHandler('start_recording', (args) => {
        started.push(String(args?.source));
      });

      expect(await startMeetingRecording({ source: 'both' })).toBe(false);
      expect(started).toEqual([]);
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(recordingItems()).toHaveLength(0);

      const errors = toastActions('error');
      expect(errors[0].message).toContain('Microphone + system audio');
      expect(errors[0].message).toContain('Needs macOS 14.2 or later');
      expect(errors[0].action?.label).toBe('Record microphone only');

      // The offer is explicit: taking it records the microphone.
      errors[0].action?.onClick();
      await flush();
      await flush();
      expect(started).toEqual(['microphone']);
    });

    it('refuses to start when the microphone is denied, without a microphone-only offer', async () => {
      setMockInvokeHandler('recording_preflight', () => ({ ...base, microphone: 'denied' }));
      expect(await startMeetingRecording()).toBe(false);
      expect(count('start_recording')).toBe(0);
      const errors = toastActions('error');
      expect(errors[0].message).toContain('Allow the microphone');
      expect(errors[0].action).toBeUndefined();
    });

    it('starts anyway when the preflight command is not there (the backend is the judge)', async () => {
      setMockInvokeHandler('recording_preflight', () => {
        throw new Error('unknown command');
      });
      expect(await startMeetingRecording()).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // Model check (U6)
  // -------------------------------------------------------------------
  describe('no transcription model', () => {
    beforeEach(() => {
      setMockInvokeHandler('list_whisper_models', () => [
        { name: 'large-v3-turbo-q5_0', size_bytes: 574_000_000, downloaded: false },
      ]);
    });

    it('does NOT block the recording, and offers the download while there is still time', async () => {
      const opened: unknown[] = [];
      const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
      window.addEventListener('notesage:open-settings', onOpen);

      expect(await startMeetingRecording()).toBe(true);
      await flush();
      await flush();
      expect(useRecordingStore.getState().phase).toBe('recording');

      const warnings = toastActions('warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('no transcription model is downloaded');
      expect(warnings[0].action?.label).toBe('Download');
      warnings[0].action?.onClick();
      // Settings → Transcription.
      expect(opened).toEqual([{ tab: 'voice' }]);
      window.removeEventListener('notesage:open-settings', onOpen);
    });

    it('saves the recording, starts no doomed job, and makes the failure actionable', async () => {
      await startMeetingRecording();
      await flush();
      vi.mocked(toast.warning).mockClear();
      await stopMeetingRecording();

      expect(count('finalize_recording_bundle')).toBe(1);
      expect(toastActions('success')[0].message).toBe('Recording saved (1:15:03)');
      expect(startTranscription).not.toHaveBeenCalled();
      const warnings = toastActions('warning');
      expect(warnings[0].message).toContain('saved but not transcribed');
      expect(warnings[0].action?.label).toBe('Download');
    });

    it('says nothing when the model list cannot be read', async () => {
      setMockInvokeHandler('list_whisper_models', () => {
        throw new Error('nope');
      });
      await startMeetingRecording();
      await flush();
      expect(toast.warning).not.toHaveBeenCalled();
      await stopMeetingRecording();
      // Unknown is not "missing": the job is queued and reports for itself.
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------
  // Warnings from the backend (U8)
  // -------------------------------------------------------------------
  describe('recording-warning and recording-level events', () => {
    let stopEvents: () => void;
    beforeEach(async () => {
      stopEvents = initRecordingEvents();
      await flush();
    });
    afterEach(() => stopEvents());

    it('ignores warnings when nothing is being recorded', () => {
      emitMockEvent('recording-warning', { kind: 'silence', message: 'x', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([]);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('a silence warning names the source, persists, toasts once, and clears when sound arrives', async () => {
      await startMeetingRecording();
      await flush();
      vi.mocked(toast.warning).mockClear();

      emitMockEvent('recording-warning', { kind: 'silence', message: 'no signal', fatal: false });
      emitMockEvent('recording-warning', { kind: 'silence', message: 'no signal', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: 'microphone' }]);
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toBe(
        'No sound is reaching the recording (Microphone)',
      );

      // Quiet room noise is not "sound arriving".
      emitMockEvent('recording-level', { mic: 0.001, system: null });
      expect(useRecordingStore.getState().warnings).toHaveLength(1);
      emitMockEvent('recording-level', { mic: 0.2, system: null });
      expect(useRecordingStore.getState().warnings).toEqual([]);
    });

    it('for "both", works out which source is silent', async () => {
      await startMeetingRecording({ source: 'both' });
      emitMockEvent('recording-warning', {
        kind: 'silence',
        message: 'system: no signal for 5 s',
        fatal: false,
        source: 'system',
      });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: 'system' }]);
      // Sound on the microphone does not clear a warning about system audio.
      emitMockEvent('recording-level', { mic: 0.5, system: 0 });
      expect(useRecordingStore.getState().warnings).toHaveLength(1);
      emitMockEvent('recording-level', { mic: 0.5, system: 0.3 });
      expect(useRecordingStore.getState().warnings).toEqual([]);
    });

    it('prefers the explicit source field when the backend sends one', async () => {
      await startMeetingRecording({ source: 'both' });
      emitMockEvent('recording-warning', { kind: 'silence', message: '', fatal: false, source: 'microphone' });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: 'microphone' }]);
    });

    it('without the field, reads only the PREFIX of the message — never the word "system" inside it', async () => {
      await startMeetingRecording({ source: 'both' });
      // The microphone's own message mentions "System Settings".
      emitMockEvent('recording-warning', {
        kind: 'silence',
        message: 'mic: no signal; check System Settings > Privacy & Security > Microphone',
        fatal: false,
      });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: 'microphone' }]);

      useRecordingStore.getState().dismissWarning('silence');
      emitMockEvent('recording-warning', { kind: 'silence', message: 'system: no signal', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: 'system' }]);

      // No prefix and two sources: it does not guess.
      useRecordingStore.getState().dismissWarning('silence');
      emitMockEvent('recording-warning', { kind: 'silence', message: 'no signal', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'silence', source: null }]);
    });

    it('the clock notices a capture the backend ended by itself, even if the event was missed', async () => {
      vi.useFakeTimers();
      try {
        await startMeetingRecording();
        setMockInvokeHandler('get_recording_state', () => ({
          recording: true,
          paused: false,
          source: 'microphone',
          started_at_ms: 0,
          elapsed_recorded_ms: 61_000,
          fatal: true,
        }));
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(0);

        expect(count('stop_recording')).toBe(1);
        expect(count('finalize_recording_bundle')).toBe(1);
        expect(useRecordingStore.getState().phase).toBe('idle');
        expect(toastActions('error')[0].message).toContain('Recording stopped');
        // Further ticks do not stop it again.
        await vi.advanceTimersByTimeAsync(2_000);
        expect(count('stop_recording')).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failed stop after a fatal end does not put the controls back (no stop loop)', async () => {
      await startMeetingRecording();
      setMockInvokeHandler('stop_recording', () => {
        throw new Error('Recording could not be finalised: header');
      });
      setMockInvokeHandler('get_recording_state', () => ({
        recording: true,
        paused: false,
        source: 'microphone',
        started_at_ms: 0,
        elapsed_recorded_ms: 1000,
        fatal: true,
      }));
      await stopMeetingRecording({ fatalReason: 'x' });
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('kept on this Mac');
    });

    it('device-lost stays until device-changed says capture resumed', async () => {
      await startMeetingRecording();
      await flush();
      vi.mocked(toast.warning).mockClear();
      emitMockEvent('recording-warning', { kind: 'device-lost', message: 'x', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'device-lost', source: null }]);
      expect(toast.warning).toHaveBeenCalledTimes(1);

      emitMockEvent('recording-warning', { kind: 'device-changed', message: 'x', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([]);
      expect(toast.info).toHaveBeenCalledTimes(1);
      // Still recording throughout.
      expect(useRecordingStore.getState().phase).toBe('recording');
    });

    it('dropped frames are shown on the indicator but do not toast', async () => {
      await startMeetingRecording();
      await flush();
      vi.mocked(toast.warning).mockClear();
      emitMockEvent('recording-warning', { kind: 'dropped-frames', message: 'x', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'dropped-frames', source: null }]);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('a warning can be dismissed', async () => {
      await startMeetingRecording();
      emitMockEvent('recording-warning', { kind: 'low-disk', message: 'x', fatal: false });
      useRecordingStore.getState().dismissWarning('low-disk', null);
      expect(useRecordingStore.getState().warnings).toEqual([]);
    });

    it('a FATAL warning runs the stop path and says what was saved', async () => {
      await startMeetingRecording();
      await flush();
      emitMockEvent('recording-warning', { kind: 'write-error', message: 'disk full', fatal: true });
      await flush();
      await flush();
      await flush();

      expect(count('stop_recording')).toBe(1);
      expect(count('finalize_recording_bundle')).toBe(1);
      expect(useRecordingStore.getState().phase).toBe('idle');
      expect(recordingItems()).toHaveLength(0);
      const errors = toastActions('error');
      expect(errors[0].message).toContain('Recording stopped');
      expect(errors[0].message).toContain('could not be written to disk');
      expect(errors[0].message).toContain('1:15:03');
      expect(errors[0].action?.label).toBe('Open Recordings');
      expect(toast.success).not.toHaveBeenCalled();
      // What was saved is still transcribed.
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it('stops listening on cleanup', async () => {
      await startMeetingRecording();
      stopEvents();
      emitMockEvent('recording-warning', { kind: 'low-disk', message: 'x', fatal: false });
      expect(useRecordingStore.getState().warnings).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Startup recovery (U11)
  // -------------------------------------------------------------------
  describe('startup', () => {
    const ORPHAN_A = '/Users/me/.notesage/recordings-staging/Recording 2026-11-20 090000';
    const ORPHAN_B = '/Users/me/.notesage/recordings-staging/Recording 2026-11-21 140000';

    it('files every orphan through manifest → library → transcription and tells the user once each', async () => {
      setMockInvokeHandler('recover_orphan_recordings', () => {
        log.calls.push('recover_orphan_recordings');
        return [
          {
            bundle_dir: ORPHAN_A,
            audio_path: `${ORPHAN_A}/audio.wav`,
            tracks: [],
            source: 'microphone',
            has_manifest: false,
            duration_secs: 1800,
            started_at: '2026-11-20T09:00:00+01:00',
          },
          {
            bundle_dir: ORPHAN_B,
            audio_path: `${ORPHAN_B}/audio.wav`,
            tracks: [
              { role: 'mic', path: `${ORPHAN_B}/mic.wav` },
              { role: 'system', path: `${ORPHAN_B}/system.wav` },
            ],
            duration_secs: 60,
            started_at: null,
          },
        ];
      });

      expect(await recoverOrphanRecordings()).toBe(2);

      // Manifest first, then the move — per bundle.
      const order = log.calls.filter((c) => c === 'write_file' || c === 'finalize_recording_bundle');
      expect(order).toEqual(['write_file', 'finalize_recording_bundle', 'write_file', 'finalize_recording_bundle']);
      expect(log.written.map((w) => w.path)).toEqual([
        `${ORPHAN_A}/recording.json`,
        `${ORPHAN_B}/recording.json`,
      ]);
      expect(log.finalized).toEqual([
        { stagingDir: ORPHAN_A, destRecordingsDir: LIBRARY },
        { stagingDir: ORPHAN_B, destRecordingsDir: LIBRARY },
      ]);

      const first = parseRecordingManifest(log.written[0].content)!;
      expect(first.durationSecs).toBe(1800);
      expect(Date.parse(first.startedAt)).toBe(Date.parse('2026-11-20T09:00:00+01:00'));
      expect(first.audio.codec).toBe('pcm');
      const second = JSON.parse(log.written[1].content) as {
        source: string;
        tracks: { role: string; file: string }[];
      };
      // No source on record: worked out from the files that are there.
      expect(second.source).toBe('both');
      expect(second.tracks).toEqual([
        { role: 'mix', file: 'audio.wav' },
        { role: 'mic', file: 'mic.wav' },
        { role: 'system', file: 'system.wav' },
      ]);

      expect(startTranscription).toHaveBeenCalledTimes(2);
      const infos = toastActions('info');
      expect(infos).toHaveLength(2);
      expect(infos[0].message).toMatch(/^Recovered a recording from .*2026/);
      expect(infos[0].action?.label).toBe('Open Recordings');

      // Once per launch.
      expect(await recoverOrphanRecordings()).toBe(0);
      expect(count('recover_orphan_recordings')).toBe(1);
    });

    it('keeps a manifest that is already there (the stop succeeded, only the move had failed)', async () => {
      setMockInvokeHandler('recover_orphan_recordings', () => [
        {
          bundle_dir: ORPHAN_A,
          audio_path: `${ORPHAN_A}/audio.m4a`,
          tracks: [],
          duration_secs: 1800,
          started_at: '2026-11-20T09:00:00+01:00',
          source: 'system',
          has_manifest: true,
        },
      ]);
      expect(await recoverOrphanRecordings()).toBe(1);
      // Not rewritten: the original carries the real language and times.
      expect(log.written).toHaveLength(0);
      expect(log.finalized).toEqual([{ stagingDir: ORPHAN_A, destRecordingsDir: LIBRARY }]);
      expect(startTranscription).toHaveBeenCalledTimes(1);
    });

    it("uses the backend's record of the source when it has one", async () => {
      setMockInvokeHandler('recover_orphan_recordings', () => [
        {
          bundle_dir: ORPHAN_A,
          audio_path: `${ORPHAN_A}/audio.wav`,
          tracks: [],
          duration_secs: 5,
          started_at: null,
          source: 'system',
          has_manifest: false,
        },
      ]);
      await recoverOrphanRecordings();
      expect((JSON.parse(log.written[0].content) as { source: string }).source).toBe('system');
    });

    it('does nothing visible when there is nothing to recover', async () => {
      expect(await recoverOrphanRecordings()).toBe(0);
      expect(toast.info).not.toHaveBeenCalled();
      expect(log.written).toHaveLength(0);
    });

    it('survives a backend without the command', async () => {
      setMockInvokeHandler('recover_orphan_recordings', () => {
        throw new Error('unknown command');
      });
      setMockInvokeHandler('get_recording_state', () => {
        throw new Error('unknown command');
      });
      await expect(recoverOrphanRecordings()).resolves.toBe(0);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('keeps going when one orphan cannot be filed', async () => {
      setMockInvokeHandler('recover_orphan_recordings', () => [
        { bundle_dir: ORPHAN_A, audio_path: `${ORPHAN_A}/audio.wav`, tracks: [], duration_secs: 10, started_at: null },
        { bundle_dir: ORPHAN_B, audio_path: `${ORPHAN_B}/audio.wav`, tracks: [], duration_secs: 20, started_at: null },
      ]);
      let calls = 0;
      setMockInvokeHandler('finalize_recording_bundle', (args) => {
        calls += 1;
        if (calls === 1) throw new Error('disk full');
        const dir = `${String(args?.destRecordingsDir)}/Recording B`;
        return { bundle_dir: dir, audio_path: `${dir}/audio.wav`, tracks: [] };
      });
      expect(await recoverOrphanRecordings()).toBe(1);
      expect(startTranscription).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledTimes(1);
    });

    it('takes the controls back up over a capture that is still running, and recovers nothing', async () => {
      setMockInvokeHandler('get_recording_state', () => ({
        recording: true,
        paused: true,
        source: 'both',
        started_at_ms: 1_700_000_000_000,
        elapsed_recorded_ms: 61_000,
      }));
      expect(await recoverOrphanRecordings()).toBe(0);

      const s = useRecordingStore.getState();
      expect(s.phase).toBe('paused');
      expect(s.isRecording).toBe(true);
      expect(s.recordingSource).toBe('both');
      expect(s.recordingStartTime).toBe(1_700_000_000_000);
      expect(recordingItems()).toHaveLength(1);
      // The live capture's bundle must not be "recovered" from under it.
      expect(count('recover_orphan_recordings')).toBe(0);
    });
  });
});
