// @vitest-environment jsdom
//
// The Mac side of the phone → Mac recording handoff (PRD 2026-09-05-ios-
// recordings, tasks #15/#16): the startup scan, the watcher re-evaluation,
// every skip rule, the size gate, FIFO one-at-a-time dispatch, and the
// manifest write-back at claim / done / failure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, getListenerCount, setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useRecordingsInbox,
  evaluateBundle,
  nextEligible,
  bundleDirForEvent,
  isRecordingBundleName,
  manifestLanguage,
  BUNDLE_REEVALUATE_DEBOUNCE_MS,
  RUNNING_CLAIM_TTL_MS,
  type EligibleBundle,
} from '@/hooks/useRecordingsInbox';
import {
  START_TRANSCRIPTION_EVENT,
  type StartTranscriptionDetail,
} from '@/hooks/useTranscriptionJob';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  parseRecordingManifest,
  serializeRecordingManifest,
  withTranscriptionStatus,
  type RecordingManifest,
  type TranscriptionStatus,
} from '@/lib/transcription/manifest';

const FIXTURE = readFileSync(join(__dirname, '../../../tests/fixtures/recording-manifest.v1.json'), 'utf8');
const BASE = parseRecordingManifest(FIXTURE)!;
const DIR = '/lib/Recordings';
const MAC = "Peter's Mac";

// ---------------------------------------------------------------------------
// An in-memory library: text files by content, audio files by size only.
// ---------------------------------------------------------------------------

const texts = new Map<string, string>();
const sizes = new Map<string, number>();
const writes: Array<{ path: string; content: string }> = [];
const ensureDownloaded = vi.fn<(path: string) => 'ready' | 'downloading' | 'failed'>(() => 'failed');

function isDir(path: string): boolean {
  const prefix = `${path}/`;
  for (const k of texts.keys()) if (k.startsWith(prefix)) return true;
  for (const k of sizes.keys()) if (k.startsWith(prefix)) return true;
  return false;
}

function installFs(): void {
  setMockInvokeHandler('get_device_name', () => MAC);
  setMockInvokeHandler('list_files_shallow', (args) => {
    const path = String(args?.path);
    if (!isDir(path)) throw new Error(`no such dir ${path}`);
    const names = new Set<string>();
    for (const k of [...texts.keys(), ...sizes.keys()]) {
      if (k.startsWith(`${path}/`)) names.add(k.slice(path.length + 1).split('/')[0]);
    }
    return [...names].map((name) => ({ name, path: `${path}/${name}`, is_directory: true, hidden: false }));
  });
  setMockInvokeHandler('read_file', (args) => {
    const path = String(args?.path);
    if (!texts.has(path)) throw new Error(`ENOENT ${path}`);
    return texts.get(path);
  });
  setMockInvokeHandler('write_file', (args) => {
    const path = String(args?.path);
    const content = String(args?.content);
    texts.set(path, content);
    writes.push({ path, content });
  });
  setMockInvokeHandler('path_exists', (args) => {
    const path = String(args?.path);
    return texts.has(path) || sizes.has(path) || isDir(path);
  });
  setMockInvokeHandler('file_size', (args) => {
    const path = String(args?.path);
    if (!sizes.has(path)) throw new Error(`ENOENT ${path}`);
    return sizes.get(path);
  });
  setMockInvokeHandler('icloud_ensure_downloaded', (args) => ensureDownloaded(String(args?.path)));
}

interface BundleSpec {
  manifest?: RecordingManifest | null;
  /** Bytes actually on disk; `undefined` = file absent. Defaults to the manifest's byte count. */
  audioBytes?: number | null;
  transcript?: boolean;
}

function manifest(over: Partial<RecordingManifest> = {}): RecordingManifest {
  return { ...BASE, ...over };
}

function bundle(name: string, spec: BundleSpec = {}): string {
  const dir = `${DIR}/${name}`;
  const m = spec.manifest === undefined ? manifest() : spec.manifest;
  if (m) texts.set(`${dir}/recording.json`, serializeRecordingManifest(m));
  const file = m?.audio.file ?? 'audio.wav';
  const bytes = spec.audioBytes === undefined ? m?.audio.bytes ?? 1 : spec.audioBytes;
  if (bytes !== null) sizes.set(`${dir}/${file}`, bytes);
  if (spec.transcript) texts.set(`${dir}/transcript.md`, '# Transcript');
  return dir;
}

function manifestOnDisk(dir: string): RecordingManifest | null {
  const raw = texts.get(`${dir}/recording.json`);
  return raw ? parseRecordingManifest(raw) : null;
}

function status(dir: string): TranscriptionStatus | null | undefined {
  return manifestOnDisk(dir)?.transcription;
}

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

// ---------------------------------------------------------------------------
// A stand-in for `useTranscriptionJob`: the event adds a running job, tests
// finish it by hand. Not mounting the real hook keeps Whisper out of it.
// ---------------------------------------------------------------------------

const dispatched: StartTranscriptionDetail[] = [];
let jobSeq = 0;
let autoCreateJob = true;

function onStart(event: Event): void {
  const detail = (event as CustomEvent<StartTranscriptionDetail>).detail;
  dispatched.push(detail);
  if (!autoCreateJob) return;
  useActivityStore.getState().addTranscriptionJob({
    id: `job-${++jobSeq}`,
    label: 'Recording',
    audioPath: detail.audioPath,
    recordingStartedAt: detail.recordingStartedAt,
    recordingDurationSecs: detail.recordingDurationSecs,
    language: detail.language ?? 'en',
    sourceDevice: detail.sourceDevice,
  });
}

function runningJobs() {
  return useActivityStore.getState().tasks.filter((t) => t.kind === 'transcription' && t.status === 'running');
}

function finishJob(audioPath: string, outcome: 'done' | 'error', detectedLanguage = 'sv'): void {
  const task = useActivityStore.getState().tasks.find((t) => t.audioPath === audioPath && t.status === 'running');
  if (!task) throw new Error(`no running job for ${audioPath}`);
  const dir = audioPath.slice(0, audioPath.lastIndexOf('/'));
  if (outcome === 'done') {
    texts.set(`${dir}/transcript.md`, '# Transcript');
    useActivityStore.getState().setTranscriptionDone(task.id, `${dir}/transcript.md`, detectedLanguage);
  } else {
    useActivityStore.getState().setTranscriptionError(task.id, 'Unrecognised audio format');
  }
}

/** Let the scanner's promise chains run to completion (no timers involved). */
async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function debounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(BUNDLE_REEVALUATE_DEBOUNCE_MS + 10);
  await flush();
}

function mount() {
  const view = renderHook(() => useRecordingsInbox());
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  texts.clear();
  sizes.clear();
  writes.length = 0;
  dispatched.length = 0;
  jobSeq = 0;
  autoCreateJob = true;
  ensureDownloaded.mockReset();
  ensureDownloaded.mockReturnValue('failed');
  installFs();
  window.addEventListener(START_TRANSCRIPTION_EVENT, onStart);
  useActivityStore.setState({ tasks: [] });
  useRecordingStore.setState({ defaultModel: 'large-v3-turbo-q5_0', speechLanguage: 'en' });
  useSettingsStore.setState({
    startupReady: true,
    notesRootPath: '/lib',
    icloudNotesagePath: null,
    homeDir: '/Users/test',
  });
});

afterEach(() => {
  window.removeEventListener(START_TRANSCRIPTION_EVENT, onStart);
  vi.useRealTimers();
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe('evaluateBundle', () => {
  const ctx = () => ({ now: Date.now(), device: MAC, trackedAudioPaths: new Set<string>() });
  const dir = `${DIR}/Recording 2026-09-05 14-02-11`;
  const facts = (over: Partial<Parameters<typeof evaluateBundle>[0]> = {}) => ({
    bundleDir: dir,
    manifest: manifest(),
    transcriptExists: false,
    audioBytes: BASE.audio.bytes,
    ...over,
  });

  it('is eligible for a pending bundle whose audio is complete', () => {
    const r = evaluateBundle(facts(), ctx());
    expect(r.verdict).toBe('eligible');
    expect((r as EligibleBundle).audioPath).toBe(`${dir}/audio.m4a`);
  });
  it('skips a bundle without a manifest (a pre-manifest Mac WAV bundle)', () => {
    expect(evaluateBundle(facts({ manifest: null }), ctx())).toMatchObject({ verdict: 'skip', reason: 'no-manifest' });
  });
  it('skips once transcript.md exists, whatever the manifest says', () => {
    expect(evaluateBundle(facts({ transcriptExists: true }), ctx())).toMatchObject({ verdict: 'skip', reason: 'transcript-exists' });
  });
  it('skips done and failed', () => {
    const at = (s: 'done' | 'failed') => manifest({ transcription: { status: s, device: 'Other', updatedAt: iso(0) } });
    expect(evaluateBundle(facts({ manifest: at('done') }), ctx())).toMatchObject({ verdict: 'skip', reason: 'done' });
    expect(evaluateBundle(facts({ manifest: at('failed') }), ctx())).toMatchObject({ verdict: 'skip', reason: 'failed' });
  });
  it('skips a fresh running claim by another device and reclaims a stale one', () => {
    const running = (msAgo: number, device: string) =>
      manifest({ transcription: { status: 'running', device, updatedAt: iso(msAgo) } });
    expect(evaluateBundle(facts({ manifest: running(5 * 60_000, "Peter's iMac") }), ctx())).toMatchObject({ verdict: 'skip', reason: 'running-elsewhere' });
    expect(evaluateBundle(facts({ manifest: running(RUNNING_CLAIM_TTL_MS + 1, "Peter's iMac") }), ctx()).verdict).toBe('eligible');
    // Our own stale claim (a crash mid-run) is ours to retake.
    expect(evaluateBundle(facts({ manifest: running(1000, MAC) }), ctx()).verdict).toBe('eligible');
    // An undatable claim never locks the bundle forever.
    expect(evaluateBundle(facts({ manifest: running(0, 'X') }), { ...ctx(), now: NaN }).verdict).toBe('eligible');
  });
  it('skips a bundle the activity store already tracks by audioPath', () => {
    const tracked = new Set([`${dir}/audio.m4a`]);
    expect(evaluateBundle(facts(), { ...ctx(), trackedAudioPaths: tracked })).toMatchObject({ verdict: 'skip', reason: 'already-tracked' });
  });
  it('waits while the audio is missing or its size does not match the manifest', () => {
    expect(evaluateBundle(facts({ audioBytes: null }), ctx())).toMatchObject({ verdict: 'wait', reason: 'audio-missing', expectedBytes: BASE.audio.bytes });
    expect(evaluateBundle(facts({ audioBytes: 100 }), ctx())).toMatchObject({ verdict: 'wait', reason: 'size-mismatch', actualBytes: 100 });
  });
});

describe('nextEligible', () => {
  const el = (name: string): EligibleBundle => ({
    verdict: 'eligible', bundleDir: `${DIR}/${name}`, audioPath: `${DIR}/${name}/audio.m4a`, manifest: manifest(),
  });
  it('picks the earliest stamp and nothing while a job is in flight', () => {
    const q = [el('Recording 2026-09-05 15-00-00'), el('Recording 2026-09-05 14-02-11'), el('Recording 2026-09-06 09-00-00')];
    expect(nextEligible(q, false)?.bundleDir).toBe(`${DIR}/Recording 2026-09-05 14-02-11`);
    expect(nextEligible(q, true)).toBeNull();
    expect(nextEligible([], false)).toBeNull();
  });
});

describe('bundleDirForEvent / isRecordingBundleName / manifestLanguage', () => {
  it('maps an event anywhere inside a bundle to the bundle folder', () => {
    expect(bundleDirForEvent(DIR, `${DIR}/Recording 2026-09-05 14-02-11/audio.m4a`)).toBe(`${DIR}/Recording 2026-09-05 14-02-11`);
    expect(bundleDirForEvent(`${DIR}/`, `${DIR}/Recording 2026-09-05 14-02-11`)).toBe(`${DIR}/Recording 2026-09-05 14-02-11`);
    expect(bundleDirForEvent(DIR, `${DIR}/notes.md`)).toBeNull();
    expect(bundleDirForEvent(DIR, `/lib/Inbox/Recording 2026-09-05 14-02-11/audio.m4a`)).toBeNull();
    expect(bundleDirForEvent(DIR, `/lib/RecordingsBackup/Recording 2026-09-05 14-02-11/a`)).toBeNull();
  });
  it('recognises the stamp prefix only', () => {
    expect(isRecordingBundleName('Recording 2026-09-05 14-02-11')).toBe(true);
    expect(isRecordingBundleName('Recording ')).toBe(false);
    expect(isRecordingBundleName('Meeting 2026-05-30 14-02-11')).toBe(false);
  });
  it('passes a known language through and drops auto / unknown ones', () => {
    expect(manifestLanguage(manifest({ language: 'sv' }))).toBe('sv');
    expect(manifestLanguage(manifest({ language: 'auto' }))).toBeUndefined();
    expect(manifestLanguage(manifest({ language: 'tlh' }))).toBeUndefined();
    expect(manifestLanguage(manifest({ language: undefined }))).toBeUndefined();
  });
});

// ===========================================================================
// The hook
// ===========================================================================

describe('useRecordingsInbox — startup scan', () => {
  it('finds the pending bundles, ignores done and pre-manifest Mac bundles, and runs them one at a time in stamp order', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    const b = bundle('Recording 2026-09-05 15-00-00');
    bundle('Recording 2026-09-04 10-00-00', { transcript: true });
    const mac = bundle('Recording 2026-09-03 09-00-00', { manifest: null, audioBytes: 500 });

    mount();
    await flush();

    // Exactly one job, the earliest stamp, and its claim is on disk.
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${a}/audio.m4a`]);
    expect(runningJobs()).toHaveLength(1);
    expect(status(a)).toMatchObject({ status: 'running', device: MAC });
    expect(status(b)).toBeNull();
    expect(texts.has(`${mac}/recording.json`)).toBe(false);

    // The second waits for the first to finish; then it goes, never both.
    finishJob(`${a}/audio.m4a`, 'done');
    await flush();
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${a}/audio.m4a`, `${b}/audio.m4a`]);
    expect(runningJobs()).toHaveLength(1);
    expect(status(a)).toMatchObject({ status: 'done', device: MAC, model: 'large-v3-turbo-q5_0', language: 'sv' });
    expect(status(b)).toMatchObject({ status: 'running', device: MAC });

    finishJob(`${b}/audio.m4a`, 'done');
    await flush();
    expect(runningJobs()).toHaveLength(0);
    expect(dispatched).toHaveLength(2);
  });

  it('carries the phone’s metadata onto the job: start, length, language and the source device', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    mount();
    await flush();
    expect(dispatched[0]).toMatchObject({
      audioPath: `${a}/audio.m4a`,
      recordingStartedAt: Date.parse(BASE.startedAt),
      recordingStoppedAt: Date.parse(BASE.startedAt) + BASE.durationSecs * 1000,
      recordingDurationSecs: BASE.durationSecs,
      language: 'sv',
      sourceDevice: "Peter's iPhone",
    });
    expect(runningJobs()[0].sourceDevice).toBe("Peter's iPhone");
  });

  it('gives the Mac’s own bundle no source-device caption', async () => {
    bundle('Recording 2026-09-05 14-02-11', {
      manifest: manifest({ createdBy: { device: MAC, app: 'notesage-macos', appVersion: '0.57.0' }, audio: { ...BASE.audio, file: 'audio.wav', codec: 'pcm' } }),
    });
    mount();
    await flush();
    expect(dispatched[0].sourceDevice).toBeUndefined();
    expect(dispatched[0].audioPath).toMatch(/audio\.wav$/);
  });

  it('a pre-manifest Mac WAV bundle becomes eligible once a manifest is written for it', async () => {
    const mac = bundle('Recording 2026-09-03 09-00-00', { manifest: null, audioBytes: 500 });
    mount();
    await flush();
    expect(dispatched).toHaveLength(0);

    // #13 — the Mac now writes one for its own bundles.
    texts.set(`${mac}/recording.json`, serializeRecordingManifest(manifest({ audio: { ...BASE.audio, file: 'audio.wav', codec: 'pcm', bytes: 500 } })));
    emitMockEvent('file-changed-batch', [{ path: `${mac}/recording.json`, kind: 'create' }]);
    await debounce();
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${mac}/audio.wav`]);
  });

  it('does nothing when there is no Recordings folder yet', async () => {
    mount();
    await flush();
    expect(dispatched).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('waits for startupReady and uses the iCloud library root when sync is on', async () => {
    useSettingsStore.setState({ startupReady: false, icloudNotesagePath: '/lib' });
    mount();
    await flush();
    expect(dispatched).toHaveLength(0);
    bundle('Recording 2026-09-05 14-02-11');
    useSettingsStore.setState({ startupReady: true });
    await flush();
    expect(dispatched).toHaveLength(1);
  });
});

describe('useRecordingsInbox — skip rules on disk', () => {
  it('skips a bundle running on another device within the hour, and reclaims one older than that', async () => {
    const fresh = bundle('Recording 2026-09-05 14-02-11', {
      manifest: manifest({ transcription: { status: 'running', device: "Peter's iMac", updatedAt: iso(10 * 60_000) } }),
    });
    const stale = bundle('Recording 2026-09-05 15-00-00', {
      manifest: manifest({ transcription: { status: 'running', device: "Peter's iMac", updatedAt: iso(RUNNING_CLAIM_TTL_MS + 60_000) } }),
    });
    mount();
    await flush();
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${stale}/audio.m4a`]);
    expect(status(fresh)?.device).toBe("Peter's iMac");
    expect(status(stale)).toMatchObject({ status: 'running', device: MAC });
  });

  it('never retries a failed bundle on a rescan — Re-run on the card is the retry', async () => {
    const failed = bundle('Recording 2026-09-05 14-02-11', {
      manifest: manifest({ transcription: { status: 'failed', device: MAC, updatedAt: iso(1000), error: 'boom' } }),
    });
    mount();
    await flush();
    emitMockEvent('file-changed-batch', [{ path: `${failed}/audio.m4a`, kind: 'modify' }]);
    await debounce();
    expect(dispatched).toHaveLength(0);
    expect(status(failed)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('skips a bundle the activity store already tracks by audioPath', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    useActivityStore.getState().addTranscriptionJob({ id: 'pre', label: 'Recording', audioPath: `${a}/audio.m4a` });
    useActivityStore.getState().setTranscriptionError('pre');
    mount();
    await flush();
    expect(dispatched).toHaveLength(0);
  });
});

describe('useRecordingsInbox — the size gate', () => {
  it('defers a bundle whose audio is shorter than the manifest says, and dispatches on the modify event that completes it', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: 4000 });
    mount();
    await flush();
    expect(dispatched).toHaveLength(0);
    expect(writes).toHaveLength(0);

    // More bytes, still short.
    sizes.set(`${a}/audio.m4a`, 9000);
    emitMockEvent('file-changed-batch', [{ path: `${a}/audio.m4a`, kind: 'modify' }]);
    await debounce();
    expect(dispatched).toHaveLength(0);

    sizes.set(`${a}/audio.m4a`, BASE.audio.bytes);
    emitMockEvent('file-changed-batch', [{ path: `${a}/audio.m4a`, kind: 'modify' }]);
    await debounce();
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${a}/audio.m4a`]);
  });

  it('coalesces a burst of events per bundle into one re-evaluation', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: 10 });
    mount();
    await flush();
    const before = ensureDownloaded.mock.calls.length;
    sizes.set(`${a}/audio.m4a`, BASE.audio.bytes);
    for (let i = 0; i < 5; i++) {
      emitMockEvent('file-changed-batch', [{ path: `${a}/audio.m4a`, kind: 'modify' }]);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(dispatched).toHaveLength(0);
    await debounce();
    expect(dispatched).toHaveLength(1);
    expect(ensureDownloaded.mock.calls.length).toBe(before);
  });

  it('asks iCloud to download an evicted audio file and waits for the watcher rather than polling', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: null });
    ensureDownloaded.mockReturnValue('downloading');
    mount();
    await flush();
    expect(ensureDownloaded).toHaveBeenCalledWith(`${a}/audio.m4a`);
    expect(dispatched).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ensureDownloaded).toHaveBeenCalledTimes(1);

    sizes.set(`${a}/audio.m4a`, BASE.audio.bytes);
    emitMockEvent('file-changed-batch', [{ path: `${a}/audio.m4a`, kind: 'create' }]);
    await debounce();
    expect(dispatched).toHaveLength(1);
  });

  it('reads the size again when iCloud says the file is already there', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: null });
    ensureDownloaded.mockImplementation(() => {
      sizes.set(`${a}/audio.m4a`, BASE.audio.bytes);
      return 'ready';
    });
    mount();
    await flush();
    expect(dispatched).toHaveLength(1);
  });
});

describe('useRecordingsInbox — manifest write-back', () => {
  it('writes running at claim, done with model and detected language, and failed with the error', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    const b = bundle('Recording 2026-09-05 15-00-00');
    mount();
    await flush();
    expect(status(a)).toMatchObject({ status: 'running', device: MAC });
    expect(Date.parse(status(a)!.updatedAt)).not.toBeNaN();
    // The claim is written BEFORE the job is dispatched.
    const claimIdx = writes.findIndex((w) => w.path === `${a}/recording.json`);
    expect(claimIdx).toBe(0);

    finishJob(`${a}/audio.m4a`, 'done', 'sv');
    await flush();
    expect(status(a)).toEqual({
      status: 'done', device: MAC, updatedAt: expect.any(String), model: 'large-v3-turbo-q5_0', language: 'sv',
    });

    finishJob(`${b}/audio.m4a`, 'error');
    await flush();
    expect(status(b)).toEqual({
      status: 'failed', device: MAC, updatedAt: expect.any(String), error: 'Unrecognised audio format',
    });
    // Phone-owned fields survived every rewrite.
    expect(manifestOnDisk(a)?.createdBy.device).toBe("Peter's iPhone");
    expect(manifestOnDisk(b)?.audio.bytes).toBe(BASE.audio.bytes);
  });

  it('preserves fields it does not know across the rewrite', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    const raw = JSON.parse(texts.get(`${a}/recording.json`)!) as Record<string, unknown>;
    raw.phoneOnly = { keep: true };
    texts.set(`${a}/recording.json`, JSON.stringify(raw));
    mount();
    await flush();
    expect((JSON.parse(texts.get(`${a}/recording.json`)!) as Record<string, unknown>).phoneOnly).toEqual({ keep: true });
  });

  it('also annotates a job this scanner did not dispatch — the Mac’s own recording — on done', async () => {
    mount();
    await flush();
    const own = bundle('Recording 2026-09-05 16-00-00', {
      manifest: manifest({ createdBy: { device: MAC, app: 'notesage-macos', appVersion: '' }, audio: { ...BASE.audio, file: 'audio.wav', codec: 'pcm', bytes: 42 } }),
    });
    // `useMeetingRecording` writes the manifest, then dispatches; the job
    // hook adds the task — the scanner only sees the store transition.
    useActivityStore.getState().addTranscriptionJob({ id: 'own', label: 'Recording', audioPath: `${own}/audio.wav`, language: 'en' });
    await flush();
    expect(status(own)).toMatchObject({ status: 'running', device: MAC });
    finishJob(`${own}/audio.wav`, 'done', 'en');
    await flush();
    expect(status(own)).toMatchObject({ status: 'done', device: MAC, language: 'en' });
    expect(dispatched).toHaveLength(0);
  });

  it('re-marks a bundle running when the card’s Re-run flips a finished job back', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11');
    mount();
    await flush();
    finishJob(`${a}/audio.m4a`, 'error');
    await flush();
    expect(status(a)?.status).toBe('failed');
    const id = useActivityStore.getState().tasks[0].id;
    useActivityStore.getState().resetTranscriptionForRerun(id);
    await flush();
    expect(status(a)).toMatchObject({ status: 'running', device: MAC });
    // A Re-run may have picked another model — none is guessed on done.
    finishJob(`${a}/audio.m4a`, 'done');
    await flush();
    expect(status(a)?.model).toBeUndefined();
    expect(status(a)?.status).toBe('done');
  });

  it('leaves the queue moving when nothing picks up a dispatch (job hook not mounted)', async () => {
    autoCreateJob = false;
    const a = bundle('Recording 2026-09-05 14-02-11');
    const b = bundle('Recording 2026-09-05 15-00-00');
    mount();
    await flush();
    expect(dispatched.map((d) => d.audioPath)).toEqual([`${a}/audio.m4a`, `${b}/audio.m4a`]);
    expect(runningJobs()).toHaveLength(0);
  });
});

describe('useRecordingsInbox — lifecycle', () => {
  it('re-evaluates a bundle that arrives after startup, and drops one that is deleted', async () => {
    mount();
    await flush();
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: 5 });
    emitMockEvent('file-changed-batch', [
      { path: a, kind: 'create' },
      { path: `${a}/recording.json`, kind: 'create' },
      { path: `${a}/audio.m4a`, kind: 'create' },
    ]);
    await debounce();
    expect(dispatched).toHaveLength(0);
    emitMockEvent('file-changed-batch', [{ path: a, kind: 'delete' }]);
    texts.clear();
    sizes.clear();
    await debounce();
    expect(dispatched).toHaveLength(0);
  });

  it('unmount removes the watcher listener and cancels pending re-evaluations', async () => {
    const a = bundle('Recording 2026-09-05 14-02-11', { audioBytes: 5 });
    const view = mount();
    await flush();
    expect(getListenerCount('file-changed-batch')).toBe(1);
    sizes.set(`${a}/audio.m4a`, BASE.audio.bytes);
    emitMockEvent('file-changed-batch', [{ path: `${a}/audio.m4a`, kind: 'modify' }]);
    view.unmount();
    expect(getListenerCount('file-changed-batch')).toBe(0);
    await debounce();
    expect(dispatched).toHaveLength(0);
    // And a store change after unmount writes nothing.
    useActivityStore.getState().addTranscriptionJob({ id: 'late', label: 'x', audioPath: `${a}/audio.m4a` });
    await flush();
    expect(status(a)).toBeNull();
  });

  it('a manifest claim survives a status write racing a claim on the same bundle', async () => {
    // Two writes queued back to back on one bundle land in order.
    const a = bundle('Recording 2026-09-05 14-02-11');
    mount();
    await flush();
    finishJob(`${a}/audio.m4a`, 'done');
    await flush();
    const final = withTranscriptionStatus(manifestOnDisk(a)!, status(a)!);
    expect(parseRecordingManifest(serializeRecordingManifest(final))?.transcription?.status).toBe('done');
    const bundleWrites = writes.filter((w) => w.path === `${a}/recording.json`);
    expect(bundleWrites.map((w) => parseRecordingManifest(w.content)?.transcription?.status)).toEqual(['running', 'done']);
  });
});
