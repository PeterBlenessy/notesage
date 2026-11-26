// @vitest-environment jsdom
//
// The Recordings store against an in-memory folder: what the list costs to
// read (S4), what each bundle honestly is (U11, U17, U28), that it keeps
// itself current (U15), that the view is left (U1), and the actions a row
// offers (U21, U27, U29, N2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import { RECORDINGS_DIR, addBundle, installFakeDisk, type FakeDisk } from '@/test/fake-recordings-disk';
import {
  RECORDINGS_REFRESH_DEBOUNCE_MS,
  __resetRecordingsStoreMemory,
  isImportableFile,
  isUnsupportedContainer,
  useRecordingsStore,
} from '@/stores/recordings-store';
import { useActivityStore } from '@/stores/activity-store';
import { useEditorStore } from '@/stores/editor-store';
import { useInboxStore } from '@/stores/inbox-store';
import { useSettingsStore } from '@/stores/settings-store';
import { START_TRANSCRIPTION_EVENT, type StartTranscriptionDetail } from '@/hooks/useTranscriptionJob';
import { parseRecordingManifest } from '@/lib/transcription/manifest';

let disk: FakeDisk;
const started: StartTranscriptionDetail[] = [];
const onStart = (event: Event) => started.push((event as CustomEvent<StartTranscriptionDetail>).detail);

function store() {
  return useRecordingsStore.getState();
}
function bundle(nameIncludes: string) {
  const found = store().bundles.find((b) => b.name.includes(nameIncludes));
  if (!found) throw new Error(`no bundle ${nameIncludes}`);
  return found;
}
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(() => {
  __resetRecordingsStoreMemory();
  disk = installFakeDisk();
  started.length = 0;
  window.addEventListener(START_TRANSCRIPTION_EVENT, onStart);
  useRecordingsStore.setState({ open: false, dir: null, bundles: [], error: null, loading: false, imports: [], rootOverride: null });
  useActivityStore.setState({ tasks: [] });
  useInboxStore.setState({ open: false });
  useSettingsStore.setState({ notesRootPath: '~/Notesage', homeDir: '/Users/peter', icloudNotesagePath: null });
});

afterEach(() => {
  window.removeEventListener(START_TRANSCRIPTION_EVENT, onStart);
  vi.useRealTimers();
});

// ===========================================================================
// S4 — the cost of listing
// ===========================================================================

describe('load — cost (S4)', () => {
  it('one listing one level deep, then one read per bundle, and no existence checks', async () => {
    for (let i = 1; i <= 5; i++) {
      addBundle(disk, `Recording 2026-09-0${i} 09-00-00`, {
        manifest: { transcript: { file: 'Weekly.md' }, transcription: { status: 'done', device: 'This Mac', updatedAt: iso(0) } },
        files: { 'Weekly.md': '# Weekly\n', 'segments.json': '{}' },
      });
    }
    await store().load();

    expect(store().bundles).toHaveLength(5);
    expect(disk.calls.filter((c) => c.cmd === 'list_directory').map((c) => c.args)).toEqual([
      { path: RECORDINGS_DIR, showHidden: false, maxDepth: 1 },
    ]);
    expect(disk.count('read_file')).toBe(5);
    expect(disk.count('path_exists')).toBe(0);
    expect(disk.count('file_size')).toBe(0);
    // A transcribed recording's audio is not even looked at.
    expect(disk.count('audio_file_status')).toBe(0);
    expect(disk.count('get_device_name')).toBe(1);
  });

  it('looks at the audio only of recordings that are not transcribed yet, and reads speakers.json only where there is one', async () => {
    addBundle(disk, 'Recording 2026-09-01 09-00-00');
    addBundle(disk, 'Recording 2026-09-02 09-00-00', { files: { 'transcript.md': '# T\n' } });
    addBundle(disk, 'Recording 2026-09-03 09-00-00', {
      files: { 'transcript.md': '# T\n', 'speakers.json': JSON.stringify({ version: 1, names: { me: 'Peter', others: 'Anna' } }) },
    });
    await store().load();
    expect(disk.count('audio_file_status')).toBe(1);
    // Three manifests and one speakers file.
    expect(disk.count('read_file')).toBe(4);
    expect(bundle('09-03').speakers).toEqual(['Peter', 'Anna']);
  });

  it('asks for the device name once, however often the list is reloaded', async () => {
    addBundle(disk, 'Recording 2026-09-01 09-00-00');
    await store().load();
    await store().load();
    await store().load();
    expect(disk.count('get_device_name')).toBe(1);
  });
});

// ===========================================================================
// What a bundle honestly is
// ===========================================================================

describe('load — status', () => {
  it('describes a recording: title, date, length, size, source, language', async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { title: 'Weekly sync', language: 'sv', createdBy: { device: "Peter's iPhone", app: 'notesage-ios', appVersion: '0.60.0' } },
    });
    await store().load();
    expect(store().bundles[0]).toMatchObject({
      name: 'Recording 2026-09-05 14-02-11',
      title: 'Weekly sync',
      hasManifest: true,
      status: 'not-transcribed',
      startedAt: '2026-09-05T14:02:11+02:00',
      durationSecs: 4503,
      sizeBytes: 34_000_000,
      source: 'microphone',
      language: 'sv',
      device: "Peter's iPhone",
      audioPath: `${RECORDINGS_DIR}/Recording 2026-09-05 14-02-11/audio.m4a`,
      transcriptPath: null,
      speakers: [],
    });
  });

  it('a recording made on this Mac carries no "from" caption', async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11');
    await store().load();
    expect(store().bundles[0].device).toBeNull();
  });

  it('finds the transcript the manifest names, and the legacy transcript.md', async () => {
    const named = addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcript: { file: 'Weekly sync.md' } },
      files: { 'Weekly sync.md': '# Weekly sync\n' },
    });
    const legacy = addBundle(disk, 'Recording 2026-09-04 14-02-11', { files: { 'transcript.md': '# T\n' } });
    await store().load();
    expect(bundle('09-05')).toMatchObject({ status: 'done', transcriptPath: `${named}/Weekly sync.md` });
    expect(bundle('09-04')).toMatchObject({ status: 'done', transcriptPath: `${legacy}/transcript.md` });
  });

  it('a transcript the manifest names but that is not there is not "done"', async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcript: { file: 'Gone.md' }, transcription: { status: 'done', device: 'This Mac', updatedAt: iso(0) } },
    });
    await store().load();
    expect(store().bundles[0]).toMatchObject({ status: 'not-transcribed', transcriptPath: null });
  });

  // U11: the leftover of a quit before the manifest was written.
  it('lists a bundle with audio and no manifest as not transcribed, with what the folder can tell', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', { manifest: null, audio: 'audio.wav' });
    disk.sizes.set(`${dir}/audio.wav`, 345_600_000);
    await store().load();
    expect(store().bundles[0]).toMatchObject({
      hasManifest: false,
      status: 'not-transcribed',
      title: 'Recording 2026-09-05 14-02-11',
      audioPath: `${dir}/audio.wav`,
      sizeBytes: 345_600_000,
      durationSecs: null,
      source: null,
    });
    // The date comes from the folder's stamp.
    expect(Date.parse(store().bundles[0].startedAt!)).toBe(new Date(2026, 8, 5, 14, 2, 11).getTime());
  });

  it('lists imports (folders named "Import …") and ignores folders that are not recordings', async () => {
    addBundle(disk, 'Import Weekly sync 2026-11-25 101500', {
      manifest: { source: 'import', title: 'Weekly sync', originalFile: { name: 'Weekly sync.mp4', path: '/Users/p/Downloads/Weekly sync.mp4' } },
    });
    disk.dirs.add(`${RECORDINGS_DIR}/Random folder`);
    disk.files.set(`${RECORDINGS_DIR}/Random folder/notes.txt`, 'x');
    disk.files.set(`${RECORDINGS_DIR}/stray.txt`, 'x');
    await store().load();
    expect(store().bundles).toHaveLength(1);
    expect(store().bundles[0]).toMatchObject({ source: 'import', originalName: 'Weekly sync.mp4', title: 'Weekly sync' });
  });

  it('shows a failure with its reason, and counts it for the sidebar badge', async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcription: { status: 'failed', device: 'This Mac', updatedAt: iso(0), error: 'Whisper model not found' } },
    });
    addBundle(disk, 'Recording 2026-09-04 14-02-11');
    await store().load();
    expect(bundle('09-05')).toMatchObject({ status: 'failed', error: 'Whisper model not found' });
    expect(store().failedCount()).toBe(1);
  });

  // U17: the manifest said `running` for ever after a quit mid-transcription.
  it("does not show this Mac's own dead claim as running", async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcription: { status: 'running', device: 'This Mac', updatedAt: iso(5 * 60_000) } },
    });
    await store().load();
    expect(store().bundles[0]).toMatchObject({ status: 'failed', error: 'interrupted' });
  });

  it("shows another device's fresh claim as running there, and a stale one as not transcribed", async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcription: { status: 'running', device: "Peter's iMac", updatedAt: iso(5 * 60_000) } },
    });
    addBundle(disk, 'Recording 2026-09-04 14-02-11', {
      manifest: { transcription: { status: 'running', device: "Peter's iMac", updatedAt: iso(3 * 60 * 60_000) } },
    });
    await store().load();
    expect(bundle('09-05')).toMatchObject({ status: 'running', transcribedOn: "Peter's iMac" });
    expect(bundle('09-04').status).toBe('not-transcribed');
  });

  // U28: evicted / still-syncing audio was labelled "Waiting to be transcribed".
  it('shows audio that is not on this disk as downloading, and asks iCloud for it once', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11');
    disk.notLocal.add(`${dir}/audio.m4a`);
    await store().load();
    expect(store().bundles[0].status).toBe('downloading');
    expect(disk.calls.filter((c) => c.cmd === 'icloud_ensure_downloaded').map((c) => c.args)).toEqual([
      { path: `${dir}/audio.m4a` },
    ]);
    await store().load();
    await store().load();
    expect(disk.count('icloud_ensure_downloaded')).toBe(1);

    // It arrives.
    disk.notLocal.clear();
    await store().load();
    expect(store().bundles[0].status).toBe('not-transcribed');
  });

  it('audio that has not arrived at all is downloading too', async () => {
    addBundle(disk, 'Recording 2026-09-05 14-02-11', { audio: null });
    await store().load();
    expect(store().bundles[0].status).toBe('downloading');
  });

  it('sorts newest first', async () => {
    addBundle(disk, 'Recording 2026-09-01 09-00-00', { manifest: { startedAt: '2026-09-01T09:00:00+02:00' } });
    addBundle(disk, 'Recording 2026-09-03 09-00-00', { manifest: { startedAt: '2026-09-03T09:00:00+02:00' } });
    addBundle(disk, 'Recording 2026-09-02 09-00-00', { manifest: { startedAt: '2026-09-02T09:00:00+02:00' } });
    await store().load();
    expect(store().bundles.map((b) => b.name.slice(10, 20))).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });

  it('a missing Recordings folder is an empty list; a folder that cannot be read is an error', async () => {
    disk.dirs.clear();
    await store().load();
    expect(store()).toMatchObject({ bundles: [], error: null });

    setMockInvokeHandler('list_directory', () => {
      throw new Error('Operation not permitted');
    });
    setMockInvokeHandler('path_exists', () => true);
    await store().load();
    expect(store().error).toContain('Operation not permitted');
  });
});

// ===========================================================================
// U15 — the list keeps itself current
// ===========================================================================

describe('refresh (U15)', () => {
  beforeEach(async () => {
    addBundle(disk, 'Recording 2026-09-01 09-00-00');
    await store().load();
    vi.useFakeTimers();
    disk.resetCalls();
  });

  async function settle() {
    await vi.advanceTimersByTimeAsync(RECORDINGS_REFRESH_DEBOUNCE_MS + 50);
    vi.useRealTimers();
    await vi.waitFor(() => expect(store().loading).toBe(false));
  }

  it('reloads on a watcher batch under the Recordings folder, once per burst', async () => {
    addBundle(disk, 'Recording 2026-09-02 09-00-00');
    for (let i = 0; i < 12; i++) {
      emitMockEvent('file-changed-batch', [
        { path: `${RECORDINGS_DIR}/Recording 2026-09-02 09-00-00/audio.m4a`, kind: 'modify' },
      ]);
    }
    expect(disk.count('list_directory')).toBe(0); // debounced
    await settle();
    expect(disk.count('list_directory')).toBe(1);
    expect(store().bundles).toHaveLength(2);
  });

  it('ignores watcher batches about anything else', async () => {
    emitMockEvent('file-changed-batch', [
      { path: '/Users/peter/Notesage/Projects/a.md', kind: 'modify' },
      { path: '/Users/peter/Notesage/RecordingsOther/x', kind: 'create' },
    ]);
    await settle();
    expect(disk.count('list_directory')).toBe(0);
  });

  it('reloads when a transcription job starts, finishes, fails or is cancelled, but not on its progress', async () => {
    const audio = `${RECORDINGS_DIR}/Recording 2026-09-01 09-00-00/audio.m4a`;
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'r', audioPath: audio });
    await vi.advanceTimersByTimeAsync(RECORDINGS_REFRESH_DEBOUNCE_MS + 50);
    await vi.waitFor(() => expect(disk.count('list_directory')).toBe(1));

    // A hundred progress events: not one more listing.
    for (let p = 1; p <= 100; p++) useActivityStore.getState().setTranscriptionProgress('tx-1', p, 'transcribing');
    await vi.advanceTimersByTimeAsync(RECORDINGS_REFRESH_DEBOUNCE_MS + 50);
    expect(disk.count('list_directory')).toBe(1);

    useActivityStore.getState().setTranscriptionDone('tx-1', `${RECORDINGS_DIR}/Recording 2026-09-01 09-00-00/t.md`);
    await vi.advanceTimersByTimeAsync(RECORDINGS_REFRESH_DEBOUNCE_MS + 50);
    await vi.waitFor(() => expect(disk.count('list_directory')).toBe(2));
  });

  it('refresh() coalesces: many calls, one reload', async () => {
    for (let i = 0; i < 20; i++) store().refresh();
    await settle();
    expect(disk.count('list_directory')).toBe(1);
  });
});

// ===========================================================================
// U1 — leaving the view
// ===========================================================================

describe('open / close (U1)', () => {
  it('opening closes the Inbox, and opening the Inbox closes this', () => {
    useInboxStore.setState({ open: true });
    store().openRecordings();
    expect(store().open).toBe(true);
    expect(useInboxStore.getState().open).toBe(false);
    useInboxStore.setState({ open: true });
    expect(store().open).toBe(false);
  });

  it('toggle opens and closes (the sidebar row, clicked again)', () => {
    store().toggleRecordings();
    expect(store().open).toBe(true);
    store().toggleRecordings();
    expect(store().open).toBe(false);
  });

  it('any document becoming active leaves the view: a new note, the command bar, a wikilink', () => {
    store().openRecordings();
    useEditorStore.setState({ activeTabId: 'tab-new-note' });
    expect(store().open).toBe(false);
  });

  it('a state change that is not a change of document leaves it open', () => {
    useEditorStore.setState({ activeTabId: 'tab-1' });
    store().openRecordings();
    useEditorStore.setState({ activeTabId: 'tab-1' });
    expect(store().open).toBe(true);
    // Typing in the document behind the list (it cannot be seen, but an
    // agent can still write to it) is not "opening a document" either.
    useEditorStore.setState({ openDocuments: [...useEditorStore.getState().openDocuments] });
    expect(store().open).toBe(true);
  });

  // The sidebar's Projects section calls `openTab` itself, without going
  // through `useFileOperations.openFile`. Re-opening the file that was already
  // active behind the list changed no `activeTabId`, and the list stayed.
  it('re-opening the document that is already active leaves the view, whoever calls openTab', () => {
    useEditorStore.setState({ openDocuments: [], activeTabId: null, documentAccessOrder: [] });
    useEditorStore.getState().openTab('/lib/note.md', 'note.md', '# Note', null, 'markdown');
    const active = useEditorStore.getState().activeTabId;
    store().openRecordings();
    expect(store().open).toBe(true);

    useEditorStore.getState().openTab('/lib/note.md', 'note.md', '# Note', null, 'markdown');

    expect(useEditorStore.getState().activeTabId).toBe(active);
    expect(store().open).toBe(false);
  });

  it('closing when already closed notifies nobody', () => {
    const listener = vi.fn();
    const unsubscribe = useRecordingsStore.subscribe(listener);
    store().closeRecordings();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Row actions
// ===========================================================================

describe('transcribe', () => {
  it('dispatches one job with what the manifest knows, and the chosen model and language', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', { manifest: { title: 'Weekly sync', language: 'sv' } });
    await store().load();
    await store().transcribe(dir, { model: 'large-v3', language: 'en', mode: 'replace' });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      audioPath: `${dir}/audio.m4a`,
      model: 'large-v3',
      language: 'en',
      transcriptMode: 'replace',
      title: 'Weekly sync',
      recordingDurationSecs: 4503,
      recordingStartedAt: Date.parse('2026-09-05T14:02:11+02:00'),
    });
  });

  it('reuses the recording\'s language when none is picked, and passes both tracks of a two-track recording', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: {
        language: 'sv',
        source: 'both',
        tracks: [
          { role: 'mix', file: 'audio.m4a' },
          { role: 'mic', file: 'mic.m4a' },
          { role: 'system', file: 'system.m4a' },
        ],
      },
    });
    await store().load();
    await store().transcribe(dir);
    expect(started[0]).toMatchObject({
      language: 'sv',
      tracks: [
        { role: 'mic', path: `${dir}/mic.m4a` },
        { role: 'system', path: `${dir}/system.m4a` },
      ],
    });
    expect(started[0].model).toBeUndefined();
  });

  // U11: the orphan row's Transcribe probes the audio, writes a manifest, starts a job.
  it('adopts a bundle with no manifest first', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', { manifest: null, audio: 'audio.wav' });
    await store().load();
    await store().transcribe(dir);

    const manifest = parseRecordingManifest(disk.files.get(`${dir}/recording.json`) ?? '');
    expect(manifest).toMatchObject({ source: 'microphone', audio: { file: 'audio.wav', codec: 'pcm' }, transcription: null });
    expect(started).toEqual([expect.objectContaining({ audioPath: `${dir}/audio.wav` })]);
    // Length unknown until something decodes the file.
    expect(started[0].recordingDurationSecs).toBeUndefined();
  });

  it('rejects, starting nothing, for a folder with no audio', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', { manifest: null, audio: null });
    await store().load();
    await expect(store().transcribe(dir)).rejects.toThrow();
    expect(started).toHaveLength(0);
  });
});

describe('rename (U21)', () => {
  it('sets the title, reloads the list, and renames the job\'s card', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11');
    await store().load();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'Recording 2026-09-05 14-02-11', audioPath: `${dir}/audio.m4a` });

    await store().rename(dir, 'Weekly sync');

    expect(store().bundles[0]).toMatchObject({ title: 'Weekly sync', name: 'Recording 2026-09-05 14-02-11' });
    expect(useActivityStore.getState().tasks[0].label).toBe('Weekly sync');
    // The folder did not move.
    expect(store().bundles[0].dir).toBe(dir);
  });
});

describe('remove (U27)', () => {
  it('moves the bundle to the Trash (not a permanent delete) and drops its card', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', { files: { 'transcript.md': '# T\n' } });
    await store().load();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'r', audioPath: `${dir}/audio.m4a` });
    useActivityStore.getState().setTranscriptionDone('tx-1', `${dir}/transcript.md`);

    await store().remove(dir);

    expect(disk.calls.filter((c) => c.cmd === 'trash_path').map((c) => c.args)).toEqual([{ path: dir }]);
    expect(disk.count('delete_path')).toBe(0);
    expect(store().bundles).toHaveLength(0);
    expect(useActivityStore.getState().tasks).toHaveLength(0);
  });

  it('refuses while the recording is being transcribed', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11');
    await store().load();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'r', audioPath: `${dir}/audio.m4a` });
    await expect(store().remove(dir)).rejects.toThrow(/being transcribed/);
    expect(disk.count('trash_path')).toBe(0);
    expect(store().bundles).toHaveLength(1);
  });
});

describe('moveToProject (U29)', () => {
  it("moves the folder and repoints the job's card at the new place", async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11', {
      manifest: { transcript: { file: 'Weekly sync.md' } },
      files: { 'Weekly sync.md': '# W\n' },
    });
    await store().load();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'r', audioPath: `${dir}/audio.m4a` });
    useActivityStore.getState().setTranscriptionDone('tx-1', `${dir}/Weekly sync.md`);

    await store().moveToProject(dir, '/Users/peter/Code/acme');

    const moved = '/Users/peter/Code/acme/Recording 2026-09-05 14-02-11';
    expect(disk.files.has(`${moved}/audio.m4a`)).toBe(true);
    expect(useActivityStore.getState().tasks[0]).toMatchObject({
      moved: true,
      audioPath: `${moved}/audio.m4a`,
      transcriptPath: `${moved}/Weekly sync.md`,
    });
    expect(store().bundles).toHaveLength(0);
  });

  it('refuses while the recording is being transcribed, and moves nothing', async () => {
    const dir = addBundle(disk, 'Recording 2026-09-05 14-02-11');
    await store().load();
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'r', audioPath: `${dir}/audio.m4a` });
    await expect(store().moveToProject(dir, '/Users/peter/Code/acme')).rejects.toThrow(/being transcribed/);
    expect(disk.count('rename_path')).toBe(0);
    expect(disk.files.has(`${dir}/audio.m4a`)).toBe(true);
  });
});

// ===========================================================================
// N2 — import
// ===========================================================================

describe('importFile (N2)', () => {
  const SOURCE = '/Users/peter/Downloads/Weekly sync.mp4';

  it('extracts into the Recordings folder, writes the manifest, lists it and starts the transcription', async () => {
    await store().load();
    await store().importFile(SOURCE);

    expect(disk.calls.filter((c) => c.cmd === 'import_media').map((c) => c.args)).toEqual([
      { sourcePath: SOURCE, destRecordingsDir: RECORDINGS_DIR },
    ]);
    const dir = `${RECORDINGS_DIR}/Import Weekly sync 2026-11-25 101500`;
    expect(parseRecordingManifest(disk.files.get(`${dir}/recording.json`) ?? '')).toMatchObject({
      source: 'import',
      title: 'Weekly sync',
      durationSecs: 95,
      originalFile: { name: 'Weekly sync.mp4', path: SOURCE },
      audio: { file: 'audio.m4a', bytes: 2_400_000, codec: 'aac' },
      transcription: null,
    });
    // The video itself was not copied.
    expect([...disk.files.keys()].some((p) => p.startsWith(RECORDINGS_DIR) && p.endsWith('.mp4'))).toBe(false);
    expect(store().bundles[0]).toMatchObject({ source: 'import', originalName: 'Weekly sync.mp4', title: 'Weekly sync' });
    expect(started).toEqual([expect.objectContaining({ audioPath: `${dir}/audio.m4a`, title: 'Weekly sync' })]);
    expect(store().imports).toEqual([]);
  });

  it('shows the import while it runs, with integer progress, and ignores repeats of one percent', async () => {
    await store().load();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    setMockInvokeHandler('import_media', async () => {
      await gate;
      throw new Error('No audio track found in Weekly sync.mp4');
    });

    const running = store().importFile(SOURCE);
    await vi.waitFor(() => expect(store().imports).toEqual([{ sourcePath: SOURCE, name: 'Weekly sync.mp4', percent: null }]));

    const listener = vi.fn();
    const unsubscribe = useRecordingsStore.subscribe(listener);
    emitMockEvent('import-progress', { source_path: SOURCE, percent: 41.6 });
    emitMockEvent('import-progress', { source_path: SOURCE, percent: 42 });
    emitMockEvent('import-progress', { source_path: SOURCE, percent: 42 });
    emitMockEvent('import-progress', { source_path: '/other.mp4', percent: 99 });
    unsubscribe();
    expect(store().imports[0].percent).toBe(42);
    expect(listener).toHaveBeenCalledTimes(1);

    // A failure is passed on as the backend worded it, and the row goes away.
    release();
    await expect(running).rejects.toThrow('No audio track found in Weekly sync.mp4');
    expect(store().imports).toEqual([]);
    expect(started).toHaveLength(0);
  });

  it('a second import of the same file while one runs is ignored', async () => {
    await store().load();
    let release!: (v: unknown) => void;
    const gate = new Promise((resolve) => (release = resolve));
    const calls: unknown[] = [];
    setMockInvokeHandler('import_media', async (args) => {
      calls.push(args);
      await gate;
      throw new Error('Import cancelled');
    });
    const first = store().importFile(SOURCE);
    await store().importFile(SOURCE);
    expect(calls).toHaveLength(1);

    // Cancel goes to the backend by source path; the user's own cancel is not an error.
    await store().cancelImport(SOURCE);
    expect(disk.calls.filter((c) => c.cmd === 'cancel_transcription').map((c) => c.args)).toEqual([
      { jobId: null, audioPath: SOURCE },
    ]);
    release(null);
    await expect(first).resolves.toBeUndefined();
    expect(store().imports).toEqual([]);
  });

  it('knows which files can be imported', () => {
    for (const name of ['a.mp4', 'b.MOV', 'c.m4a', 'd.mp3', 'e.wav', 'f.flac']) expect(isImportableFile(name)).toBe(true);
    // The backend cannot read WebM or Matroska: not offered, and named as such when dropped.
    for (const name of ['f.webm', 'g.mkv']) {
      expect(isImportableFile(name)).toBe(false);
      expect(isUnsupportedContainer(name)).toBe(true);
    }
    expect(isUnsupportedContainer('a.mp4')).toBe(false);
    for (const name of ['notes.md', 'slides.pptx', 'noextension', 'archive.mp4.zip']) expect(isImportableFile(name)).toBe(false);
  });
});
