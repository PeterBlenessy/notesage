// @vitest-environment jsdom

/**
 * Integration tests for useFileRenameSync.
 * Verifies that the hook responds to `file-renamed` Tauri events by updating
 * editor-store tabs, workspace-store projects, and showing toast feedback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
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

// Track toast calls
const toastExternalRenameMock = vi.fn();
vi.mock('@/lib/notifications', () => ({
  toastExternalRename: toastExternalRenameMock,
  toastExternalChange: vi.fn(),
  toastExternalReload: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks are configured
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
    toastExternalRenameMock.mockClear();

    setMockInvokeHandler('list_directory', () => []);
    setMockInvokeHandler('path_exists', () => true);

    const mod = await import('@/hooks/useFileRenameSync');
    useFileRenameSync = mod.useFileRenameSync;
  });

  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // File rename — open tab path rewrite
  // ==========================================================================

  describe('file rename — open tab rewrite', () => {
    it('rewrites the tab filePath when a renamed file is open', async () => {
      useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
        await vi.advanceTimersByTimeAsync(300);
      });

      const state = useEditorStore.getState();
      expect(state.openDocuments[0].filePath).toBe('/project/notes/bar.md');
      expect(state.openDocuments[0].fileName).toBe('bar.md');
    });

    it('rewrites recentFiles entry for the renamed file', async () => {
      useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
        await vi.advanceTimersByTimeAsync(300);
      });

      const state = useEditorStore.getState();
      expect(state.recentFiles.some((rf) => rf.path === '/project/notes/bar.md')).toBe(true);
      expect(state.recentFiles.some((rf) => rf.path === '/project/notes/foo.md')).toBe(false);
    });

    it('does not rewrite any state when no tab matches the old path', async () => {
      useEditorStore.getState().openTab('/project/notes/other.md', 'other.md', '# Other');

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes/nonexistent.md', '/project/notes/bar.md');
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(useEditorStore.getState().openDocuments[0].filePath).toBe('/project/notes/other.md');
    });
  });

  // ==========================================================================
  // Folder rename — descendant cascade
  // ==========================================================================

  describe('folder rename — descendant cascade', () => {
    it('rewrites all descendant tab paths for a folder rename', async () => {
      useEditorStore.getState().openTab('/project/notes/a.md', 'a.md', '# A');
      useEditorStore.getState().openTab('/project/notes/sub/b.md', 'b.md', '# B');
      useEditorStore.getState().openTab('/project/other/c.md', 'c.md', '# C');

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes', '/project/renamed', true);
        await vi.advanceTimersByTimeAsync(300);
      });

      const docs = useEditorStore.getState().openDocuments;
      expect(docs.some((t) => t.filePath === '/project/renamed/a.md')).toBe(true);
      expect(docs.some((t) => t.filePath === '/project/renamed/sub/b.md')).toBe(true);
      expect(docs.some((t) => t.filePath === '/project/other/c.md')).toBe(true);
      expect(docs.some((t) => t.filePath.startsWith('/project/notes'))).toBe(false);
    });

    it('calls refreshFileTree for a folder rename', async () => {
      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes', '/project/renamed', true);
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Workspace project-root rename
  // ==========================================================================

  describe('project root rename', () => {
    it('calls workspace-store.updateProjectPath when a project root is renamed', async () => {
      useWorkspaceStore.getState().addProject('/project/myproject', []);

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/myproject', '/project/renamed', true);
        await vi.advanceTimersByTimeAsync(300);
      });

      const projects = useWorkspaceStore.getState().projects;
      expect(projects.some((p) => p.path === '/project/renamed')).toBe(true);
      expect(projects.some((p) => p.path === '/project/myproject')).toBe(false);
    });
  });

  // ==========================================================================
  // Dirty file toast
  // ==========================================================================

  describe('dirty file toast', () => {
    it('shows a sticky rename toast when the renamed file has unsaved edits', async () => {
      useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');
      // Mark as dirty
      useEditorStore.getState().updateTabContent(
        useEditorStore.getState().openDocuments[0].id,
        '# Foo edited',
        true
      );

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(toastExternalRenameMock).toHaveBeenCalledTimes(1);
      expect(toastExternalRenameMock).toHaveBeenCalledWith(
        'foo.md',
        'bar.md',
        expect.any(Function)
      );
    });

    it('does not show a toast when the renamed file has no unsaved edits', async () => {
      useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

      renderHook(() => useFileRenameSync());

      await act(async () => {
        emitFileRenamed('/project/notes/foo.md', '/project/notes/bar.md');
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(toastExternalRenameMock).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Listener registration
  // ==========================================================================

  describe('listener registration', () => {
    it('registers a listener for the file-renamed event on mount', async () => {
      const { getListenerCount } = await import('@/test/tauri-mock');
      renderHook(() => useFileRenameSync());
      expect(getListenerCount('file-renamed')).toBe(1);
    });
  });
});
