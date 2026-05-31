// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import {
  dirname,
  basename,
  joinPath,
  transcriptPathForAudio,
  bundleTargetPath,
  writeTranscriptToBundle,
  moveBundleToProject,
  TRANSCRIPT_FILENAME,
} from '@/lib/transcription/bundle';

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
