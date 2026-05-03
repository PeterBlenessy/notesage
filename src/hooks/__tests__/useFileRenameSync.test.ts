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

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

import { commentSidecarPath } from '@/lib/comment-storage';

function sidecarPath(notesRoot: string, filePath: string): string {
  return commentSidecarPath(notesRoot, filePath);
}

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
// RED tests: Save Now wiring (Gap #10)
// ---------------------------------------------------------------------------

describe('useFileRenameSync — Save Now wiring', () => {
  it('invoking the Save Now toast action calls saveFile with the new path and tab content', async () => {
    const NOTES_ROOT = '/Users/testuser/Notesage';
    const tab = makeTab({
      id: 'tab-dirty',
      filePath: '/notes/original.md',
      fileName: 'original.md',
      isDirty: true,
      content: '# Unsaved edits here',
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    // path_exists → false so sidecar migration is a no-op (not what we're testing here)
    setMockInvokeHandler('path_exists', () => false);

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/notes/original.md', '/notes/renamed.md');
    });

    await vi.runAllTimersAsync();

    // The sticky toast should have been called (dirty tab → onSave provided)
    expect(mockToastFn).toHaveBeenCalled();
    const [, toastOptions] = mockToastFn.mock.calls[0];
    expect(toastOptions?.action?.onClick).toBeDefined();

    // Invoke the "Save now" action
    await act(async () => {
      await toastOptions.action.onClick();
    });

    // saveFile must be called with the NEW path, the tab's content, and the tab id
    expect(mockSaveFile).toHaveBeenCalledWith('/notes/renamed.md', '# Unsaved edits here', 'tab-dirty');
  });
});

// ---------------------------------------------------------------------------
// RED tests: Sidecar migration (Gap #7)
// ---------------------------------------------------------------------------

describe('useFileRenameSync — sidecar migration', () => {
  const NOTES_ROOT = '/Users/testuser/Notesage';

  it('migrates sidecar to new hash path when a non-project file is renamed', async () => {
    const OLD_PATH = '/notes/foo.md';
    const NEW_PATH = '/notes/bar.md';
    const oldSidecar = sidecarPath(NOTES_ROOT, OLD_PATH);
    const newSidecar = sidecarPath(NOTES_ROOT, NEW_PATH);
    const sidecarContent = JSON.stringify([{ id: 'c1', body: 'a comment' }]);

    const tab = makeTab({ filePath: OLD_PATH, fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const writtenFiles: Array<{ path: string; content: string }> = [];
    setMockInvokeHandler('path_exists', (args) => (args as { path: string }).path === oldSidecar);
    setMockInvokeHandler('read_file', () => sidecarContent);
    setMockInvokeHandler('write_file', (args) => {
      const { path, content } = args as { path: string; content: string };
      writtenFiles.push({ path, content });
    });
    setMockInvokeHandler('delete_path', () => undefined);

    renderHook(() => useFileRenameSync());

    act(() => { emitFileRenamed(OLD_PATH, NEW_PATH); });
    await vi.runAllTimersAsync();

    expect(writtenFiles).toContainEqual({ path: newSidecar, content: sidecarContent });
  });

  it('deletes old sidecar after migrating for non-project file rename', async () => {
    const OLD_PATH = '/notes/foo.md';
    const NEW_PATH = '/notes/bar.md';
    const oldSidecar = sidecarPath(NOTES_ROOT, OLD_PATH);

    const tab = makeTab({ filePath: OLD_PATH, fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const deletedPaths: string[] = [];
    setMockInvokeHandler('path_exists', (args) => (args as { path: string }).path === oldSidecar);
    setMockInvokeHandler('read_file', () => '[]');
    setMockInvokeHandler('write_file', () => undefined);
    setMockInvokeHandler('delete_path', (args) => { deletedPaths.push((args as { path: string }).path); });

    renderHook(() => useFileRenameSync());

    act(() => { emitFileRenamed(OLD_PATH, NEW_PATH); });
    await vi.runAllTimersAsync();

    expect(deletedPaths).toContain(oldSidecar);
  });

  it('no-op when sidecar does not exist for non-project file rename', async () => {
    const tab = makeTab({ filePath: '/notes/nosidecar.md', fileName: 'nosidecar.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const writtenFiles: string[] = [];
    const deletedPaths: string[] = [];
    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('write_file', (args) => { writtenFiles.push((args as { path: string }).path); });
    setMockInvokeHandler('delete_path', (args) => { deletedPaths.push((args as { path: string }).path); });

    renderHook(() => useFileRenameSync());

    act(() => { emitFileRenamed('/notes/nosidecar.md', '/notes/renamed.md'); });
    await vi.runAllTimersAsync();

    expect(writtenFiles).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });

  it('skips sidecar migration when the file is inside a project', async () => {
    const tab = makeTab({ filePath: '/myproject/doc.md', fileName: 'doc.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({
      projects: [{ path: '/myproject', fileTree: [] }],
      pinnedFiles: [],
      explorerFolders: [],
    });

    const writtenFiles: string[] = [];
    const deletedPaths: string[] = [];
    setMockInvokeHandler('path_exists', () => true); // sidecar "exists" but should be skipped
    setMockInvokeHandler('write_file', (args) => { writtenFiles.push((args as { path: string }).path); });
    setMockInvokeHandler('delete_path', (args) => { deletedPaths.push((args as { path: string }).path); });

    renderHook(() => useFileRenameSync());

    act(() => { emitFileRenamed('/myproject/doc.md', '/myproject/renamed.md'); });
    await vi.runAllTimersAsync();

    // Project files use UUID-keyed sidecars — migration must NOT run
    expect(writtenFiles).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });

  it('migrates all descendant sidecars when a non-project folder is renamed', async () => {
    const OLD_FOLDER = '/notes/docs';
    const NEW_FOLDER = '/notes/renamed';
    const OLD_A = `${OLD_FOLDER}/a.md`;
    const OLD_B = `${OLD_FOLDER}/b.md`;
    const NEW_A = `${NEW_FOLDER}/a.md`;
    const NEW_B = `${NEW_FOLDER}/b.md`;

    const oldSidecarA = sidecarPath(NOTES_ROOT, OLD_A);
    const oldSidecarB = sidecarPath(NOTES_ROOT, OLD_B);
    const newSidecarA = sidecarPath(NOTES_ROOT, NEW_A);
    const newSidecarB = sidecarPath(NOTES_ROOT, NEW_B);

    const tabA = makeTab({ id: 'ta', filePath: OLD_A, fileName: 'a.md' });
    const tabB = makeTab({ id: 'tb', filePath: OLD_B, fileName: 'b.md' });
    useEditorStore.setState({ openDocuments: [tabA, tabB], activeTabId: tabA.id });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const oldSidecars = new Set([oldSidecarA, oldSidecarB]);
    const writtenFiles: Array<{ path: string; content: string }> = [];
    const deletedPaths: string[] = [];
    const CONTENT = '[{"id":"c1"}]';
    setMockInvokeHandler('path_exists', (args) => oldSidecars.has((args as { path: string }).path));
    setMockInvokeHandler('read_file', () => CONTENT);
    setMockInvokeHandler('write_file', (args) => {
      const { path, content } = args as { path: string; content: string };
      writtenFiles.push({ path, content });
    });
    setMockInvokeHandler('delete_path', (args) => { deletedPaths.push((args as { path: string }).path); });

    renderHook(() => useFileRenameSync());

    act(() => { emitFileRenamed(OLD_FOLDER, NEW_FOLDER, true); });
    await vi.runAllTimersAsync();

    // Both descendant sidecars must be migrated to new hash paths
    expect(writtenFiles).toContainEqual({ path: newSidecarA, content: CONTENT });
    expect(writtenFiles).toContainEqual({ path: newSidecarB, content: CONTENT });
    // Both old sidecars must be deleted
    expect(deletedPaths).toContain(oldSidecarA);
    expect(deletedPaths).toContain(oldSidecarB);
  });
});
