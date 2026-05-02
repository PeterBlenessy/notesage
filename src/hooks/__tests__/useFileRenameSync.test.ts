// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRefreshFileTree = vi.fn();
const mockToastExternalRename = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    refreshFileTree: mockRefreshFileTree,
  }),
  refreshGitForPath: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({
  toastExternalRename: (...args: unknown[]) => mockToastExternalRename(...args),
  toastExternalChange: vi.fn(),
  toastExternalReload: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import hook under test AFTER mocks
// ---------------------------------------------------------------------------

let useFileRenameSync: typeof import('@/hooks/useFileRenameSync').useFileRenameSync;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

function emitFileRenamed(payload: FileRenamedPayload) {
  emitMockEvent('file-renamed', payload);
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
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
  });
}

function makeTab(overrides: Partial<import('@/stores/editor-store').Tab> = {}): import('@/stores/editor-store').Tab {
  return {
    id: crypto.randomUUID(),
    filePath: '/project/notes/test.md',
    fileName: 'test.md',
    isDirty: false,
    content: '# Hello',
    frontmatter: null,
    fileType: 'markdown',
    contentLoaded: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileRenameSync', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    resetStores();
    mockRefreshFileTree.mockClear();
    mockToastExternalRename.mockClear();

    setMockInvokeHandler('get_home_dir', () => '/Users/testuser');
    setMockInvokeHandler('list_directory', () => []);
    setMockInvokeHandler('path_exists', () => true);

    const mod = await import('@/hooks/useFileRenameSync');
    useFileRenameSync = mod.useFileRenameSync;
  });

  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renames an open tab when a file-renamed event arrives for its path', async () => {
    const tab = makeTab({ filePath: '/project/notes/foo.md', fileName: 'foo.md' });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/project/notes/foo.md', new_path: '/project/notes/bar.md', is_directory: false });

    await vi.advanceTimersByTimeAsync(300);

    const state = useEditorStore.getState();
    expect(state.openDocuments[0].filePath).toBe('/project/notes/bar.md');
    expect(state.openDocuments[0].fileName).toBe('bar.md');
  });

  it('shows a dirty-file toast when the renamed file has unsaved edits', async () => {
    const tab = makeTab({
      filePath: '/project/notes/foo.md',
      fileName: 'foo.md',
      isDirty: true,
      content: 'unsaved edits',
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/project/notes/foo.md', new_path: '/project/notes/bar.md', is_directory: false });

    await vi.advanceTimersByTimeAsync(300);

    expect(mockToastExternalRename).toHaveBeenCalledWith(
      expect.objectContaining({
        oldPath: '/project/notes/foo.md',
        newPath: '/project/notes/bar.md',
      }),
    );
  });

  it('does NOT show a dirty toast when the renamed file is clean', async () => {
    const tab = makeTab({
      filePath: '/project/notes/clean.md',
      fileName: 'clean.md',
      isDirty: false,
    });
    useEditorStore.setState({ openDocuments: [tab], activeTabId: tab.id });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/project/notes/clean.md', new_path: '/project/notes/clean-renamed.md', is_directory: false });

    await vi.advanceTimersByTimeAsync(300);

    expect(mockToastExternalRename).not.toHaveBeenCalled();
  });

  it('rewrites all descendant tabs on folder rename', async () => {
    const tabA = makeTab({ filePath: '/project/old/a.md', fileName: 'a.md' });
    const tabB = makeTab({ filePath: '/project/old/sub/b.md', fileName: 'b.md' });
    const tabC = makeTab({ filePath: '/project/other/c.md', fileName: 'c.md' });
    useEditorStore.setState({ openDocuments: [tabA, tabB, tabC] });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/project/old', new_path: '/project/new', is_directory: true });

    await vi.advanceTimersByTimeAsync(300);

    const paths = useEditorStore.getState().openDocuments.map((t) => t.filePath);
    expect(paths).toContain('/project/new/a.md');
    expect(paths).toContain('/project/new/sub/b.md');
    expect(paths).toContain('/project/other/c.md');
  });

  it('calls workspace-store.updateProjectPath when a project root is renamed', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/project/myproject', fileTree: [] }],
    });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/project/myproject', new_path: '/project/renamed', is_directory: true });

    await vi.advanceTimersByTimeAsync(300);

    const projects = useWorkspaceStore.getState().projects;
    expect(projects[0].path).toBe('/project/renamed');
  });

  it('does not process file-renamed when neither old nor new path is relevant', async () => {
    const tab = makeTab({ filePath: '/project/notes/unrelated.md', fileName: 'unrelated.md' });
    useEditorStore.setState({ openDocuments: [tab] });

    renderHook(() => useFileRenameSync());

    emitFileRenamed({ old_path: '/totally/different/foo.md', new_path: '/totally/different/bar.md', is_directory: false });

    await vi.advanceTimersByTimeAsync(300);

    // Tab should be unchanged
    expect(useEditorStore.getState().openDocuments[0].filePath).toBe('/project/notes/unrelated.md');
  });
});
