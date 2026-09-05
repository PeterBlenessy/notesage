// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import {
  dirname,
  basename,
  joinPath,
  transcriptPathForAudio,
  manifestPathForAudio,
  bundleTargetPath,
  writeTranscriptToBundle,
  moveBundleToProject,
  readRecordingManifest,
  writeRecordingManifest,
  TRANSCRIPT_FILENAME,
} from '@/lib/transcription/bundle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecordingManifest } from '@/lib/transcription/manifest';

const AUDIO = '/Users/me/Notesage/Recordings/Meeting 2026-05-30 14-02/audio.wav';
const BUNDLE_DIR = '/Users/me/Notesage/Recordings/Meeting 2026-05-30 14-02';

describe('path derivation', () => {
  it('dirname returns the bundle folder of the audio file', () => {
    expect(dirname(AUDIO)).toBe(BUNDLE_DIR);
  });

  it('dirname ignores trailing slashes and handles root', () => {
    expect(dirname('/a/b/')).toBe('/a');
    expect(dirname('/a')).toBe('/');
    expect(dirname('a')).toBe('');
  });

  it('basename returns the final path component', () => {
    expect(basename(BUNDLE_DIR)).toBe('Meeting 2026-05-30 14-02');
    expect(basename(AUDIO)).toBe('audio.wav');
    expect(basename('/a/b/')).toBe('b');
  });

  it('joinPath collapses duplicate separators', () => {
    expect(joinPath('/a/', '/b/', 'c')).toBe('/a/b/c');
    expect(joinPath('/a', '', 'b')).toBe('/a/b');
  });

  it('transcriptPathForAudio puts transcript.md beside the audio', () => {
    expect(transcriptPathForAudio(AUDIO)).toBe(`${BUNDLE_DIR}/${TRANSCRIPT_FILENAME}`);
  });

  it('bundleTargetPath nests the bundle folder under the project root', () => {
    expect(bundleTargetPath(BUNDLE_DIR, '/Users/me/Projects/Acme')).toBe(
      '/Users/me/Projects/Acme/Meeting 2026-05-30 14-02',
    );
  });
});

describe('writeTranscriptToBundle', () => {
  it('writes transcript.md next to the audio and returns its path', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    setMockInvokeHandler('write_file', (args) => {
      writes.push({ path: args!.path as string, content: args!.content as string });
      return undefined;
    });

    const result = await writeTranscriptToBundle(AUDIO, '# Note\n');

    expect(result).toBe(`${BUNDLE_DIR}/transcript.md`);
    expect(writes).toEqual([{ path: `${BUNDLE_DIR}/transcript.md`, content: '# Note\n' }]);
  });
});

describe('moveBundleToProject', () => {
  it('renames the bundle into the project (atomic same-volume path)', async () => {
    const renames: Array<{ oldPath: string; newPath: string }> = [];
    setMockInvokeHandler('rename_path', (args) => {
      renames.push({ oldPath: args!.oldPath as string, newPath: args!.newPath as string });
      return undefined;
    });
    const copy = vi.fn(() => undefined);
    setMockInvokeHandler('copy_directory', copy);

    const target = await moveBundleToProject(BUNDLE_DIR, '/Users/me/Projects/Acme');

    expect(target).toBe('/Users/me/Projects/Acme/Meeting 2026-05-30 14-02');
    expect(renames).toEqual([{ oldPath: BUNDLE_DIR, newPath: target }]);
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back to copy + delete when rename fails (cross-volume)', async () => {
    setMockInvokeHandler('rename_path', () => {
      throw new Error('EXDEV: cross-device link');
    });
    const copies: Array<{ source: string; destination: string }> = [];
    setMockInvokeHandler('copy_directory', (args) => {
      copies.push({ source: args!.source as string, destination: args!.destination as string });
      return undefined;
    });
    const deletes: string[] = [];
    setMockInvokeHandler('delete_path', (args) => {
      deletes.push(args!.path as string);
      return undefined;
    });

    const target = await moveBundleToProject(BUNDLE_DIR, '/Volumes/Ext/Acme');

    expect(target).toBe('/Volumes/Ext/Acme/Meeting 2026-05-30 14-02');
    expect(copies).toEqual([{ source: BUNDLE_DIR, destination: target }]);
    expect(deletes).toEqual([BUNDLE_DIR]);
  });
});

// ---------------------------------------------------------------------------
// Container-agnostic paths (PRD 2026-09-05-ios-recordings, task #17): a
// phone bundle carries audio.m4a where the Mac's carries audio.wav, and every
// helper only ever takes dirname / basename of the audio path.
// ---------------------------------------------------------------------------

describe('phone bundles (audio.m4a)', () => {
  const M4A = '/lib/Recordings/Recording 2026-09-05 14-02-11/audio.m4a';
  const DIR = '/lib/Recordings/Recording 2026-09-05 14-02-11';
  const FIXTURE = readFileSync(join(__dirname, '../../../../tests/fixtures/recording-manifest.v1.json'), 'utf8');

  it('derives the transcript and manifest paths beside audio.m4a', () => {
    expect(transcriptPathForAudio(M4A)).toBe(`${DIR}/transcript.md`);
    expect(manifestPathForAudio(M4A)).toBe(`${DIR}/recording.json`);
    expect(manifestPathForAudio('/x/Recording 2026-05-30 14-02/audio.wav')).toBe('/x/Recording 2026-05-30 14-02/recording.json');
  });

  it('writes the transcript next to audio.m4a', async () => {
    const written: Array<{ path: string; content: string }> = [];
    setMockInvokeHandler('write_file', (args) => {
      written.push({ path: String(args?.path), content: String(args?.content) });
    });
    await expect(writeTranscriptToBundle(M4A, '# T')).resolves.toBe(`${DIR}/transcript.md`);
    expect(written).toEqual([{ path: `${DIR}/transcript.md`, content: '# T' }]);
  });

  it('moves the whole folder — audio, recording.json and transcript travel together', async () => {
    const renamed: Array<[string, string]> = [];
    setMockInvokeHandler('rename_path', (args) => {
      renamed.push([String(args?.oldPath), String(args?.newPath)]);
    });
    await expect(moveBundleToProject(DIR, '/Users/me/Code/acme')).resolves.toBe(
      '/Users/me/Code/acme/Recording 2026-09-05 14-02-11',
    );
    // One rename of the directory, never per-file.
    expect(renamed).toEqual([[DIR, '/Users/me/Code/acme/Recording 2026-09-05 14-02-11']]);
  });

  it('reads and writes recording.json in the contract form', async () => {
    const files = new Map<string, string>([[`${DIR}/recording.json`, FIXTURE]]);
    setMockInvokeHandler('read_file', (args) => {
      const p = String(args?.path);
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    });
    setMockInvokeHandler('write_file', (args) => {
      files.set(String(args?.path), String(args?.content));
    });
    const m = await readRecordingManifest(DIR);
    expect(m).toEqual(parseRecordingManifest(FIXTURE));
    await writeRecordingManifest(DIR, m!);
    expect(files.get(`${DIR}/recording.json`)).toBe(FIXTURE);
    // A bundle without a manifest (a pre-manifest Mac bundle) reads as null, not as an error.
    await expect(readRecordingManifest('/lib/Recordings/Recording 2026-05-30 09-00-00')).resolves.toBeNull();
    // As does a manifest that does not parse.
    files.set(`${DIR}/recording.json`, '{"version": 9}');
    await expect(readRecordingManifest(DIR)).resolves.toBeNull();
  });
});
