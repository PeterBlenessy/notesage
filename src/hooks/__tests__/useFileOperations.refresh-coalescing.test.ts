// @vitest-environment jsdom

/**
 * Perf review F-3: `refreshFileTree` is single-flight per root, and one call
 * can name several directories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useFileOperations } from '@/hooks/useFileOperations';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

vi.mock('@/lib/refresh-notes-tree', () => ({
  refreshNotesTree: vi.fn(async () => null),
}));
vi.mock('@/lib/migrate-project-path', () => ({
  migrateProjectPath: vi.fn(async () => {}),
}));
vi.mock('@/stores/git-store', () => {
  const store = {
    repos: {},
    setFileStatuses: vi.fn(),
    setCurrentBranch: vi.fn(),
    setStatusError: vi.fn(),
    getState: () => store,
  };
  return { useGitStore: Object.assign(vi.fn(() => store), { getState: () => store }) };
});
vi.mock('@/stores/action-store', () => {
  const store = { incrementalUpdate: vi.fn() };
  return { useActionStore: Object.assign(vi.fn(() => store), { getState: () => store }) };
});

interface PendingListing {
  path: string;
  resolve: (tree: FileEntry[]) => void;
  reject: (error: Error) => void;
}

/** Listings the test resolves by hand, so refreshes can be made to overlap. */
let pending: PendingListing[];
let listCalls: string[];
let inFlight: Map<string, number>;
let maxInFlight: Map<string, number>;

function entry(path: string): FileEntry {
  return { name: path.split('/').pop() as string, path, is_directory: false, hidden: false };
}

async function tick() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Resolve the oldest pending listing of `path`. */
async function finishListing(path: string, tree: FileEntry[] = []) {
  const index = pending.findIndex((p) => p.path === path);
  expect(index, `a listing of ${path} should be in flight`).toBeGreaterThanOrEqual(0);
  const [listing] = pending.splice(index, 1);
  listing.resolve(tree);
  await tick();
}

function countOf(path: string): number {
  return listCalls.filter((p) => p === path).length;
}

beforeEach(() => {
  pending = [];
  listCalls = [];
  inFlight = new Map();
  maxInFlight = new Map();
  setMockInvokeHandler('list_directory', (args) => {
    const path = (args as { path: string }).path;
    listCalls.push(path);
    const now = (inFlight.get(path) ?? 0) + 1;
    inFlight.set(path, now);
    maxInFlight.set(path, Math.max(maxInFlight.get(path) ?? 0, now));
    return new Promise<FileEntry[]>((resolve, reject) => {
      const done = () => inFlight.set(path, (inFlight.get(path) ?? 1) - 1);
      pending.push({
        path,
        resolve: (tree) => {
          done();
          resolve(tree);
        },
        reject: (error) => {
          done();
          reject(error);
        },
      });
    });
  });
  setMockInvokeHandler('path_exists', () => true);
  useSettingsStore.setState({
    gitEnabled: false,
    startupReady: true,
    notesRootPath: '/Users/test/Notesage',
    icloudNotesagePath: null,
  });
  useWorkspaceStore.setState({
    explorerFolders: [{ path: '/ext', fileTree: [] }],
    projects: [
      { path: '/lib/Work', fileTree: [] },
      { path: '/lib/Work-archive', fileTree: [] },
      { path: '/lib/Home', fileTree: [] },
    ],
  });
});

describe('refreshFileTree — overlapping requests for one root coalesce', () => {
  it('five requests while a listing is in flight cost one more listing, not five', async () => {
    const { result } = renderHook(() => useFileOperations());
    const settled: number[] = [];

    const first = result.current.refreshFileTree('/lib/Work/a').then(() => settled.push(1));
    await tick();
    expect(countOf('/lib/Work')).toBe(1);

    const later = [2, 3, 4, 5, 6].map((n) =>
      result.current.refreshFileTree(`/lib/Work/dir${n}`).then(() => settled.push(n)),
    );
    await tick();
    // Nothing new started alongside the listing in flight.
    expect(countOf('/lib/Work')).toBe(1);

    await finishListing('/lib/Work', [entry('/lib/Work/stale.md')]);
    // The first caller is done; the others are waiting on the ONE re-run,
    // because the first listing may predate what they asked about.
    expect(settled).toEqual([1]);
    expect(countOf('/lib/Work')).toBe(2);

    await finishListing('/lib/Work', [entry('/lib/Work/fresh.md')]);
    await Promise.all([first, ...later]);

    expect(countOf('/lib/Work')).toBe(2);
    expect(maxInFlight.get('/lib/Work')).toBe(1);
    expect(settled.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // The re-run's listing is the one in the store.
    expect(useWorkspaceStore.getState().projects[0].fileTree.map((e) => e.name)).toEqual(['fresh.md']);
  });

  it('a request after the flight has landed starts a new listing', async () => {
    const { result } = renderHook(() => useFileOperations());

    const first = result.current.refreshFileTree('/lib/Work');
    await tick();
    await finishListing('/lib/Work');
    await first;

    const second = result.current.refreshFileTree('/lib/Work');
    await tick();
    await finishListing('/lib/Work');
    await second;

    expect(countOf('/lib/Work')).toBe(2);
  });

  it('a listing that fails still releases the root for the next request', async () => {
    const { result } = renderHook(() => useFileOperations());

    const first = result.current.refreshFileTree('/lib/Work');
    await tick();
    const [listing] = pending.splice(0, 1);
    listing.reject(new Error('Operation timed out'));
    await first;

    const second = result.current.refreshFileTree('/lib/Work');
    await tick();
    await finishListing('/lib/Work', [entry('/lib/Work/a.md')]);
    await second;

    expect(useWorkspaceStore.getState().projects[0].fileTree).toHaveLength(1);
  });
});

describe('refreshFileTree — several directories in one call', () => {
  it('refreshes every owning root exactly once, and no root that owns none of them', async () => {
    const { result } = renderHook(() => useFileOperations());

    const done = result.current.refreshFileTree([
      '/lib/Work/notes',
      '/lib/Work/notes/deep',
      '/lib/Home',
      '/ext/sub',
    ]);
    // Roots are listed one after another.
    for (const root of ['/ext', '/lib/Work', '/lib/Home']) {
      await tick();
      await finishListing(root);
    }
    await done;

    expect(countOf('/lib/Work')).toBe(1);
    expect(countOf('/lib/Home')).toBe(1);
    expect(countOf('/ext')).toBe(1);
    // `/lib/Work-archive` only shares a name prefix with `/lib/Work`.
    expect(countOf('/lib/Work-archive')).toBe(0);
  });

  it('an empty list refreshes nothing', async () => {
    const { result } = renderHook(() => useFileOperations());
    await result.current.refreshFileTree([]);
    expect(listCalls).toHaveLength(0);
  });
});

describe('refreshFileTree — a full refresh does not overlap itself', () => {
  it('three full refreshes at once list each root at most twice and never concurrently', async () => {
    const { result } = renderHook(() => useFileOperations());

    const all = [
      result.current.refreshFileTree(),
      result.current.refreshFileTree(),
      result.current.refreshFileTree(),
    ];
    // Drive every listing to completion as it appears.
    for (let guard = 0; guard < 40 && (pending.length > 0 || guard < 3); guard++) {
      await tick();
      const next = pending[0];
      if (next) await finishListing(next.path);
    }
    await Promise.all(all);

    for (const root of ['/ext', '/lib/Work', '/lib/Work-archive', '/lib/Home']) {
      // One pass, plus the single re-run the two later requests share.
      expect(countOf(root), root).toBe(2);
      expect(maxInFlight.get(root), root).toBe(1);
    }
  });

  it('a full refresh waits for a targeted listing in flight instead of listing the root alongside it', async () => {
    useWorkspaceStore.setState({ explorerFolders: [], projects: [{ path: '/lib/Work', fileTree: [] }] });
    const { result } = renderHook(() => useFileOperations());

    const targeted = result.current.refreshFileTree('/lib/Work/a');
    await tick();
    const full = result.current.refreshFileTree();
    await tick();
    expect(countOf('/lib/Work')).toBe(1);

    await finishListing('/lib/Work');
    await finishListing('/lib/Work');
    await Promise.all([targeted, full]);

    expect(countOf('/lib/Work')).toBe(2);
    expect(maxInFlight.get('/lib/Work')).toBe(1);
  });

  it('the re-run a full refresh queued still decides what an unreadable project means', async () => {
    useWorkspaceStore.setState({ explorerFolders: [], projects: [{ path: '/lib/Gone', fileTree: [] }] });
    setMockInvokeHandler('path_exists', () => false);
    const { result } = renderHook(() => useFileOperations());

    const targeted = result.current.refreshFileTree('/lib/Gone/a');
    await tick();
    const full = result.current.refreshFileTree();
    await tick();

    // Both listings fail: the folder is gone.
    for (let i = 0; i < 2; i++) {
      const index = pending.findIndex((p) => p.path === '/lib/Gone');
      const [listing] = pending.splice(index, 1);
      listing.reject(new Error('No such file or directory'));
      // The parent listing `detectRenamedProject` makes, if it gets that far.
      for (let n = 0; n < 4; n++) {
        await tick();
        const parent = pending.findIndex((p) => p.path === '/lib');
        if (parent >= 0) pending.splice(parent, 1)[0].resolve([]);
      }
    }
    await Promise.all([targeted, full]);

    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
  });

  it('does not prune an unreadable project before startupReady', async () => {
    useSettingsStore.setState({ startupReady: false });
    useWorkspaceStore.setState({ explorerFolders: [], projects: [{ path: '/lib/Gone', fileTree: [] }] });
    setMockInvokeHandler('path_exists', () => false);
    const { result } = renderHook(() => useFileOperations());

    const full = result.current.refreshFileTree();
    await tick();
    pending.splice(0, 1)[0].reject(new Error('No such file or directory'));
    await full;

    expect(useWorkspaceStore.getState().projects.map((p) => p.path)).toEqual(['/lib/Gone']);
  });
});
