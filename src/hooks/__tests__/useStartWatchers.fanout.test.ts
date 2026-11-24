// @vitest-environment jsdom

/**
 * Perf review F-1 / F-2: what a tree refresh costs in watcher and asset-scope
 * calls (nothing), and which roots get a watch of their own (only those not
 * already under another watched root).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    allowAssetDir: vi.fn(() => Promise.resolve()),
    watchDirectory: vi.fn(() => Promise.resolve()),
    getHomeDir: vi.fn(() => Promise.resolve('/Users/test')),
  },
}));

import { useStartWatchers, coveringWatchRoots } from '@/hooks/useStartWatchers';
import { tauriApi } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { FileEntry } from '@/lib/tauri';

const LIB = '/Users/test/Library/Mobile Documents/iCloud~com~notesage~app/Documents';
const watch = vi.mocked(tauriApi.watchDirectory);
const allow = vi.mocked(tauriApi.allowAssetDir);

function tree(root: string, names: string[]): FileEntry[] {
  return names.map((name) => ({ name, path: `${root}/${name}`, is_directory: false, hidden: false }));
}

function watched(): string[] {
  return watch.mock.calls.map(([path]) => path).sort();
}

/** Let the `getHomeDir().then(...)` in the effect run. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  watch.mockImplementation(() => Promise.resolve());
  useSettingsStore.setState({
    startupReady: true,
    notesRootPath: '/Users/test/Notesage',
    icloudNotesagePath: LIB,
  });
  useWorkspaceStore.setState({
    projects: [
      { path: `${LIB}/Work`, fileTree: tree(`${LIB}/Work`, ['a.md']) },
      { path: `${LIB}/Home`, fileTree: tree(`${LIB}/Home`, ['b.md']) },
      { path: '/Users/test/elsewhere/Solo', fileTree: [] },
    ],
    explorerFolders: [{ path: '/Users/test/Downloads', fileTree: [] }],
  });
});

describe('useStartWatchers — a tree refresh registers nothing', () => {
  it('issues 0 watch_directory and 0 allow_asset_dir calls when only tree contents change', async () => {
    renderHook(() => useStartWatchers());
    await settle();
    expect(watch.mock.calls.length).toBeGreaterThan(0);
    expect(allow.mock.calls.length).toBeGreaterThan(0);
    watch.mockClear();
    allow.mockClear();

    // What a watcher-driven refresh does: a fresh listing with one more file,
    // then an identical one.
    act(() => {
      useWorkspaceStore.getState().updateProjectTree(`${LIB}/Work`, tree(`${LIB}/Work`, ['a.md', 'new.md']));
    });
    act(() => {
      useWorkspaceStore.getState().updateProjectTree(`${LIB}/Work`, tree(`${LIB}/Work`, ['a.md', 'new.md']));
      useWorkspaceStore.getState().updateExplorerTree('/Users/test/Downloads', tree('/Users/test/Downloads', ['x.pdf']));
    });
    await settle();

    expect(watch).toHaveBeenCalledTimes(0);
    expect(allow).toHaveBeenCalledTimes(0);
  });

  it('re-registers once when a project is added, and grants the new root exactly once', async () => {
    renderHook(() => useStartWatchers());
    await settle();
    watch.mockClear();
    allow.mockClear();

    act(() => {
      useWorkspaceStore.getState().addProject('/Users/test/elsewhere/New', []);
    });
    await settle();

    expect(watch.mock.calls.filter(([p]) => p === '/Users/test/elsewhere/New')).toHaveLength(1);
    expect(allow.mock.calls.filter(([p]) => p === '/Users/test/elsewhere/New')).toHaveLength(1);
    // One pass over the roots, not one per store update.
    expect(new Set(watched()).size).toBe(watched().length);
  });
});

describe('useStartWatchers — nested roots are not watched twice (F-2)', () => {
  it('skips projects that lie under the library root, and still watches the rest', async () => {
    renderHook(() => useStartWatchers());
    await settle();

    expect(watched()).toEqual(
      [
        '/Users/test/.notesage',
        '/Users/test/Downloads',
        '/Users/test/Notesage',
        '/Users/test/elsewhere/Solo',
        LIB,
      ].sort(),
    );
    // Asset scope is a different matter: every root is still granted.
    expect(allow).toHaveBeenCalledWith(`${LIB}/Work`);
    expect(allow).toHaveBeenCalledWith(`${LIB}/Home`);
  });

  it('watches a project directly once the root that covered it goes away', async () => {
    renderHook(() => useStartWatchers());
    await settle();
    watch.mockClear();

    act(() => {
      useSettingsStore.setState({ icloudNotesagePath: null });
    });
    await settle();

    expect(watched()).toContain(`${LIB}/Work`);
    expect(watched()).toContain(`${LIB}/Home`);
  });

  it('falls back to the covered roots when the covering watch cannot be started', async () => {
    watch.mockImplementation((path: string) =>
      path === LIB ? Promise.reject(new Error('Path is not a directory')) : Promise.resolve(),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useStartWatchers());
    await settle();
    await settle();

    expect(watched()).toContain(`${LIB}/Work`);
    expect(watched()).toContain(`${LIB}/Home`);
    consoleError.mockRestore();
  });

  it('does not watch ~/.notesage separately when a watched root already contains it', async () => {
    useSettingsStore.setState({ notesRootPath: '/Users/test', icloudNotesagePath: null });
    useWorkspaceStore.setState({ projects: [], explorerFolders: [] });

    renderHook(() => useStartWatchers());
    await settle();

    expect(watched()).toEqual(['/Users/test']);
  });

  it('coveringWatchRoots: a sibling whose name only starts the same is not "under"', () => {
    const roots = coveringWatchRoots(['/lib/Work', '/lib/Work-archive', '/lib/Work/sub', '/lib/Work']);
    expect(roots).toEqual([
      { root: '/lib/Work', covers: ['/lib/Work/sub'] },
      { root: '/lib/Work-archive', covers: [] },
    ]);
  });
});
