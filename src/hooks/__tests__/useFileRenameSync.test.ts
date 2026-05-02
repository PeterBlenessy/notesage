// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRefreshFileTree = vi.fn();
const mockSaveFile = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    refreshFileTree: mockRefreshFileTree,
    saveFile: mockSaveFile,
  }),
  refreshGitForPath: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Patch sonner's toast export to be callable as a function with method stubs
// (tauri-mock provides it as a plain object without the base call).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockToastFn: any;

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks are configured
// ---------------------------------------------------------------------------

let useFileRenameSync: typeof import('@/hooks/useFileRenameSync').useFileRenameSync;
let trackSelfRename: typeof import('@/lib/self-rename-filter').trackSelfRename;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(overrides: Partial<import('@/stores/editor-store').Tab> = {}): import('@/stores/editor-store').Tab {
  return {
    id: 'tab-1',
    filePath: '/project/notes/test.md',
    fileName: 'test.md',
    isDirty: false,
    content: '# Hello\n\nOriginal content',
    frontmatter: null,
    fileType: 'markdown',
    contentLoaded: true,
    ...overrides,
  };
}

function resetStores() {
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    persistedTabs: [],
    persistedActiveFilePath: null,
    documentAccessOrder: [],
  });

  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    pinnedFiles: [],
  });
}

function emitFileRenamed(oldPath: string, newPath: string, isDirectory = false) {
  emitMockEvent('file-renamed', { old_path: oldPath, new_path: newPath, is_directory: isDirectory });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  // Patch sonner's toast to be callable as a function
  const sonner = await import('sonner');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = vi.fn() as any;
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  fn.loading = vi.fn();
  fn.dismiss = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sonner as any).toast = fn;
  mockToastFn = fn;

  // Lazy-import hook and self-rename filter after mocks are configured
  const mod = await import('@/hooks/useFileRenameSync');
  useFileRenameSync = mod.useFileRenameSync;
  const filterMod = await import('@/lib/self-rename-filter');
  trackSelfRename = filterMod.trackSelfRename;

  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileRenameSync — single file rename', () => {
  it('updates open tab filePath when a file is renamed', async () => {
    const tab = makeTab({ filePath: '/project/notes/foo.md', fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    const docs = useEditorStore.getState().openDocuments;
    expect(docs[0].filePath).toBe('/project/notes/bar.md');
  });

  it('updates open tab fileName when a file is renamed', async () => {
    const tab = makeTab({ filePath: '/project/notes/foo.md', fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    const docs = useEditorStore.getState().openDocuments;
    expect(docs[0].fileName).toBe('bar.md');
  });

  it('rewrites the recentFiles entry when a file is renamed', async () => {
    useEditorStore.setState({
      openDocuments: [],
      recentFiles: [{ path: '/project/notes/foo.md', name: 'foo.md', lastAccessedAt: Date.now() }],
    });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    const recents = useEditorStore.getState().recentFiles;
    expect(recents[0].path).toBe('/project/notes/bar.md');
    expect(recents[0].name).toBe('bar.md');
  });

  it('does not crash when renamed file has no open tab or recent entry', async () => {
    // No tabs, no recents
    renderHook(() => useFileRenameSync());

    expect(() => {
      act(() => {
        emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
      });
    }).not.toThrow();
  });

  it('shows an info toast when a clean tab is renamed', async () => {
    const tab = makeTab({
      filePath: '/project/notes/foo.md',
      fileName: 'foo.md',
      isDirty: false,
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    // Clean tab rename should show an info toast (not the sticky save-now prompt)
    expect(mockToastFn.info).toHaveBeenCalledWith(
      expect.stringContaining('foo.md'),
      expect.any(Object)
    );
  });

  it('shows a sticky save-now toast when a dirty tab is renamed', async () => {
    const tab = makeTab({
      filePath: '/project/notes/foo.md',
      fileName: 'foo.md',
      isDirty: true,
      content: '# Unsaved edits',
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    // Dirty tab: sticky toast with Save now action
    expect(mockToastFn).toHaveBeenCalledWith(
      expect.stringContaining('foo.md'),
      expect.objectContaining({ duration: Infinity })
    );
  });
});

describe('useFileRenameSync — folder rename', () => {
  it('rewrites all descendant tab paths when a folder is renamed', async () => {
    const tab1 = makeTab({ id: 't1', filePath: '/project/notes/docs/a.md', fileName: 'a.md' });
    const tab2 = makeTab({ id: 't2', filePath: '/project/notes/docs/b.md', fileName: 'b.md' });
    const tab3 = makeTab({ id: 't3', filePath: '/project/other/c.md', fileName: 'c.md' });
    useEditorStore.setState({ openDocuments: [tab1, tab2, tab3], activeTabId: tab1.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/docs', '/project/notes/renamed', true);
    });

    const docs = useEditorStore.getState().openDocuments;
    expect(docs.find(t => t.id === 't1')!.filePath).toBe('/project/notes/renamed/a.md');
    expect(docs.find(t => t.id === 't2')!.filePath).toBe('/project/notes/renamed/b.md');
    // Tab outside renamed folder should be untouched
    expect(docs.find(t => t.id === 't3')!.filePath).toBe('/project/other/c.md');
  });

  it('triggers refreshFileTree for non-project folder rename', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/project', fileTree: [] }],
    });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/docs', '/project/notes/renamed', true);
    });

    await vi.runAllTimersAsync();
    expect(mockRefreshFileTree).toHaveBeenCalled();
  });
});

describe('useFileRenameSync — project root rename', () => {
  it('calls workspace-store.updateProjectPath when a project root is renamed', async () => {
    const mockUpdateProjectPath = vi.fn();
    useWorkspaceStore.setState({
      projects: [{ path: '/Notesage/myproject', fileTree: [] }],
    });
    const origGetState = useWorkspaceStore.getState;
    vi.spyOn(useWorkspaceStore, 'getState').mockImplementation(() => ({
      ...origGetState(),
      updateProjectPath: mockUpdateProjectPath,
    }));

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/Notesage/myproject', '/Notesage/renamed', true);
    });

    expect(mockUpdateProjectPath).toHaveBeenCalledWith(
      '/Notesage/myproject',
      '/Notesage/renamed',
      expect.any(Array)
    );

    vi.restoreAllMocks();
  });
});

describe('useFileRenameSync — self-write suppression', () => {
  it('does not toast and does not update open tabs when both paths are tracked as self-renames', async () => {
    const tab = makeTab({ filePath: '/project/notes/foo.md', fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    // Mark the rename as self-initiated BEFORE the event fires
    trackSelfRename('/project/notes/foo.md', '/project/notes/bar.md');

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    // No toast of any kind should have been shown for a self-initiated rename
    expect(mockToastFn).not.toHaveBeenCalled();
    expect(mockToastFn.info).not.toHaveBeenCalled();
    expect(mockToastFn.warning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Gap #10: Save Now button wiring
// ---------------------------------------------------------------------------

describe('useFileRenameSync — Save Now button wiring (gap #10)', () => {
  it('clicking Save now on a dirty tab calls saveFile with newPath and tab content', async () => {
    const tab = makeTab({
      id: 'dirty-tab',
      filePath: '/project/notes/foo.md',
      fileName: 'foo.md',
      isDirty: true,
      content: '# Unsaved content',
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    // Capture the onSave callback from the sticky toast (dirty tab path)
    const [, opts] = mockToastFn.mock.calls[0];
    expect(opts.action.label).toBe('Save now');

    // Clicking Save now should call saveFile with the new path and tab content
    await act(async () => {
      await opts.action.onClick();
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      '/project/notes/bar.md',
      '# Unsaved content',
      'dirty-tab'
    );
  });

  it('does not show Save now button when the tab is clean', async () => {
    const tab = makeTab({
      filePath: '/project/notes/foo.md',
      fileName: 'foo.md',
      isDirty: false,
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
    });

    // Clean tab: info toast without action button
    expect(mockToastFn.info).toHaveBeenCalledTimes(1);
    expect(mockToastFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Gap #7: Path-keyed sidecar migration for non-project files
// ---------------------------------------------------------------------------

/** Same hash algorithm as useCommentOperations.ts — must stay in sync. */
function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

describe('useFileRenameSync — sidecar migration for non-project files (gap #7)', () => {
  const NOTES_ROOT = '/home/user/Notesage';

  beforeEach(() => {
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    // No projects — file is non-project
    useWorkspaceStore.setState({ projects: [], explorerFolders: [], pinnedFiles: [] });
  });

  it('migrates sidecar when a non-project file with comments is renamed', async () => {
    const OLD_PATH = '/home/user/Downloads/note.md';
    const NEW_PATH = '/home/user/Downloads/note-renamed.md';
    const oldHash = hashPath(OLD_PATH);
    const newHash = hashPath(NEW_PATH);
    const oldSidecar = `${NOTES_ROOT}/.notesage/comments/${oldHash}.json`;
    const newSidecar = `${NOTES_ROOT}/.notesage/comments/${newHash}.json`;
    const sidecarContent = JSON.stringify([{ id: 'c1', body: 'comment' }]);

    const readFileSpy = vi.fn().mockResolvedValue(sidecarContent);
    const writeFileSpy = vi.fn().mockResolvedValue(undefined);
    const deletePathSpy = vi.fn().mockResolvedValue(undefined);

    setMockInvokeHandler('path_exists', (args) => {
      if ((args as { path: string }).path === oldSidecar) return true;
      return false;
    });
    setMockInvokeHandler('read_file', (args) => readFileSpy(args));
    setMockInvokeHandler('write_file', (args) => writeFileSpy(args));
    setMockInvokeHandler('delete_path', (args) => deletePathSpy(args));

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed(OLD_PATH, NEW_PATH);
    });

    await vi.runAllTimersAsync();

    expect(readFileSpy).toHaveBeenCalledWith(expect.objectContaining({ path: oldSidecar }));
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ path: newSidecar, content: sidecarContent })
    );
    expect(deletePathSpy).toHaveBeenCalledWith(expect.objectContaining({ path: oldSidecar }));
  });

  it('does not migrate sidecar when the old sidecar does not exist', async () => {
    const OLD_PATH = '/home/user/Downloads/no-comments.md';
    const NEW_PATH = '/home/user/Downloads/no-comments-renamed.md';

    const writeFileSpy = vi.fn().mockResolvedValue(undefined);
    const deletePathSpy = vi.fn().mockResolvedValue(undefined);

    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('write_file', (args) => writeFileSpy(args));
    setMockInvokeHandler('delete_path', (args) => deletePathSpy(args));

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed(OLD_PATH, NEW_PATH);
    });

    await vi.runAllTimersAsync();

    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(deletePathSpy).not.toHaveBeenCalled();
  });

  it('does NOT migrate sidecar for project files (UUID-keyed sidecars)', async () => {
    // File IS in a project root
    const PROJECT_ROOT = '/home/user/myproject';
    useWorkspaceStore.setState({
      projects: [{ path: PROJECT_ROOT, fileTree: [] }],
      explorerFolders: [],
      pinnedFiles: [],
    });

    const writeFileSpy = vi.fn().mockResolvedValue(undefined);
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('write_file', (args) => writeFileSpy(args));

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed(`${PROJECT_ROOT}/notes/foo.md`, `${PROJECT_ROOT}/notes/bar.md`);
    });

    await vi.runAllTimersAsync();

    // Should not write any sidecar for project files
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('migrates sidecars for all descendant files when a non-project folder is renamed', async () => {
    const OLD_FOLDER = '/home/user/Downloads/old-folder';
    const NEW_FOLDER = '/home/user/Downloads/new-folder';
    const file1NewPath = `${NEW_FOLDER}/a.md`;
    const file2NewPath = `${NEW_FOLDER}/b.md`;
    const file1OldPath = `${OLD_FOLDER}/a.md`;
    const file2OldPath = `${OLD_FOLDER}/b.md`;

    const hash1Old = hashPath(file1OldPath);
    const hash2Old = hashPath(file2OldPath);
    const sidecar1Old = `${NOTES_ROOT}/.notesage/comments/${hash1Old}.json`;
    const sidecar2Old = `${NOTES_ROOT}/.notesage/comments/${hash2Old}.json`;

    // list_directory for new folder returns file entries
    setMockInvokeHandler('list_directory', () => [
      { name: 'a.md', path: file1NewPath, is_directory: false, children: null, hidden: false },
      { name: 'b.md', path: file2NewPath, is_directory: false, children: null, hidden: false },
    ]);
    setMockInvokeHandler('path_exists', (args) => {
      const p = (args as { path: string }).path;
      return p === sidecar1Old || p === sidecar2Old;
    });
    setMockInvokeHandler('read_file', () => JSON.stringify([]));
    const writeFileSpy = vi.fn().mockResolvedValue(undefined);
    const deletePathSpy = vi.fn().mockResolvedValue(undefined);
    setMockInvokeHandler('write_file', (args) => writeFileSpy(args));
    setMockInvokeHandler('delete_path', (args) => deletePathSpy(args));

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed(OLD_FOLDER, NEW_FOLDER, true);
    });

    await vi.runAllTimersAsync();

    // Both descendant sidecars should be migrated
    expect(writeFileSpy).toHaveBeenCalledTimes(2);
    expect(deletePathSpy).toHaveBeenCalledTimes(2);
  });
});
