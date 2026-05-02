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
const mockSaveFile = vi.fn();

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
// Save Now action wiring (Gap #10 from aw-review on #111)
// ---------------------------------------------------------------------------

describe('useFileRenameSync — Save Now action wiring', () => {
  it('invoking the Save Now toast action calls saveFile with the new path and tab content', async () => {
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

    // The dirty-tab path should call toast() (not toast.info()) with a Save now action
    expect(mockToastFn).toHaveBeenCalled();
    const toastOpts = mockToastFn.mock.calls[0][1] as Record<string, unknown>;
    expect(toastOpts?.action).toBeDefined();

    // Invoke the Save Now action — it should call saveFile on the new path
    await act(async () => {
      await (toastOpts.action as { onClick: () => Promise<void> }).onClick();
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      '/project/notes/bar.md',
      '# Unsaved edits',
      tab.id,
    );
  });
});

// ---------------------------------------------------------------------------
// Sidecar migration for non-project file renames (Gap #7 from aw-review on #111)
// ---------------------------------------------------------------------------

/** Same djb2-style hash used by useCommentOperations and useFileRenameSync. */
function hashPath(filePath: string): string {
  let h = 0;
  for (let i = 0; i < filePath.length; i++) {
    h = ((h << 5) - h + filePath.charCodeAt(i)) | 0;
  }
  return 'path-' + ((h >>> 0).toString(16));
}

describe('useFileRenameSync — sidecar migration for non-project files', () => {
  const notesRoot = '/home/user/Notesage';
  const oldFilePath = '/home/user/documents/old-note.md';
  const newFilePath = '/home/user/documents/renamed-note.md';

  function sidecarPath(filePath: string) {
    return `${notesRoot}/.notesage/comments/${hashPath(filePath)}.json`;
  }

  it('copies the comment sidecar to the new hash path when the sidecar exists', async () => {
    // File is not under any project root
    useWorkspaceStore.setState({ projects: [], explorerFolders: [], pinnedFiles: [] });
    useSettingsStore.setState({ notesRootPath: notesRoot } as Parameters<typeof useSettingsStore.setState>[0]);

    const commentContent = JSON.stringify([{ id: 'c1', text: 'hello' }]);

    setMockInvokeHandler('path_exists', (args) => {
      return (args as Record<string, string>).path === sidecarPath(oldFilePath);
    });
    setMockInvokeHandler('read_file', () => commentContent);

    const writeCalls: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('write_file', (args) => {
      writeCalls.push(args as Record<string, unknown>);
      return undefined;
    });

    setMockInvokeHandler('delete_path', () => undefined);

    renderHook(() => useFileRenameSync());

    await act(async () => {
      emitFileRenamed(oldFilePath, newFilePath, false);
    });

    expect(writeCalls.length).toBeGreaterThan(0);
    const writeToNew = writeCalls.find((c) => c.path === sidecarPath(newFilePath));
    expect(writeToNew).toBeDefined();
    expect(writeToNew?.content).toBe(commentContent);
  });

  it('deletes the old sidecar after a successful migration', async () => {
    useWorkspaceStore.setState({ projects: [], explorerFolders: [], pinnedFiles: [] });
    useSettingsStore.setState({ notesRootPath: notesRoot } as Parameters<typeof useSettingsStore.setState>[0]);

    const commentContent = JSON.stringify([{ id: 'c2', text: 'another comment' }]);

    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('read_file', () => commentContent);
    setMockInvokeHandler('write_file', () => undefined);

    const deleteCalls: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('delete_path', (args) => {
      deleteCalls.push(args as Record<string, unknown>);
      return undefined;
    });

    renderHook(() => useFileRenameSync());

    await act(async () => {
      emitFileRenamed(oldFilePath, newFilePath, false);
    });

    const deleteOfOld = deleteCalls.find((c) => c.path === sidecarPath(oldFilePath));
    expect(deleteOfOld).toBeDefined();
  });

  it('does nothing when no sidecar exists for the old path', async () => {
    useWorkspaceStore.setState({ projects: [], explorerFolders: [], pinnedFiles: [] });
    useSettingsStore.setState({ notesRootPath: notesRoot } as Parameters<typeof useSettingsStore.setState>[0]);

    setMockInvokeHandler('path_exists', () => false);

    const writeCalls: unknown[] = [];
    setMockInvokeHandler('write_file', (args) => { writeCalls.push(args); return undefined; });
    const deleteCalls: unknown[] = [];
    setMockInvokeHandler('delete_path', (args) => { deleteCalls.push(args); return undefined; });

    renderHook(() => useFileRenameSync());

    await act(async () => {
      emitFileRenamed(oldFilePath, newFilePath, false);
    });

    expect(writeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });
});
