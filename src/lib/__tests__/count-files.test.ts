import { describe, it, expect } from 'vitest';
import { countFiles } from '@/lib/file-utils';
import type { FileEntry } from '@/lib/tauri';

function dir(name: string, children: FileEntry[]): FileEntry {
  return { name, path: `/${name}`, is_directory: true, children } as FileEntry;
}
function file(name: string): FileEntry {
  return { name, path: `/${name}`, is_directory: false } as FileEntry;
}

describe('countFiles', () => {
  it('counts files at the top level', () => {
    expect(countFiles([file('a.md'), file('b.md')])).toBe(2);
  });

  // The bug this exists to prevent: `[perf:startup] trees validated` reported
  // `explorerFolders.length + projects.length` under the name `totalFiles`,
  // so a launch with ~3,254 files logged 16 — and nothing noticed for three
  // releases, because a plausible small number reads like a real measurement.
  it('counts files nested inside directories, not the directories', () => {
    const tree = [
      file('top.md'),
      dir('docs', [file('one.md'), file('two.md'), dir('deep', [file('three.md')])]),
    ];
    expect(countFiles(tree)).toBe(4);
  });

  it('treats an empty or absent tree as zero rather than throwing', () => {
    expect(countFiles([])).toBe(0);
    expect(countFiles(undefined)).toBe(0);
  });

  it('does not count a directory that has no children array', () => {
    expect(countFiles([dir('empty', undefined as unknown as FileEntry[]), file('a.md')])).toBe(1);
  });
});
