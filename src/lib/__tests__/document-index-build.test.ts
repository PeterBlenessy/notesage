// @vitest-environment jsdom

/**
 * What a document-index build costs (performance review 2026-11, S-2).
 *
 * It used to read every markdown file in full, and rewrite
 * `.notesage/doc-index.json` in the (iCloud-synced) project, on every launch.
 * These tests pin the new cost: an unchanged project is no document reads and
 * no writes; a changed one reads only what changed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import '@/test/tauri-mock';

const { files } = vi.hoisted(() => ({
  /** The disk: absolute path → content. Directories are implied. */
  files: new Map<string, string>(),
}));

interface Entry {
  name: string;
  path: string;
  is_directory: boolean;
  hidden: boolean;
  children?: Entry[];
}

/** `list_directory(dir)`: recursive, hidden entries left out. */
function tree(dir: string): Entry[] {
  const names = new Set<string>();
  for (const path of files.keys()) {
    if (path.startsWith(dir + '/')) names.add(path.slice(dir.length + 1).split('/')[0]);
  }
  return [...names]
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const path = `${dir}/${name}`;
      const isDir = !files.has(path);
      return { name, path, is_directory: isDir, hidden: false, children: isDir ? tree(path) : undefined };
    });
}

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    listDirectory: vi.fn(async (dir: string) => tree(dir)),
    listFilesShallow: vi.fn(async (dir: string) => {
      const out: Entry[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(dir + '/') && !path.slice(dir.length + 1).includes('/')) {
          out.push({ name: path.slice(dir.length + 1), path, is_directory: false, hidden: false });
        }
      }
      if (out.length === 0) throw new Error(`Path does not exist: ${dir}`);
      return out;
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`No such file: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    pathExists: vi.fn(async (path: string) => {
      if (files.has(path)) return true;
      for (const p of files.keys()) if (p.startsWith(path + '/')) return true;
      return false;
    }),
    createDirectory: vi.fn(async () => undefined),
  },
}));

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  };
});

import {
  buildDocumentIndex,
  updateDocumentIndex,
  enqueueDocumentIndexJob,
  startDocumentIndexQueue,
  whenDocumentIndexIdle,
  resetDocumentIndexQueueForTests,
} from '../document-index';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';

const api = vi.mocked(tauriApi);

const ROOT = '/lib/Work';
const INDEX = `${ROOT}/.notesage/doc-index.json`;

const doc = (id?: string) => (id ? `---\nid: ${id}\n---\n\nbody` : '# no frontmatter');

/** Document reads only: the index file itself is not a document. */
const documentReads = () => api.readFile.mock.calls.map((c) => c[0]).filter((p) => p.endsWith('.md'));

function resetCalls() {
  for (const fn of Object.values(api)) vi.mocked(fn).mockClear();
}

beforeEach(() => {
  files.clear();
  localStorage.clear();
  resetDocumentIndexQueueForTests();
  vi.mocked(log.perf).mockClear();
  files.set(`${ROOT}/a.md`, doc('id-a'));
  files.set(`${ROOT}/sub/b.md`, doc('id-b'));
  files.set(`${ROOT}/plain.md`, doc());
  files.set(`${ROOT}/image.png`, 'png');
  resetCalls();
});

describe('buildDocumentIndex', () => {
  it('reads each document once on the first build and writes the index', async () => {
    const index = await buildDocumentIndex(ROOT);

    expect(index.entries).toEqual({ 'id-a': `${ROOT}/a.md`, 'id-b': `${ROOT}/sub/b.md` });
    expect(documentReads().sort()).toEqual([`${ROOT}/a.md`, `${ROOT}/plain.md`, `${ROOT}/sub/b.md`]);
    expect(api.writeFile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(files.get(INDEX)!)).toEqual({ entries: index.entries });
  });

  it('reads no document and writes nothing when the project is unchanged', async () => {
    await buildDocumentIndex(ROOT);
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(index.entries).toEqual({ 'id-a': `${ROOT}/a.md`, 'id-b': `${ROOT}/sub/b.md` });
    expect(documentReads()).toEqual([]);
    // The only read is the index file itself, to compare against.
    expect(api.readFile.mock.calls.map((c) => c[0])).toEqual([INDEX]);
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.createDirectory).not.toHaveBeenCalled();
    const perfCalls = vi.mocked(log.perf).mock.calls;
    const perfCall = perfCalls[perfCalls.length - 1];
    expect(perfCall[1]).toBe('doc-index build');
    expect(perfCall[2]).toMatchObject({ files: 3, filesRead: 0, wrote: false });
  });

  it('does not list the project again when the caller already has its tree', async () => {
    const known = tree(ROOT);

    await buildDocumentIndex(ROOT, known);

    expect(api.listDirectory).not.toHaveBeenCalled();
    expect(JSON.parse(files.get(INDEX)!).entries).toEqual({
      'id-a': `${ROOT}/a.md`,
      'id-b': `${ROOT}/sub/b.md`,
    });
  });

  it('reads only the file that was added', async () => {
    await buildDocumentIndex(ROOT);
    files.set(`${ROOT}/new.md`, doc('id-new'));
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([`${ROOT}/new.md`]);
    expect(index.entries['id-new']).toBe(`${ROOT}/new.md`);
    expect(api.writeFile).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite the index for a new file that has no id', async () => {
    await buildDocumentIndex(ROOT);
    files.set(`${ROOT}/scratch.md`, doc());
    resetCalls();

    await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([`${ROOT}/scratch.md`]);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('follows a moved document: reads it at its new path and drops the stale entry', async () => {
    await buildDocumentIndex(ROOT);
    files.set(`${ROOT}/archive/a.md`, files.get(`${ROOT}/a.md`)!);
    files.delete(`${ROOT}/a.md`);
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([`${ROOT}/archive/a.md`]);
    // An entry left pointing at the old path would make the Rust action scan
    // treat the document's comment sidecar as orphaned.
    expect(index.entries).toEqual({ 'id-a': `${ROOT}/archive/a.md`, 'id-b': `${ROOT}/sub/b.md` });
    expect(JSON.parse(files.get(INDEX)!).entries).toEqual(index.entries);
  });

  it('drops the entry of a deleted document', async () => {
    await buildDocumentIndex(ROOT);
    files.delete(`${ROOT}/sub/b.md`);
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([]);
    expect(index.entries).toEqual({ 'id-a': `${ROOT}/a.md` });
    expect(api.writeFile).toHaveBeenCalledTimes(1);
  });

  it('keeps an id the comment flow added since, without re-reading the document', async () => {
    await buildDocumentIndex(ROOT);
    // The app assigns the id and records it; the document is saved later.
    await updateDocumentIndex(ROOT, 'id-plain', `${ROOT}/plain.md`);
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([]);
    expect(index.entries['id-plain']).toBe(`${ROOT}/plain.md`);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('keeps an id the index file holds for a path this machine read as having none', async () => {
    await buildDocumentIndex(ROOT);
    // Another Mac (same paths) assigned the id; only the index file says so.
    files.set(INDEX, JSON.stringify({
      entries: { 'id-a': `${ROOT}/a.md`, 'id-b': `${ROOT}/sub/b.md`, 'id-plain': `${ROOT}/plain.md` },
    }));
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    expect(index.entries['id-plain']).toBe(`${ROOT}/plain.md`);
    expect(documentReads()).toEqual([]);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('re-reads id-less documents once when a comment sidecar resolves to nothing', async () => {
    await buildDocumentIndex(ROOT);
    // A document gained an id outside this app, at a path already read.
    files.set(`${ROOT}/plain.md`, doc('id-late'));
    files.set(`${ROOT}/.notesage/comments/id-late.json`, '[]');
    resetCalls();

    const index = await buildDocumentIndex(ROOT);

    // Only the documents with no known id are looked at again.
    expect(documentReads()).toEqual([`${ROOT}/plain.md`]);
    expect(index.entries['id-late']).toBe(`${ROOT}/plain.md`);
  });

  it('does not repeat that re-read for a sidecar that stays unresolved', async () => {
    files.set(`${ROOT}/.notesage/comments/orphan.json`, '[]');
    await buildDocumentIndex(ROOT);
    resetCalls();

    await buildDocumentIndex(ROOT);

    expect(documentReads()).toEqual([]);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('creates no index file for a project with no ids and no file yet', async () => {
    files.clear();
    files.set(`${ROOT}/plain.md`, doc());

    await buildDocumentIndex(ROOT);

    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.createDirectory).not.toHaveBeenCalled();
  });

  it('retries a document it could not read, and keeps its entry meanwhile', async () => {
    await buildDocumentIndex(ROOT);
    localStorage.clear(); // as on a machine that has not read this project
    api.readFile.mockImplementationOnce(async (path: string) => files.get(path)!); // the index file
    const realRead = api.readFile.getMockImplementation()!;
    api.readFile.mockImplementation(async (path: string) => {
      if (path === `${ROOT}/a.md`) throw new Error('evicted');
      return realRead(path);
    });
    resetCalls();

    const index = await buildDocumentIndex(ROOT);
    expect(index.entries['id-a']).toBe(`${ROOT}/a.md`);
    expect(api.writeFile).not.toHaveBeenCalled();

    api.readFile.mockImplementation(realRead);
    resetCalls();
    await buildDocumentIndex(ROOT);
    expect(documentReads()).toEqual([`${ROOT}/a.md`]);
  });
});

describe('document-index queue', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('runs nothing until started, then one job at a time', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    enqueueDocumentIndexJob('a', async () => {
      order.push('a:start');
      await new Promise<void>((r) => { releaseFirst = r; });
      order.push('a:end');
    });
    enqueueDocumentIndexJob('b', async () => { order.push('b'); });

    await tick();
    expect(order).toEqual([]);

    startDocumentIndexQueue();
    await tick();
    expect(order).toEqual(['a:start']);

    releaseFirst();
    await tick();
    await tick();
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('whenDocumentIndexIdle resolves at once when nothing is queued, and after the queue drains otherwise', async () => {
    await whenDocumentIndexIdle(10_000);

    let ran = false;
    enqueueDocumentIndexJob('a', async () => { ran = true; });
    let idle = false;
    void whenDocumentIndexIdle(10_000).then(() => { idle = true; });
    await tick();
    expect(idle).toBe(false);

    startDocumentIndexQueue();
    await tick();
    await tick();
    expect(ran).toBe(true);
    expect(idle).toBe(true);
  });

  it('whenDocumentIndexIdle gives up after the timeout', async () => {
    enqueueDocumentIndexJob('never-started', async () => {});
    await whenDocumentIndexIdle(5);
  });

  it('a failing job does not stop the queue', async () => {
    let ran = false;
    enqueueDocumentIndexJob('a', async () => { throw new Error('x'); });
    enqueueDocumentIndexJob('b', async () => { ran = true; });
    startDocumentIndexQueue();
    await tick();
    await tick();
    await tick();
    expect(ran).toBe(true);
  });
});
