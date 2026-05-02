// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { emitMockEvent, getListenerCount, registerDefaultHandlers } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRefreshFileTree = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    refreshFileTree: mockRefreshFileTree,
  }),
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

function resetStores() {
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    persistedTabs: [],
    persistedActiveFilePath: null,
  });

  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
}

function emitFileRenamed(oldPath: string, newPath: string, isDirectory = false) {
  emitMockEvent('file-renamed', { old_path: oldPath, new_path: newPath, is_directory: isDirectory });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useFileRenameSync', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    resetStores();
    mockRefreshFileTree.mockClear();
    registerDefaultHandlers();

    useFileRenameSync = (await import('@/hooks/useFileRenameSync')).useFileRenameSync;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Listener registration
  // -------------------------------------------------------------------------

  it('registers a listener for the file-renamed event on mount', () => {
    renderHook(() => useFileRenameSync());

    expect(getListenerCount('file-renamed')).toBe(1);
  });

  it('unregisters the listener on unmount', async () => {
    const { unmount } = renderHook(() => useFileRenameSync());
    expect(getListenerCount('file-renamed')).toBe(1);

    unmount();
    // Flush microtasks so the unlisten Promise cleanup resolves
    await vi.advanceTimersByTimeAsync(0);

    expect(getListenerCount('file-renamed')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Single file rename
  // -------------------------------------------------------------------------

  it('rewrites an open tab path when a tracked file is renamed externally', async () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', 'content');
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md', false);
    });

    const state = useEditorStore.getState();
    expect(state.openDocuments[0].filePath).toBe('/project/notes/bar.md');
    expect(state.openDocuments[0].fileName).toBe('bar.md');
  });

  it('rewrites the recentFiles entry when a tracked file is renamed externally', async () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', 'content');
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md', false);
    });

    const recents = useEditorStore.getState().recentFiles;
    expect(recents[0].path).toBe('/project/notes/bar.md');
    expect(recents[0].name).toBe('bar.md');
  });

  it('does nothing when the renamed file has no open tab', () => {
    useEditorStore.getState().openTab('/project/other.md', 'other.md', 'content');
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md', false);
    });

    // open tab for /project/other.md should be untouched
    expect(useEditorStore.getState().openDocuments[0].filePath).toBe('/project/other.md');
  });

  // -------------------------------------------------------------------------
  // Folder rename — cascade
  // -------------------------------------------------------------------------

  it('cascades a folder rename to all descendant open tabs', async () => {
    useEditorStore.getState().openTab('/project/old/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/project/old/sub/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/project/other/c.md', 'c.md', 'c');
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/old', '/project/new', true);
    });

    const docs = useEditorStore.getState().openDocuments;
    expect(docs[0].filePath).toBe('/project/new/a.md');
    expect(docs[1].filePath).toBe('/project/new/sub/b.md');
    expect(docs[2].filePath).toBe('/project/other/c.md');
  });

  it('calls refreshFileTree after a folder rename', async () => {
    useWorkspaceStore.getState().addProject('/project', []);
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/old', '/project/new', true);
    });

    expect(mockRefreshFileTree).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Project root rename
  // -------------------------------------------------------------------------

  it('calls workspace-store.updateProjectPath when a project root is renamed', async () => {
    useWorkspaceStore.getState().addProject('/project/myproject', []);
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/myproject', '/project/renamed', true);
    });

    const projects = useWorkspaceStore.getState().projects;
    expect(projects[0].path).toBe('/project/renamed');
  });

  it('does NOT call updateProjectPath when a non-root folder inside a project is renamed', async () => {
    useWorkspaceStore.getState().addProject('/project/myproject', []);
    renderHook(() => useFileRenameSync());

    act(() => {
      emitFileRenamed('/project/myproject/docs', '/project/myproject/notes', true);
    });

    // Project root unchanged
    const projects = useWorkspaceStore.getState().projects;
    expect(projects[0].path).toBe('/project/myproject');
    // But file tree refresh should still be triggered
    expect(mockRefreshFileTree).toHaveBeenCalled();
  });
});
