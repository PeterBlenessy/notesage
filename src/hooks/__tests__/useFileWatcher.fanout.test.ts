// @vitest-environment jsdom

/**
 * Perf review F-3 / F-4 and the watcher half of S-4:
 *  - a batch touching several directories refreshes all of them;
 *  - cache invalidation is skipped for paths the caches cannot hold;
 *  - the library's own folders (Inbox, Recordings) are never added as projects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore } from '@/stores/mcp-store';
import { _injectStorageForTesting, type StorageBackend, type StoredEntry } from '@/lib/viewport-cache';
import { INBOX_FOLDER_NAME } from '@/lib/inbox';
import { RECORDINGS_FOLDER_NAME } from '@/lib/notes-root';

const mockRefreshFileTree = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ refreshFileTree: mockRefreshFileTree }),
  refreshGitForPath: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

type Kind = 'create' | 'modify' | 'delete';
const LIB = '/Users/testuser/Library/Mobile Documents/iCloud~com~notesage~app/Documents';

let useFileWatcher: typeof import('@/hooks/useFileWatcher').useFileWatcher;
let viewportDeletes: string[];
let invalidated: string[];
let existsCalls: string[];
const onInvalidate = (event: Event) => {
  invalidated.push((event as CustomEvent<{ filePath: string }>).detail.filePath);
};

function emitBatch(events: Array<{ path: string; kind: Kind }>) {
  emitMockEvent('file-changed-batch', events);
}

beforeEach(async () => {
  vi.useFakeTimers();
  mockRefreshFileTree.mockReset();
  viewportDeletes = [];
  invalidated = [];
  existsCalls = [];

  const backend: StorageBackend = {
    get: async () => undefined,
    put: async (_key: string, _entry: StoredEntry) => {},
    delete: async (key: string) => {
      viewportDeletes.push(key);
    },
    getAllEntries: async () => [],
    clear: async () => {},
  };
  _injectStorageForTesting(backend);
  window.addEventListener('notesage:invalidate-editor-state', onInvalidate);

  useEditorStore.setState({ openDocuments: [], activeTabId: null, recentFiles: [] });
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    pinnedFiles: [],
    dismissedLibraryProjects: [],
  });
  useSettingsStore.setState({
    gitEnabled: false,
    externalChangeDiffReview: false,
    icloudNotesagePath: null,
    notesRootPath: '/Users/testuser/Notesage',
    showHiddenFiles: false,
  });
  useMcpStore.setState({ rescanCounter: 0 });

  setMockInvokeHandler('read_file', () => '# Hello');
  setMockInvokeHandler('path_exists', (args) => {
    existsCalls.push((args as { path: string }).path);
    return true;
  });
  setMockInvokeHandler('list_directory', () => []);
  setMockInvokeHandler('get_home_dir', () => '/Users/testuser');

  const mod = await import('@/hooks/useFileWatcher');
  useFileWatcher = mod.useFileWatcher;
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(2000);
  window.removeEventListener('notesage:invalidate-editor-state', onInvalidate);
  _injectStorageForTesting(null);
  vi.useRealTimers();
});

describe('useFileWatcher — tree refresh covers every directory in a batch (F-3)', () => {
  it('one batch touching three directories refreshes all three, in one call', () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: '/lib/Work/notes/a.md', kind: 'create' },
      { path: '/lib/Home/b.md', kind: 'delete' },
      { path: '/ext/Downloads/c.pdf', kind: 'create' },
      { path: '/lib/Work/notes/d.md', kind: 'create' },
    ]);
    vi.advanceTimersByTime(300);

    // Before: one shared timer remembered only the last directory.
    expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    const [target] = mockRefreshFileTree.mock.calls[0] as [string[]];
    expect([...target].sort()).toEqual(['/ext/Downloads', '/lib/Home', '/lib/Work/notes']);
  });

  it('directories from batches that arrive inside the debounce window accumulate', () => {
    renderHook(() => useFileWatcher());

    emitBatch([{ path: '/lib/Work/a.md', kind: 'create' }]);
    vi.advanceTimersByTime(200);
    emitBatch([{ path: '/lib/Home/b.md', kind: 'create' }]);
    vi.advanceTimersByTime(300);

    expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    const [target] = mockRefreshFileTree.mock.calls[0] as [string[]];
    expect([...target].sort()).toEqual(['/lib/Home', '/lib/Work']);
  });

  it('nothing is carried over into the next refresh', () => {
    renderHook(() => useFileWatcher());

    emitBatch([{ path: '/lib/Work/a.md', kind: 'create' }]);
    vi.advanceTimersByTime(300);
    emitBatch([{ path: '/lib/Home/b.md', kind: 'create' }]);
    vi.advanceTimersByTime(300);

    expect(mockRefreshFileTree.mock.calls).toEqual([['/lib/Work'], ['/lib/Home']]);
  });

  it('a modify overflow asks for ONE full refresh, however many events follow', () => {
    renderHook(() => useFileWatcher());

    // 1,200 distinct modified files: the per-file timer map (cap 500) overflows twice.
    emitBatch(
      Array.from({ length: 1200 }, (_, i) => ({ path: `/lib/Work/f${i}.md`, kind: 'modify' as const })),
    );
    vi.advanceTimersByTime(300);

    expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    expect(mockRefreshFileTree.mock.calls[0]).toEqual([]);
  });

  it('a rejected refresh is caught, not left as an unhandled rejection', async () => {
    mockRefreshFileTree.mockRejectedValueOnce(new Error('listing failed'));
    renderHook(() => useFileWatcher());

    emitBatch([{ path: '/lib/Work/a.md', kind: 'create' }]);
    await vi.advanceTimersByTimeAsync(300);

    const { log } = await import('@/lib/logger');
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      'watcher',
      'Tree refresh after a file event failed',
      expect.any(Error),
    );
  });
});

describe('useFileWatcher — per-event cache invalidation only for documents (F-4)', () => {
  it('a sync burst of non-documents costs 0 IndexedDB deletes and 0 invalidation events', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: `${LIB}/Inbox/.notesage/reading-progress.json`, kind: 'modify' },
      { path: `${LIB}/Work/.notesage/doc-index.json`, kind: 'modify' },
      { path: `${LIB}/Work/.git/index`, kind: 'modify' },
      { path: `${LIB}/Inbox/photo.png`, kind: 'create' },
      { path: `${LIB}/Work/scan.pdf`, kind: 'create' },
      { path: `${LIB}/Work/.DS_Store`, kind: 'modify' },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(viewportDeletes).toHaveLength(0);
    expect(invalidated).toHaveLength(0);
  });

  it('a changed markdown file still drops its viewport snapshot and its cached editor state', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: `${LIB}/Work/note.md`, kind: 'modify' },
      { path: `${LIB}/Work/photo.png`, kind: 'modify' },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(viewportDeletes).toEqual([`${LIB}/Work/note.md`]);
    expect(invalidated).toEqual([`${LIB}/Work/note.md`]);
  });

  it('other text documents drop their editor state; only markdown has a viewport snapshot to drop', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: `${LIB}/Inbox/article.html`, kind: 'modify' },
      { path: `${LIB}/Work/data.txt`, kind: 'delete' },
      { path: `${LIB}/Work/new-folder`, kind: 'create' },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(viewportDeletes).toHaveLength(0);
    expect(invalidated.sort()).toEqual(
      [`${LIB}/Inbox/article.html`, `${LIB}/Work/data.txt`, `${LIB}/Work/new-folder`].sort(),
    );
  });
});

describe('useFileWatcher — reserved library folders are never projects (S-4)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ icloudNotesagePath: LIB });
  });

  it('does not add the Inbox, although it has a .notesage folder', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: `${LIB}/${INBOX_FOLDER_NAME}/.notesage/reading-progress.json`, kind: 'create' },
      { path: `${LIB}/${INBOX_FOLDER_NAME}/article.html`, kind: 'create' },
    ]);
    await vi.advanceTimersByTimeAsync(1500);

    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
    // Not even asked about: no `path_exists`, no listing of 350 captures.
    expect(existsCalls).toHaveLength(0);
  });

  it('does not add the Recordings folder', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([{ path: `${LIB}/${RECORDINGS_FOLDER_NAME}/.notesage/manifest.json`, kind: 'create' }]);
    await vi.advanceTimersByTimeAsync(1500);

    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
    expect(existsCalls).toHaveLength(0);
  });

  it('still adds an ordinary project, including one whose name starts with "Inbox"', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([
      { path: `${LIB}/Work/note.md`, kind: 'create' },
      { path: `${LIB}/Inbox archive/note.md`, kind: 'create' },
    ]);
    await vi.advanceTimersByTimeAsync(1500);

    expect(useWorkspaceStore.getState().projects.map((p) => p.path).sort()).toEqual([
      `${LIB}/Inbox archive`,
      `${LIB}/Work`,
    ]);
  });

  it('still skips a project the person dismissed', async () => {
    useWorkspaceStore.setState({ dismissedLibraryProjects: [`${LIB}/Work`] });
    renderHook(() => useFileWatcher());

    emitBatch([{ path: `${LIB}/Work/note.md`, kind: 'create' }]);
    await vi.advanceTimersByTimeAsync(1500);

    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
  });
});

describe('useFileWatcher — an MCP config changing on disk still triggers a rescan', () => {
  it('for a project config and for the global one, and for nothing else', async () => {
    renderHook(() => useFileWatcher());

    emitBatch([{ path: `${LIB}/Work/.notesage/mcp.json`, kind: 'modify' }]);
    await vi.advanceTimersByTimeAsync(600);
    expect(useMcpStore.getState().rescanCounter).toBe(1);

    emitBatch([{ path: '/Users/testuser/.notesage/mcp.json', kind: 'create' }]);
    await vi.advanceTimersByTimeAsync(600);
    expect(useMcpStore.getState().rescanCounter).toBe(2);

    emitBatch([
      { path: `${LIB}/Work/notes/mcp.json`, kind: 'modify' },
      { path: `${LIB}/Work/.notesage/project.json`, kind: 'modify' },
      { path: `${LIB}/Work/note.md`, kind: 'create' },
    ]);
    await vi.advanceTimersByTimeAsync(600);
    expect(useMcpStore.getState().rescanCounter).toBe(2);
  });
});
