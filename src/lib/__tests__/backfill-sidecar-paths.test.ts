/**
 * RED tests for backfillSidecarOriginalPaths (issue #117).
 *
 * The migration helper adds the `originalPath` field to path-keyed comment
 * sidecars that were created before this fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { backfillSidecarOriginalPaths } from '../backfill-sidecar-paths';
import { tauriApi } from '@/lib/tauri';

const mockedTauriApi = vi.mocked(tauriApi);

function computePathHash(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

function sidecarPath(notesRoot: string, filePath: string): string {
  return `${notesRoot}/.notesage/comments/${computePathHash(filePath)}.json`;
}

describe('backfillSidecarOriginalPaths', () => {
  const NOTES_ROOT = '/Users/test/Notesage';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds originalPath to a sidecar that lacks it', async () => {
    const filePath = '/Users/test/Notesage/notes/foo.md';
    const targetSidecar = sidecarPath(NOTES_ROOT, filePath);
    const existingComments = [{ id: 'c1', body: 'test' }];

    mockedTauriApi.pathExists.mockImplementation(async (p: string) => p === targetSidecar);
    mockedTauriApi.readFile.mockImplementation(async (p: string) => {
      if (p === targetSidecar) return JSON.stringify(existingComments);
      return '[]';
    });
    const writtenFiles: Array<{ path: string; content: string }> = [];
    mockedTauriApi.writeFile.mockImplementation(async (p: string, content: string) => {
      writtenFiles.push({ path: p, content });
    });

    await backfillSidecarOriginalPaths(NOTES_ROOT, [filePath]);

    const written = writtenFiles.find((w) => w.path === targetSidecar);
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!.content);
    expect(parsed.originalPath).toBe(filePath);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].id).toBe('c1');
  });

  it('is idempotent — leaves sidecar unchanged when originalPath already present', async () => {
    const filePath = '/Users/test/Notesage/notes/bar.md';
    const targetSidecar = sidecarPath(NOTES_ROOT, filePath);
    const existingData = { originalPath: filePath, comments: [{ id: 'c2' }] };

    mockedTauriApi.pathExists.mockImplementation(async (p: string) => p === targetSidecar);
    mockedTauriApi.readFile.mockResolvedValue(JSON.stringify(existingData));
    mockedTauriApi.writeFile.mockResolvedValue(undefined);

    await backfillSidecarOriginalPaths(NOTES_ROOT, [filePath]);

    expect(mockedTauriApi.writeFile).not.toHaveBeenCalled();
  });

  it('skips files that have no sidecar on disk', async () => {
    const filePath = '/Users/test/Notesage/notes/no-comments.md';
    mockedTauriApi.pathExists.mockResolvedValue(false);
    mockedTauriApi.writeFile.mockResolvedValue(undefined);

    await backfillSidecarOriginalPaths(NOTES_ROOT, [filePath]);

    expect(mockedTauriApi.writeFile).not.toHaveBeenCalled();
  });

  it('processes multiple files and only updates those missing originalPath', async () => {
    const fileA = '/Users/test/Notesage/notes/a.md';
    const fileB = '/Users/test/Notesage/notes/b.md';
    const sidecarA = sidecarPath(NOTES_ROOT, fileA);
    const sidecarB = sidecarPath(NOTES_ROOT, fileB);

    mockedTauriApi.pathExists.mockImplementation(async (p: string) => p === sidecarA || p === sidecarB);
    mockedTauriApi.readFile.mockImplementation(async (p: string) => {
      if (p === sidecarA) return JSON.stringify([{ id: 'c1' }]); // no originalPath
      if (p === sidecarB) return JSON.stringify({ originalPath: fileB, comments: [{ id: 'c2' }] });
      return '[]';
    });
    const writtenPaths: string[] = [];
    mockedTauriApi.writeFile.mockImplementation(async (p: string) => {
      writtenPaths.push(p);
    });

    await backfillSidecarOriginalPaths(NOTES_ROOT, [fileA, fileB]);

    // Only sidecarA was missing originalPath — only it should be written
    expect(writtenPaths).toContain(sidecarA);
    expect(writtenPaths).not.toContain(sidecarB);
  });
});
