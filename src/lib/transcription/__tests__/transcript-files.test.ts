// @vitest-environment jsdom
//
// The disk side of transcripts: what gets written where, what is never
// overwritten without being asked, and what opening an old bundle costs.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '@/test/tauri-mock';
import { RECORDINGS_DIR, addBundle, installFakeDisk, type FakeDisk } from '@/test/fake-recordings-disk';
import { parseFrontmatter } from '@/lib/frontmatter';
import { parseRecordingManifest } from '@/lib/transcription/manifest';
import { readRecordingManifest, updateRecordingManifest } from '@/lib/transcription/bundle';
import { renderTranscript } from '@/lib/transcription/render-transcript';
import { hashTranscript, parseSegmentsFile, type Segment } from '@/lib/transcription/segments';
import { parseTeamsVtt } from '@/lib/transcription/teams-transcript';
import {
  adoptOrphanBundle,
  attachTeamsTranscript,
  inspectTranscript,
  readSegments,
  readTeamsTranscript,
  renameRecording,
  renameSpeakers,
  replaceNamesInTranscript,
  startFromBundleName,
  writeTranscript,
} from '@/lib/transcription/transcript-files';

const FIXTURES = join(__dirname, 'fixtures');
const VTT = readFileSync(join(FIXTURES, 'teams-meeting.vtt'), 'utf8');
const OURS: Segment[] = parseSegmentsFile(readFileSync(join(FIXTURES, 'teams-meeting.segments.json'), 'utf8'))!;

const NAME = 'Recording 2026-09-05 14-02-11';
const TWO_TRACK: Segment[] = [
  { start: 1, end: 5, text: 'Shall we start?', speaker: 'me' },
  { start: 6, end: 9, text: 'Yes, go ahead.', speaker: 'others' },
];

let disk: FakeDisk;
let dir: string;

function manifestOnDisk() {
  return parseRecordingManifest(disk.files.get(`${dir}/recording.json`) ?? '')!;
}
function writesTo(path: string): number {
  return disk.count('write_file', (a) => a.path === path);
}

beforeEach(() => {
  disk = installFakeDisk();
  dir = addBundle(disk, NAME);
});

describe('writeTranscript (U21, U23, U24)', () => {
  it('names a new transcript after the recording, writes the sidecar, and records both in the manifest', async () => {
    const written = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, language: 'en', model: 'small' });

    expect(written).toEqual({ path: `${dir}/${NAME}.md`, file: `${NAME}.md`, keptBoth: false });
    expect(disk.files.has(`${dir}/transcript.md`)).toBe(false);
    expect(parseSegmentsFile(disk.files.get(`${dir}/segments.json`)!)).toEqual(TWO_TRACK);

    const note = disk.files.get(written.path)!;
    const { frontmatter, content } = parseFrontmatter(note);
    expect(frontmatter).toMatchObject({
      type: 'meeting-transcript',
      title: NAME,
      date: '2026-09-05T14:02:11+02:00',
      duration: '1:15:03',
      language: 'en',
      model: 'small',
      source: 'microphone',
      speakers: ['Me', 'Others'],
    });
    expect(frontmatter).not.toHaveProperty('segments');
    expect(content).toBe(`# ${NAME}\n\n**Me** [00:00:01] Shall we start?\n\n**Others** [00:00:06] Yes, go ahead.\n`);

    expect(manifestOnDisk().transcript).toMatchObject({ file: `${NAME}.md`, hash: hashTranscript(note) });
  });

  it('uses the title the user gave the recording', async () => {
    await updateRecordingManifest(dir, (m) => ({ ...m, title: 'Weekly sync: Q3?' }));
    const written = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    expect(written.file).toBe('Weekly sync Q3.md');
    expect(parseFrontmatter(disk.files.get(written.path)!).frontmatter?.title).toBe('Weekly sync: Q3?');
  });

  it('never overwrites silently: with no answer from the user it writes a second file beside the first', async () => {
    const first = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    const original = disk.files.get(first.path)!;

    const second = await writeTranscript({ bundleDir: dir, segments: [{ start: 0, end: 1, text: 'Different.' }] });

    expect(second).toMatchObject({ file: `${NAME} (2).md`, keptBoth: true });
    expect(disk.files.get(first.path)).toBe(original);
    expect(disk.files.get(second.path)).toContain('Different.');
    // The manifest now points at the newest one.
    expect(manifestOnDisk().transcript?.file).toBe(`${NAME} (2).md`);
  });

  it('"Keep both" counts on: (2), then (3)', async () => {
    await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, mode: 'keep-both' });
    const third = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, mode: 'keep-both' });
    expect(third.file).toBe(`${NAME} (3).md`);
  });

  it('"Replace" overwrites the current transcript in place, keeping its file name', async () => {
    const first = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    const again = await writeTranscript({
      bundleDir: dir,
      segments: [{ start: 0, end: 1, text: 'Replaced.' }],
      mode: 'replace',
    });
    expect(again).toEqual({ path: first.path, file: first.file, keptBoth: false });
    expect(disk.files.get(first.path)).toContain('Replaced.');
    expect([...disk.files.keys()].filter((p) => p.endsWith('.md'))).toEqual([first.path]);
  });

  it('a legacy bundle: "Replace" keeps `transcript.md`; "Keep both" leaves it and adds the named file', async () => {
    disk.files.set(`${dir}/transcript.md`, '# Old\n\nold text\n');
    const kept = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, mode: 'keep-both' });
    expect(kept.file).toBe(`${NAME}.md`);
    expect(disk.files.get(`${dir}/transcript.md`)).toBe('# Old\n\nold text\n');

    const legacy = addBundle(disk, 'Recording 2026-09-06 09-00-00', { files: { 'transcript.md': '# Old\n' } });
    const replaced = await writeTranscript({ bundleDir: legacy, segments: TWO_TRACK, mode: 'replace' });
    expect(replaced.file).toBe('transcript.md');
    expect(disk.files.get(`${legacy}/transcript.md`)).toContain('Shall we start?');
  });

  it('fills in the length of a recording whose manifest did not know it', async () => {
    const orphan = addBundle(disk, 'Recording 2026-09-07 10-00-00', { manifest: { durationSecs: 0 } });
    await writeTranscript({ bundleDir: orphan, segments: TWO_TRACK, durationSecs: 612 });
    expect((await readRecordingManifest(orphan))?.durationSecs).toBe(612);
    // A known length is not replaced by the decoder's.
    await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, durationSecs: 1 });
    expect(manifestOnDisk().durationSecs).toBe(4503);
  });
});

describe('inspectTranscript', () => {
  it('knows whether a generated transcript has been edited since', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    expect((await inspectTranscript(dir))?.edited).toBe(false);

    // Opening and saving in the editor is not an edit…
    disk.files.set(path, disk.files.get(path)!.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace('---\n', '---\nid: abc\n'));
    expect((await inspectTranscript(dir))?.edited).toBe(false);

    // …changing the words is.
    disk.files.set(path, disk.files.get(path)!.replace('Shall we start?', 'Shall we begin?'));
    expect((await inspectTranscript(dir))?.edited).toBe(true);
  });

  it('cannot tell for a transcript from before the hash existed, and says so', async () => {
    disk.files.set(`${dir}/transcript.md`, '# Old\n');
    expect(await inspectTranscript(dir)).toMatchObject({ file: 'transcript.md', edited: null });
  });

  it('is null when there is no transcript', async () => {
    expect(await inspectTranscript(dir)).toBeNull();
  });
});

describe('legacy bundles (segments in the note\'s frontmatter)', () => {
  const legacySegments = [
    { start: 0, end: 2, text: 'First.', speaker_id: null, speaker_name: null },
    { start: 2.5, end: 5, text: 'Second.', speaker_id: null, speaker_name: null },
  ];

  it('reads the segments from the frontmatter when there is no segments.json', async () => {
    disk.files.set(`${dir}/transcript.md`, renderTranscript(legacySegments, { title: 'Old', durationSecs: 5 }));
    const result = await readSegments(dir);
    expect(result).toEqual({
      legacy: true,
      segments: [
        { start: 0, end: 2, text: 'First.' },
        { start: 2.5, end: 5, text: 'Second.' },
      ],
    });
  });

  // The contract: "never rewrite an old transcript just because it was opened".
  it('reading, inspecting and listing a legacy bundle writes nothing', async () => {
    const note = renderTranscript(legacySegments, { title: 'Old', durationSecs: 5 });
    disk.files.set(`${dir}/transcript.md`, note);
    disk.resetCalls();

    await readSegments(dir);
    await inspectTranscript(dir);
    await readRecordingManifest(dir);

    expect(disk.count('write_file')).toBe(0);
    expect(disk.files.get(`${dir}/transcript.md`)).toBe(note);
    expect(disk.files.has(`${dir}/segments.json`)).toBe(false);
  });

  it('prefers segments.json once there is one', async () => {
    disk.files.set(`${dir}/transcript.md`, renderTranscript(legacySegments, { title: 'Old' }));
    await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, mode: 'keep-both' });
    expect((await readSegments(dir)).segments).toEqual(TWO_TRACK);
  });
});

describe('renameSpeakers', () => {
  it('regenerates an untouched transcript from segments.json with the new names', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK, language: 'en', model: 'small' });

    const result = await renameSpeakers(dir, { me: 'Peter', others: 'Anna' });

    expect(result).toEqual({ rewritten: true, edited: false, transcriptPath: path });
    const note = disk.files.get(path)!;
    expect(note).toContain('**Peter** [00:00:01] Shall we start?');
    expect(note).toContain('**Anna** [00:00:06] Yes, go ahead.');
    // The rest of the frontmatter survives, and the speakers list follows.
    expect(parseFrontmatter(note).frontmatter).toMatchObject({ model: 'small', language: 'en', speakers: ['Peter', 'Anna'] });
    expect(JSON.parse(disk.files.get(`${dir}/speakers.json`)!)).toEqual({ version: 1, names: { me: 'Peter', others: 'Anna' } });
    // Still "unedited" afterwards, so the next rename regenerates too.
    expect((await inspectTranscript(dir))?.edited).toBe(false);
  });

  it('does NOT regenerate a transcript that was edited by hand, and says so', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    const edited = disk.files.get(path)!.replace('Shall we start?', 'Shall we start? (Peter looked at the clock.)');
    disk.files.set(path, edited);

    const result = await renameSpeakers(dir, { me: 'Peter' });

    expect(result).toEqual({ rewritten: false, edited: true, transcriptPath: path });
    expect(disk.files.get(path)).toBe(edited);
    // The names themselves are saved either way.
    expect(JSON.parse(disk.files.get(`${dir}/speakers.json`)!).names).toEqual({ me: 'Peter' });
  });

  it('"Update names in text" swaps names at turn starts only, even when two names trade places', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    disk.files.set(path, disk.files.get(path)!.replace('Yes, go ahead.', 'Yes, Me too. Others agree.'));

    const count = await replaceNamesInTranscript(dir, [
      { from: 'Me', to: 'Others' },
      { from: 'Others', to: 'Me' },
    ]);

    expect(count).toBe(2);
    const note = disk.files.get(path)!;
    expect(note).toContain('**Others** [00:00:01] Shall we start?');
    expect(note).toContain('**Me** [00:00:06] Yes, Me too. Others agree.');
  });

  it('writes nothing when no turn carries the old name', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    disk.resetCalls();
    expect(await replaceNamesInTranscript(dir, [{ from: 'Nobody', to: 'Someone' }])).toBe(0);
    expect(writesTo(path)).toBe(0);
  });

  it('saves names for a recording with no transcript yet', async () => {
    expect(await renameSpeakers(dir, { me: 'Peter' })).toEqual({ rewritten: false, edited: false, transcriptPath: null });
  });
});

describe('renameRecording (U21)', () => {
  it('stores the title in the manifest and leaves the folder alone', async () => {
    await renameRecording(dir, '  Weekly   sync ');
    expect(manifestOnDisk().title).toBe('Weekly sync');
    expect(disk.dirs.has(dir)).toBe(true);
    expect(disk.count('rename_path')).toBe(0);
  });

  it('renames an untouched transcript with it: file name, frontmatter title and heading', async () => {
    await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    const { transcriptPath } = await renameRecording(dir, 'Weekly sync');

    expect(transcriptPath).toBe(`${dir}/Weekly sync.md`);
    expect(disk.files.has(`${dir}/${NAME}.md`)).toBe(false);
    const note = disk.files.get(`${dir}/Weekly sync.md`)!;
    expect(parseFrontmatter(note).frontmatter?.title).toBe('Weekly sync');
    expect(note).toContain('# Weekly sync\n\n**Me** [00:00:01]');
    expect(manifestOnDisk().transcript).toMatchObject({ file: 'Weekly sync.md', hash: hashTranscript(note) });
  });

  it('renames an edited transcript\'s file but does not touch what is in it', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    const edited = disk.files.get(path)!.replace('Shall we start?', 'Shall we begin?');
    disk.files.set(path, edited);

    await renameRecording(dir, 'Weekly sync');

    expect(disk.files.get(`${dir}/Weekly sync.md`)).toBe(edited);
    expect(manifestOnDisk().transcript?.file).toBe('Weekly sync.md');
    expect((await inspectTranscript(dir))?.edited).toBe(true);
  });

  it('does not rename a transcript that is open in the editor, or the legacy transcript.md', async () => {
    const { path } = await writeTranscript({ bundleDir: dir, segments: TWO_TRACK });
    await renameRecording(dir, 'Weekly sync', { isOpen: (p) => p === path });
    expect(disk.files.has(path)).toBe(true);
    expect(disk.count('rename_path')).toBe(0);

    const legacy = addBundle(disk, 'Recording 2026-09-06 09-00-00', { files: { 'transcript.md': '# Old\n' } });
    await renameRecording(legacy, 'Old meeting');
    expect(disk.files.get(`${legacy}/transcript.md`)).toBe('# Old\n');
  });

  it('an empty title goes back to the folder name', async () => {
    await renameRecording(dir, 'Weekly sync');
    await renameRecording(dir, '   ');
    expect(manifestOnDisk().title).toBeUndefined();
  });

  it('refuses a bundle with no manifest', async () => {
    const orphan = addBundle(disk, 'Recording 2026-09-08 08-00-00', { manifest: null, audio: 'audio.wav' });
    await expect(renameRecording(orphan, 'X')).rejects.toThrow();
  });
});

describe('adoptOrphanBundle (U11)', () => {
  it('writes a manifest for a bundle that has audio and none, from the file and the folder name', async () => {
    const orphan = addBundle(disk, 'Recording 2026-09-08 08-15-30', { manifest: null, audio: 'audio.wav' });
    disk.sizes.set(`${orphan}/audio.wav`, 345_600_000);

    const { manifest, audioPath } = await adoptOrphanBundle(orphan);

    expect(audioPath).toBe(`${orphan}/audio.wav`);
    expect(manifest).toMatchObject({
      version: 1,
      source: 'microphone',
      durationSecs: 0,
      audio: { file: 'audio.wav', bytes: 345_600_000, codec: 'pcm' },
      transcription: null,
    });
    expect(Date.parse(manifest.startedAt)).toBe(new Date(2026, 8, 8, 8, 15, 30).getTime());
    expect(await readRecordingManifest(orphan)).toEqual(manifest);
  });

  it('recognises the two tracks of a microphone + system-audio recording', async () => {
    const orphan = addBundle(disk, 'Recording 2026-09-08 09-00-00', {
      manifest: null,
      audio: 'audio.m4a',
      files: { 'mic.m4a': '<mic>', 'system.m4a': '<sys>' },
    });
    const { manifest } = await adoptOrphanBundle(orphan);
    expect(manifest.source).toBe('both');
    expect(manifest.tracks).toEqual([
      { role: 'mic', file: 'mic.m4a' },
      { role: 'system', file: 'system.m4a' },
    ]);
    expect(manifest.audio.codec).toBe('aac');
  });

  it('refuses a folder with no audio, or audio that is not on this disk yet, and writes nothing', async () => {
    const empty = addBundle(disk, 'Recording 2026-09-08 10-00-00', { manifest: null, audio: null, files: { 'notes.txt': 'x' } });
    await expect(adoptOrphanBundle(empty)).rejects.toThrow(/no audio/i);

    const evicted = addBundle(disk, 'Recording 2026-09-08 11-00-00', { manifest: null, audio: 'audio.m4a' });
    disk.notLocal.add(`${evicted}/audio.m4a`);
    await expect(adoptOrphanBundle(evicted)).rejects.toThrow(/iCloud/);
    expect(disk.files.has(`${evicted}/recording.json`)).toBe(false);
  });

  it('startFromBundleName reads the stamp both recorders write', () => {
    expect(startFromBundleName('Recording 2026-09-05 14-02-11')).toBe(new Date(2026, 8, 5, 14, 2, 11).getTime());
    expect(startFromBundleName('Import Weekly sync 2026-11-25 101500')).toBe(new Date(2026, 10, 25, 10, 15, 0).getTime());
    expect(startFromBundleName('Some folder')).toBeNull();
  });
});

describe('attachTeamsTranscript (N3)', () => {
  const SOURCE = '/Users/peter/Downloads/Weekly sync.vtt';

  beforeEach(async () => {
    disk.files.set(SOURCE, VTT);
    await writeTranscript({ bundleDir: dir, segments: OURS, language: 'sv', model: 'large-v3-turbo-q5_0' });
  });

  it('keeps our text and adds Teams\' speaker names, keeping the original file in the bundle', async () => {
    const cues = await readTeamsTranscript(SOURCE);
    const written = await attachTeamsTranscript({ bundleDir: dir, sourcePath: SOURCE, cues, offsetSecs: 37, use: 'names', mode: 'replace' });

    expect(disk.files.get(`${dir}/teams-transcript.vtt`)).toBe(VTT);
    const note = disk.files.get(written.path)!;
    expect(note).toContain('**Anna Svensson** [00:01:00] Okej då har jag startat transkriberingen också');
    expect(note).toContain('**Peter Lindberg** [00:01:31] Sure, about 80 percent of the documents have been migrated.');
    expect(note).toContain('**James Carter** [00:01:36] Great, and the remaining 20 percent');
    // Our words, not Teams' ("80 procent", not "åttio procent").
    expect(note).toContain('ungefär 80 procent');
    expect(note).not.toContain('åttio');
    expect(parseFrontmatter(note).frontmatter).toMatchObject({
      speakers: ['Anna Svensson', 'Peter Lindberg', 'James Carter'],
      model: 'large-v3-turbo-q5_0',
    });

    const segments = parseSegmentsFile(disk.files.get(`${dir}/segments.json`)!)!;
    expect(segments.filter((s) => s.speaker).length).toBeGreaterThan(10);
    expect(JSON.parse(disk.files.get(`${dir}/speakers.json`)!).names).toEqual({
      'Anna Svensson': 'Anna Svensson',
      'Peter Lindberg': 'Peter Lindberg',
      'James Carter': 'James Carter',
    });
  });

  it('"Use Teams\' text" writes the cues themselves, on our clock', async () => {
    const cues = parseTeamsVtt(VTT);
    const written = await attachTeamsTranscript({ bundleDir: dir, sourcePath: SOURCE, cues, offsetSecs: 37, use: 'text', mode: 'replace' });
    const note = disk.files.get(written.path)!;
    expect(note).toContain('åttio procent');
    expect(note).toContain('**Anna Svensson** [00:01:00] Okej, då har jag startat transkriberingen också.');
    expect(parseFrontmatter(note).frontmatter?.model).toBe('Microsoft Teams');
  });

  it('follows the same overwrite rule: unasked, it writes beside the existing transcript', async () => {
    const before = disk.files.get(`${dir}/${NAME}.md`);
    const written = await attachTeamsTranscript({ bundleDir: dir, sourcePath: SOURCE, cues: parseTeamsVtt(VTT), offsetSecs: 37, use: 'names' });
    expect(written).toMatchObject({ file: `${NAME} (2).md`, keptBoth: true });
    expect(disk.files.get(`${dir}/${NAME}.md`)).toBe(before);
  });

  it('a recording we never transcribed can still take Teams\' text, even when names were asked for', async () => {
    const fresh = addBundle(disk, 'Recording 2026-09-09 09-00-00');
    const written = await attachTeamsTranscript({ bundleDir: fresh, sourcePath: SOURCE, cues: parseTeamsVtt(VTT), offsetSecs: 0, use: 'names' });
    expect(written.keptBoth).toBe(false);
    expect(disk.files.get(written.path)).toContain('**Peter Lindberg** [00:00:34] Tack Anna.');
  });

  it('keeps a name the user already gave a speaker', async () => {
    disk.files.set(`${dir}/speakers.json`, JSON.stringify({ version: 1, names: { 'Anna Svensson': 'Anna' } }));
    const written = await attachTeamsTranscript({ bundleDir: dir, sourcePath: SOURCE, cues: parseTeamsVtt(VTT), offsetSecs: 37, use: 'names', mode: 'replace' });
    expect(disk.files.get(written.path)).toContain('**Anna** [00:01:00]');
  });
});

describe('updateRecordingManifest', () => {
  it('serialises concurrent changes to one manifest, so neither undoes the other', async () => {
    await Promise.all([
      updateRecordingManifest(dir, (m) => ({ ...m, title: 'Weekly sync' })),
      updateRecordingManifest(dir, (m) => ({
        ...m,
        transcription: { status: 'done', device: 'This Mac', updatedAt: '2026-09-05T15:00:00+02:00' },
      })),
      updateRecordingManifest(dir, (m) => ({ ...m, autoTranscribe: false })),
    ]);
    expect(manifestOnDisk()).toMatchObject({
      title: 'Weekly sync',
      transcription: { status: 'done' },
      autoTranscribe: false,
    });
  });

  it('writes nothing when the change declines, and resolves null without a manifest', async () => {
    disk.resetCalls();
    await updateRecordingManifest(dir, () => null);
    expect(disk.count('write_file')).toBe(0);
    expect(await updateRecordingManifest(`${RECORDINGS_DIR}/Nowhere`, (m) => m)).toBeNull();
  });

  it('a failed write does not wedge the chain for the next one', async () => {
    await expect(
      updateRecordingManifest(dir, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await updateRecordingManifest(dir, (m) => ({ ...m, title: 'After' }));
    expect(manifestOnDisk().title).toBe('After');
  });
});
