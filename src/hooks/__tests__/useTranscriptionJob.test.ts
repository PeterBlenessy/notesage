// @vitest-environment jsdom
//
// The background transcription orchestrator, run for real against an
// in-memory folder: the job lifecycle (running → progress → done / error /
// cancelled), one job per audio file, progress by job id, what is written
// into the bundle, and what is never overwritten.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, getListenerCount, setMockInvokeHandler } from '@/test/tauri-mock';
import { RECORDINGS_DIR, addBundle, installFakeDisk, type FakeDisk } from '@/test/fake-recordings-disk';
import { renderHook, act, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import {
  FOCUS_TRANSCRIPTION_EVENT,
  LONG_JOB_NOTIFY_MS,
  cancelTranscriptionJob,
  findTranscriptionTask,
  startTranscription,
  takeYielded,
  useTranscriptionJob,
} from '@/hooks/useTranscriptionJob';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import { parseRecordingManifest } from '@/lib/transcription/manifest';
import { parseSegmentsFile } from '@/lib/transcription/segments';
import type { TranscriptionResult } from '@/lib/tauri';

// `sonner` is mocked by `@/test/tauri-mock`.
const toastError = toast.error as ReturnType<typeof vi.fn>;
const toastInfo = toast.info as ReturnType<typeof vi.fn>;
const toastSuccess = toast.success as ReturnType<typeof vi.fn>;

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification,
}));

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

const NAME = 'Recording 2026-09-05 14-02-11';
const SUCCESS: TranscriptionResult = {
  segments: [
    { start: 0, end: 4, text: 'Hello and welcome.', speaker_id: null, speaker_name: null },
    { start: 4.5, end: 9, text: 'Let us begin.', speaker_id: null, speaker_name: null },
  ],
  duration_secs: 9,
  language: 'en',
  decoder: 'symphonia',
};

let disk: FakeDisk;
let dir: string;
let AUDIO: string;
/** The pending `transcribe_file` calls, oldest first. */
let pending: Array<{ args: Record<string, unknown>; d: Deferred<TranscriptionResult> }>;

function jobTask() {
  return useActivityStore.getState().tasks[0];
}
function transcribeCalls() {
  return disk.calls.filter((c) => c.cmd === 'transcribe_file').map((c) => c.args);
}
async function settle(d: Deferred<TranscriptionResult>, outcome: TranscriptionResult | Error) {
  await act(async () => {
    if (outcome instanceof Error) d.reject(outcome);
    else d.resolve(outcome);
    await d.promise.catch(() => {});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  disk = installFakeDisk();
  dir = addBundle(disk, NAME);
  AUDIO = `${dir}/audio.m4a`;
  pending = [];
  disk.transcribe = (args) => {
    const d = deferred<TranscriptionResult>();
    pending.push({ args, d });
    return d.promise;
  };
  useActivityStore.setState({ tasks: [] });
  useRecordingStore.setState({ defaultModel: 'small', speechLanguage: 'sv', availableModels: [] });
  useSettingsStore.setState({ notifyAgentCompletion: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTranscriptionJob', () => {
  it('runs the success path: transcribe → segments.json + transcript → done', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO, documentId: 'doc-1' }));

    // The card is added synchronously, before any await: the scanner relies on it.
    const jobId = jobTask().id;
    expect(jobTask()).toMatchObject({ status: 'running', label: NAME, documentId: 'doc-1', audioPath: AUDIO });

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toEqual({ jobId, path: AUDIO, model: 'small', language: 'sv' });

    await settle(pending[0].d, SUCCESS);
    await waitFor(() => expect(jobTask().status).toBe('done'));

    const transcript = `${dir}/${NAME}.md`;
    expect(jobTask()).toMatchObject({ transcriptPath: transcript, progress: 100, detectedLanguage: 'en' });
    expect(disk.files.get(transcript)).toContain('[00:00:00] Hello and welcome. Let us begin.');
    expect(parseSegmentsFile(disk.files.get(`${dir}/segments.json`)!)).toEqual([
      { start: 0, end: 4, text: 'Hello and welcome.' },
      { start: 4.5, end: 9, text: 'Let us begin.' },
    ]);
    expect(parseRecordingManifest(disk.files.get(`${dir}/recording.json`)!)?.transcript?.file).toBe(`${NAME}.md`);
  });

  it('passes the "auto" language through to the backend (no English coercion)', async () => {
    // Regression lock: a truthy 'auto' must not be dropped to undefined nor
    // silently turned into 'en'.
    useRecordingStore.setState({ defaultModel: 'small', speechLanguage: 'auto' });
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ model: 'small', language: 'auto' });
  });

  it('on transcribe failure marks the job errored with the reason and leaves it re-runnable', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(pending).toHaveLength(1));

    await settle(pending[0].d, new Error('whisper boom'));

    await waitFor(() => expect(jobTask().status).toBe('error'));
    expect(jobTask()).toMatchObject({ errorMessage: 'whisper boom', audioPath: AUDIO });
    expect(jobTask().transcriptPath).toBeUndefined();
    expect(toastError).toHaveBeenCalledWith('Transcription failed: whisper boom');
    // No note written.
    expect([...disk.files.keys()].some((p) => p.endsWith('.md'))).toBe(false);
  });

  it('ignores start events after unmount, and removes its one progress listener', async () => {
    const { unmount } = renderHook(() => useTranscriptionJob());
    await waitFor(() => expect(getListenerCount('transcription-progress')).toBe(1));
    unmount();
    expect(getListenerCount('transcription-progress')).toBe(0);
    act(() => startTranscription({ audioPath: AUDIO }));
    expect(useActivityStore.getState().tasks).toHaveLength(0);
    expect(transcribeCalls()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Language and model
  // -------------------------------------------------------------------------

  it('uses a per-recording language override over the store default, and records it on the job', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO, language: 'en' }));
    expect(jobTask().language).toBe('en');
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ language: 'en' });
  });

  it('uses a downloaded model when the default is not downloaded (U6)', async () => {
    useRecordingStore.setState({
      defaultModel: 'large-v3-turbo-q5_0',
      availableModels: [
        { name: 'large-v3-turbo-q5_0', size_bytes: 1, downloaded: false },
        { name: 'medium', size_bytes: 1, downloaded: true },
      ],
    } as Partial<ReturnType<typeof useRecordingStore.getState>>);
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ model: 'medium' });
  });

  // -------------------------------------------------------------------------
  // U20 — one job per audio file
  // -------------------------------------------------------------------------

  it('a second request for an audio file that is already running starts nothing', async () => {
    const focused: string[] = [];
    const onFocus = (e: Event) => focused.push((e as CustomEvent<{ taskId: string }>).detail.taskId);
    window.addEventListener(FOCUS_TRANSCRIPTION_EVENT, onFocus);

    renderHook(() => useTranscriptionJob());
    act(() => {
      startTranscription({ audioPath: AUDIO });
      startTranscription({ audioPath: AUDIO });
      startTranscription({ audioPath: AUDIO, model: 'large-v3' });
    });
    window.removeEventListener(FOCUS_TRANSCRIPTION_EVENT, onFocus);

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(useActivityStore.getState().tasks).toHaveLength(1);
    expect(transcribeCalls()).toHaveLength(1);
    // The existing job is pointed at instead, twice.
    expect(focused).toEqual([jobTask().id, jobTask().id]);
    expect(toastInfo).toHaveBeenCalledWith('This recording is already being transcribed.');
  });

  it('a re-run with the job id of a card that is running is refused as well', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const id = jobTask().id;
    act(() => startTranscription({ audioPath: AUDIO, jobId: id, model: 'base' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(transcribeCalls()).toHaveLength(1);
  });

  it('a new request for a recording with a FINISHED card reuses that card', async () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'Old label', audioPath: AUDIO, language: 'en' });
    useActivityStore.getState().setTranscriptionError('tx-1', 'boom');

    renderHook(() => useTranscriptionJob());
    // No jobId given: the Recordings row does not know the card.
    act(() => startTranscription({ audioPath: AUDIO }));

    expect(useActivityStore.getState().tasks).toHaveLength(1);
    expect(jobTask()).toMatchObject({ id: 'tx-1', status: 'running', progress: 0 });
    expect(jobTask().errorMessage).toBeUndefined();
    await waitFor(() => expect(pending).toHaveLength(1));
    // The language of the earlier run is kept unless another is asked for.
    expect(pending[0].args).toMatchObject({ jobId: 'tx-1', language: 'en' });
  });

  it('re-run: a jobId + model override reuses the existing task, and a failure does not duplicate it', async () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: NAME, audioPath: AUDIO });
    useActivityStore.getState().setTranscriptionDone('tx-1', `${dir}/transcript.md`);
    renderHook(() => useTranscriptionJob());

    act(() => startTranscription({ audioPath: AUDIO, jobId: 'tx-1', model: 'large-v3' }));
    expect(useActivityStore.getState().tasks).toHaveLength(1);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ jobId: 'tx-1', model: 'large-v3', language: 'sv' });

    await settle(pending[0].d, new Error('whisper boom again'));
    await waitFor(() => expect(jobTask().status).toBe('error'));
    expect(useActivityStore.getState().tasks).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // U16 / T2 — progress by job id, integer percents, stages
  // -------------------------------------------------------------------------

  it('routes transcription-progress by job_id, with its stage', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const jobId = jobTask().id;
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => emitMockEvent('transcription-progress', { job_id: jobId, audio_path: AUDIO, stage: 'loading', percent: 0 }));
    expect(jobTask()).toMatchObject({ progress: 0, transcriptionStage: 'loading' });
    act(() => emitMockEvent('transcription-progress', { job_id: jobId, audio_path: AUDIO, stage: 'transcribing', percent: 42 }));
    expect(jobTask()).toMatchObject({ progress: 42, transcriptionStage: 'transcribing' });

    // A progress event for a different job must NOT bleed into this task.
    act(() => emitMockEvent('transcription-progress', { job_id: 'other-job', audio_path: '/x/y.wav', stage: 'transcribing', percent: 99 }));
    expect(jobTask().progress).toBe(42);
  });

  it('matches a payload with no job id by the file it names, and ignores garbage', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const jobId = jobTask().id;
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => emitMockEvent('transcription-progress', { job_id: null, audio_path: AUDIO, stage: 'transcribing', percent: 9 }));
    expect(jobTask().progress).toBe(9);
    // Garbage does not throw and changes nothing.
    act(() => emitMockEvent('transcription-progress', null));
    act(() => emitMockEvent('transcription-progress', { job_id: jobId, percent: 'half' }));
    expect(jobTask().progress).toBe(9);
  });

  it('one listener serves every job, however many run', async () => {
    const other = addBundle(disk, 'Recording 2026-09-06 09-00-00');
    renderHook(() => useTranscriptionJob());
    act(() => {
      startTranscription({ audioPath: AUDIO });
      startTranscription({ audioPath: `${other}/audio.m4a` });
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(getListenerCount('transcription-progress')).toBe(1);
  });

  // -------------------------------------------------------------------------
  // U16 / T3 — cancel
  // -------------------------------------------------------------------------

  it('cancel asks the backend by job id and audio path; the rejection makes the job cancelled, not failed', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    const jobId = jobTask().id;
    await waitFor(() => expect(pending).toHaveLength(1));

    await act(async () => {
      await cancelTranscriptionJob(jobId);
    });
    expect(disk.calls.filter((c) => c.cmd === 'cancel_transcription').map((c) => c.args)).toEqual([
      { jobId, audioPath: AUDIO },
    ]);
    // Not flipped until the backend actually lets go of the job.
    expect(jobTask().status).toBe('running');

    await settle(pending[0].d, new Error('Transcription cancelled'));
    await waitFor(() => expect(jobTask().status).toBe('cancelled'));
    expect(jobTask().errorMessage).toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();
    expect([...disk.files.keys()].some((p) => p.endsWith('.md'))).toBe(false);
    expect(takeYielded(jobId)).toBe(false);
  });

  it('cancel of a job the backend does not know flips the card itself', async () => {
    setMockInvokeHandler('cancel_transcription', () => false);
    useActivityStore.getState().addTranscriptionJob({ id: 'ghost', label: NAME, audioPath: AUDIO });
    await cancelTranscriptionJob('ghost');
    expect(jobTask().status).toBe('cancelled');
  });

  it('cancelling a job that is not running does nothing', async () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: NAME, audioPath: AUDIO });
    useActivityStore.getState().setTranscriptionDone('tx-1', `${dir}/transcript.md`);
    await cancelTranscriptionJob('tx-1');
    await cancelTranscriptionJob('nope');
    expect(disk.count('cancel_transcription')).toBe(0);
    expect(jobTask().status).toBe('done');
  });

  it('remembers, once, that a cancel was a yield to another device', async () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: NAME, audioPath: AUDIO });
    await cancelTranscriptionJob('tx-1', { yieldToOtherDevice: true });
    expect(takeYielded('tx-1')).toBe(true);
    expect(takeYielded('tx-1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // N1 — two tracks → speakers
  // -------------------------------------------------------------------------

  it('passes the tracks it is given, and writes a transcript with "Me" and "Others"', async () => {
    const tracks = [
      { role: 'mic' as const, path: `${dir}/mic.m4a` },
      { role: 'system' as const, path: `${dir}/system.m4a` },
    ];
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO, tracks }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args.tracks).toEqual(tracks);

    await settle(pending[0].d, {
      ...SUCCESS,
      segments: [
        { start: 1, end: 4, text: 'Shall we start?', speaker: 'me', speaker_id: null, speaker_name: null },
        { start: 5, end: 8, text: 'Yes.', speaker: 'others', speaker_id: null, speaker_name: null },
      ],
    });
    await waitFor(() => expect(jobTask().status).toBe('done'));
    const note = disk.files.get(jobTask().transcriptPath!)!;
    expect(note).toContain('**Me** [00:00:01] Shall we start?');
    expect(note).toContain('**Others** [00:00:05] Yes.');
    // Kept on the card, so a re-run from it labels speakers too.
    expect(jobTask().tracks).toEqual(tracks);
  });

  it('finds the tracks in the manifest when the caller does not name them (scanner, re-run, Recordings row)', async () => {
    const both = addBundle(disk, 'Recording 2026-09-07 10-00-00', {
      manifest: {
        source: 'both',
        tracks: [
          { role: 'mix', file: 'audio.m4a' },
          { role: 'mic', file: 'mic.m4a' },
          { role: 'system', file: 'system.m4a' },
        ],
      },
    });
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: `${both}/audio.m4a` }));
    await waitFor(() => expect(pending).toHaveLength(1));
    // The mix is not a track to transcribe; mic and system are, as absolute paths.
    expect(pending[0].args.tracks).toEqual([
      { role: 'mic', path: `${both}/mic.m4a` },
      { role: 'system', path: `${both}/system.m4a` },
    ]);
  });

  it('sends no tracks for an ordinary recording', async () => {
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).not.toHaveProperty('tracks');
  });

  // -------------------------------------------------------------------------
  // U21 / U23 — naming, and never overwriting silently
  // -------------------------------------------------------------------------

  it('labels the card with, and names the transcript after, the title the user gave', async () => {
    const titled = addBundle(disk, 'Recording 2026-09-08 08-00-00', { manifest: { title: 'Weekly sync' } });
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: `${titled}/audio.m4a` }));
    await waitFor(() => expect(jobTask().label).toBe('Weekly sync'));
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0].d, SUCCESS);
    await waitFor(() => expect(jobTask().status).toBe('done'));
    expect(jobTask().transcriptPath).toBe(`${titled}/Weekly sync.md`);
  });

  it('with no answer from the user, an existing transcript is kept and the new one written beside it', async () => {
    disk.files.set(`${dir}/transcript.md`, '# Old\n\nedited by hand\n');
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0].d, SUCCESS);
    await waitFor(() => expect(jobTask().status).toBe('done'));

    expect(disk.files.get(`${dir}/transcript.md`)).toBe('# Old\n\nedited by hand\n');
    expect(jobTask().transcriptPath).toBe(`${dir}/${NAME}.md`);
  });

  it('"Replace" overwrites the existing transcript; "Keep both" does not', async () => {
    disk.files.set(`${dir}/transcript.md`, '# Old\n');
    renderHook(() => useTranscriptionJob());
    act(() => startTranscription({ audioPath: AUDIO, transcriptMode: 'replace' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0].d, SUCCESS);
    await waitFor(() => expect(jobTask().status).toBe('done'));
    expect(jobTask().transcriptPath).toBe(`${dir}/transcript.md`);
    expect(disk.files.get(`${dir}/transcript.md`)).toContain('Hello and welcome.');
  });

  // -------------------------------------------------------------------------
  // U22 — tell the user when a long job finishes behind their back
  // -------------------------------------------------------------------------

  describe('finishing a long job', () => {
    async function runFor(ms: number, focused: boolean) {
      vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
      const realNow = Date.now();
      const now = vi.spyOn(Date, 'now').mockReturnValue(realNow);
      renderHook(() => useTranscriptionJob());
      act(() => startTranscription({ audioPath: AUDIO }));
      await waitFor(() => expect(pending).toHaveLength(1));
      now.mockReturnValue(realNow + ms);
      await settle(pending[0].d, SUCCESS);
      await waitFor(() => expect(jobTask().status).toBe('done'));
    }

    it('notifies and leaves a toast with "Open transcript" when the window is not focused', async () => {
      const opened: unknown[] = [];
      const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
      window.addEventListener('notesage:open-file', onOpen);

      await runFor(LONG_JOB_NOTIFY_MS + 1000, false);

      await waitFor(() => expect(sendNotification).toHaveBeenCalledWith({ title: 'Transcript ready', body: NAME }));
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      const [message, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
      expect(message).toBe(`The transcript of “${NAME}” is ready`);
      expect(options.action.label).toBe('Open transcript');
      options.action.onClick();
      window.removeEventListener('notesage:open-file', onOpen);
      expect(opened).toEqual([{ filePath: `${dir}/${NAME}.md`, fileName: `${NAME}.md` }]);
    });

    it('says nothing extra for a short job, or when the user is looking at the app', async () => {
      await runFor(5000, false);
      expect(sendNotification).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('says nothing extra when the window has focus', async () => {
      await runFor(LONG_JOB_NOTIFY_MS + 1000, true);
      expect(sendNotification).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  it('exposes the job for an audio file', () => {
    expect(findTranscriptionTask(AUDIO)).toBeUndefined();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: NAME, audioPath: AUDIO });
    expect(findTranscriptionTask(AUDIO)?.id).toBe('tx-1');
    expect(findTranscriptionTask(`${RECORDINGS_DIR}/other/audio.m4a`)).toBeUndefined();
  });
});
