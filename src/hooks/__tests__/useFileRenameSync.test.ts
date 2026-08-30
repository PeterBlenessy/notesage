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

describe('useFileRenameSync — the tree must follow a file rename (#788)', () => {
  // A captured article never appeared in Inbox until a manual refresh.
  //
  // The share extensions write through `NSFileCoordinator` with `.forReplacing`,
  // which is ATOMIC: the bytes are staged and RENAMED into place. `notify`
  // reports that as `Modify(Name(Both))`, and `process_watcher_events` routes
  // rename-both events to `file-renamed` while deliberately excluding them from
  // `file-changed-batch` — so the create-driven refresh in `useFileWatcher`
  // never runs for a shared article. Nothing told the tree the file existed.
  //
  // Folder renames already refreshed; file renames did not. That was an
  // asymmetry, not a decision: a rename changes what a directory contains,
  // which is exactly what the tree renders.
  it('refreshes the tree when a file is renamed into place', async () => {
    useWorkspaceStore.setState({ projects: [{ path: '/project', fileTree: [] }] });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/Inbox/.tmp-capture', '/project/Inbox/Article.html', false);
    });

    await vi.runAllTimersAsync();
    expect(mockRefreshFileTree).toHaveBeenCalledWith('/project/Inbox');
  });

  it('refreshes BOTH directories when a file moves between them', async () => {
    // A move changes two listings — the one the file left and the one it
    // arrived in. Refreshing only the destination leaves a ghost row behind.
    useWorkspaceStore.setState({ projects: [{ path: '/project', fileTree: [] }] });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/Inbox/a.md', '/project/Archive/a.md', false);
    });

    await vi.runAllTimersAsync();
    const dirs = mockRefreshFileTree.mock.calls.map((c) => c[0]);
    expect(new Set(dirs)).toEqual(new Set(['/project/Inbox', '/project/Archive']));
  });

  it('refreshes the containing directory once for an in-place rename', async () => {
    // Both parents are the same here; refreshing twice would re-list an iCloud
    // directory for no reason (~2 s per bare refresh).
    useWorkspaceStore.setState({ projects: [{ path: '/project', fileTree: [] }] });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/Inbox/old.md', '/project/Inbox/new.md', false);
    });

    await vi.runAllTimersAsync();
    expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    expect(mockRefreshFileTree).toHaveBeenCalledWith('/project/Inbox');
  });

  it('scopes the refresh rather than re-listing every section', async () => {
    // `refreshFileTree()` with no argument re-lists all sections, which is the
    // ~2 s stall on iCloud paths that the targeted form exists to avoid.
    useWorkspaceStore.setState({ projects: [{ path: '/project', fileTree: [] }] });

    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/Inbox/a.md', '/project/Inbox/b.md', false);
    });

    await vi.runAllTimersAsync();
    // Called at all — without this the loop below is vacuous and the test
    // passes with the refresh deleted, which is how it was first written.
    expect(mockRefreshFileTree).toHaveBeenCalled();
    for (const call of mockRefreshFileTree.mock.calls) {
      expect(call[0]).toBeTruthy();
    }
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

// ---------------------------------------------------------------------------
// RED tests: Folder rename — closed-tab sidecar reverse-lookup (issue #117)
// ---------------------------------------------------------------------------

describe('useFileRenameSync — folder rename: closed-tab sidecar reverse-lookup', () => {
  const NOTES_ROOT = '/Users/testuser/Notesage';

  it('migrates sidecar for closed-tab non-project file via originalPath reverse-lookup', async () => {
    const OLD_FOLDER = '/notes/docs';
    const NEW_FOLDER = '/notes/renamed';
    const OLD_FILE = `${OLD_FOLDER}/closed.md`;
    const NEW_FILE = `${NEW_FOLDER}/closed.md`;

    // NO open tabs — the file is closed
    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const oldSidecarFilePath = sidecarPath(NOTES_ROOT, OLD_FILE);
    const newSidecarFilePath = sidecarPath(NOTES_ROOT, NEW_FILE);
    const oldSidecarFilename = oldSidecarFilePath.split('/').pop()!;
    const commentsDir = `${NOTES_ROOT}/.notesage/comments`;

    const existingSidecar = JSON.stringify({
      originalPath: OLD_FILE,
      comments: [{ id: 'c1', body: 'test comment' }],
    });

    const writtenFiles: Array<{ path: string; content: string }> = [];
    const deletedPaths: string[] = [];

    setMockInvokeHandler('list_directory', (args) => {
      const { path } = args as { path: string };
      if (path === commentsDir) {
        return [{ name: oldSidecarFilename, path: oldSidecarFilePath, is_directory: false, hidden: false }];
      }
      return [];
    });
    setMockInvokeHandler('path_exists', (args) => {
      const { path } = args as { path: string };
      // old sidecar exists (so executeRenameTransaction proceeds with migration)
      // new sidecar does NOT exist (so collectClosedTabMigrationInputs includes it as not-yet-migrated)
      return path === oldSidecarFilePath;
    });
    setMockInvokeHandler('read_file', (args) => {
      if ((args as { path: string }).path === oldSidecarFilePath) return existingSidecar;
      return '[]';
    });
    setMockInvokeHandler('write_file', (args) => {
      const { path, content } = args as { path: string; content: string };
      writtenFiles.push({ path, content });
    });
    setMockInvokeHandler('delete_path', (args) => {
      deletedPaths.push((args as { path: string }).path);
    });

    renderHook(() => useFileRenameSync());
    act(() => { emitFileRenamed(OLD_FOLDER, NEW_FOLDER, true); });
    await vi.runAllTimersAsync();

    // New sidecar must be written to the new hash path
    const written = writtenFiles.find((w) => w.path === newSidecarFilePath);
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!.content);
    // originalPath must be updated to the new file path
    expect(parsed.originalPath).toBe(NEW_FILE);
    expect(parsed.comments).toHaveLength(1);

    // Old sidecar must be deleted
    expect(deletedPaths).toContain(oldSidecarFilePath);
  });

  it('skips reverse-lookup sidecar whose originalPath is inside a project root', async () => {
    const OLD_FOLDER = '/notes/docs';
    const NEW_FOLDER = '/notes/renamed';
    const PROJECT_ROOT = '/myproject';
    const PROJECT_FILE = `${PROJECT_ROOT}/nested/project-file.md`;

    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({
      projects: [{ path: PROJECT_ROOT, fileTree: [] }],
      pinnedFiles: [],
      explorerFolders: [],
    });

    const projectSidecarFilePath = sidecarPath(NOTES_ROOT, PROJECT_FILE);
    const projectSidecarFilename = projectSidecarFilePath.split('/').pop()!;
    const commentsDir = `${NOTES_ROOT}/.notesage/comments`;

    const existingSidecar = JSON.stringify({
      originalPath: PROJECT_FILE,
      comments: [{ id: 'c1', body: 'project comment' }],
    });

    const writtenFiles: string[] = [];
    const deletedPaths: string[] = [];

    setMockInvokeHandler('list_directory', (args) => {
      const { path } = args as { path: string };
      if (path === commentsDir) {
        return [{ name: projectSidecarFilename, path: projectSidecarFilePath, is_directory: false, hidden: false }];
      }
      return [];
    });
    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('read_file', () => existingSidecar);
    setMockInvokeHandler('write_file', (args) => {
      writtenFiles.push((args as { path: string }).path);
    });
    setMockInvokeHandler('delete_path', (args) => {
      deletedPaths.push((args as { path: string }).path);
    });

    renderHook(() => useFileRenameSync());
    act(() => { emitFileRenamed(OLD_FOLDER, NEW_FOLDER, true); });
    await vi.runAllTimersAsync();

    // Project files use UUID-keyed sidecars — must NOT be touched by path rename
    expect(writtenFiles).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });

  it('does not process sidecar with originalPath outside the renamed folder', async () => {
    const OLD_FOLDER = '/notes/docs';
    const NEW_FOLDER = '/notes/renamed';
    const UNRELATED_FILE = '/other-folder/unrelated.md';

    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    useSettingsStore.setState({ notesRootPath: NOTES_ROOT });
    useWorkspaceStore.setState({ projects: [], pinnedFiles: [], explorerFolders: [] });

    const unrelatedSidecarFilePath = sidecarPath(NOTES_ROOT, UNRELATED_FILE);
    const unrelatedSidecarFilename = unrelatedSidecarFilePath.split('/').pop()!;
    const commentsDir = `${NOTES_ROOT}/.notesage/comments`;

    const existingSidecar = JSON.stringify({
      originalPath: UNRELATED_FILE,
      comments: [{ id: 'c2', body: 'unrelated' }],
    });

    const writtenFiles: string[] = [];
    const deletedPaths: string[] = [];

    setMockInvokeHandler('list_directory', (args) => {
      const { path } = args as { path: string };
      if (path === commentsDir) {
        return [{ name: unrelatedSidecarFilename, path: unrelatedSidecarFilePath, is_directory: false, hidden: false }];
      }
      return [];
    });
    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('read_file', () => existingSidecar);
    setMockInvokeHandler('write_file', (args) => {
      writtenFiles.push((args as { path: string }).path);
    });
    setMockInvokeHandler('delete_path', (args) => {
      deletedPaths.push((args as { path: string }).path);
    });

    renderHook(() => useFileRenameSync());
    act(() => { emitFileRenamed(OLD_FOLDER, NEW_FOLDER, true); });
    await vi.runAllTimersAsync();

    // Unrelated sidecar must be left untouched
    expect(writtenFiles).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });
});
