// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useExternalChangeStore } from '@/stores/external-change-store';
import { useDiffReviewStore } from '@/stores/diff-review-store';
import { useMcpStore } from '@/stores/mcp-store';
// useSyncStore imported by module under test

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRefreshFileTree = vi.fn();
const mockRefreshGitForPath = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    refreshFileTree: mockRefreshFileTree,
  }),
  refreshGitForPath: mockRefreshGitForPath,
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

// ---------------------------------------------------------------------------
// Import the hook under test AFTER mocks are configured
// ---------------------------------------------------------------------------

let useFileWatcher: typeof import('@/hooks/useFileWatcher').useFileWatcher;

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
    tabs: [],
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
  });

  useSettingsStore.setState({
    gitEnabled: false,
    externalChangeDiffReview: false,
    icloudNotesagePath: null,
    notesRootPath: '/Users/testuser/Notesage',
  });

  useExternalChangeStore.setState({
    changes: {},
  });

  useDiffReviewStore.setState({
    reviewActive: false,
  });
}

function emitFileChanged(path: string, kind: 'create' | 'modify' | 'delete') {
  emitMockEvent('file-changed', { path, kind });
}

function emitFileChangedBatch(events: Array<{ path: string; kind: 'create' | 'modify' | 'delete' }>) {
  emitMockEvent('file-changed-batch', events);
}

/** Check if setExternalChange was triggered by looking at store state. */
function getExternalChanges() {
  return useEditorStore.getState().externalChanges;
}

/** Check external-change-store entries. */
function getExternalChangeEntries() {
  return useExternalChangeStore.getState().changes;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useFileWatcher', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    resetStores();
    mockRefreshFileTree.mockClear();
    mockRefreshGitForPath.mockClear();

    // Register default handlers
    setMockInvokeHandler('read_file', () => '# Hello\n\nNew content from disk');
    setMockInvokeHandler('index_file', () => undefined);
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('list_directory', () => []);
    setMockInvokeHandler('get_home_dir', () => '/Users/testuser');

    // Dynamic import to pick up mocks
    const mod = await import('@/hooks/useFileWatcher');
    useFileWatcher = mod.useFileWatcher;
  });

  afterEach(async () => {
    // Flush any remaining async timers/microtasks to avoid leakage into the next test
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Create events
  // ==========================================================================

  describe('create events', () => {
    it('debounces refreshFileTree on create events', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/new-file.md', 'create');

      // Not called immediately -- debounced at 300ms
      expect(mockRefreshFileTree).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid create events into a single refreshFileTree call', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/file1.md', 'create');
      emitFileChanged('/project/notes/file2.md', 'create');
      emitFileChanged('/project/notes/file3.md', 'create');

      vi.advanceTimersByTime(300);
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });

    it('calls tauriApi.indexFile for created files', async () => {
      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/new-file.md', 'create');

      // indexFile is called directly (not debounced on the same timer)
      await vi.advanceTimersByTimeAsync(50);
      expect(indexFileSpy).toHaveBeenCalled();
    });

    it('triggers debounced git refresh on create', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/new-file.md', 'create');
      vi.advanceTimersByTime(500);

      expect(mockRefreshGitForPath).toHaveBeenCalledWith('/project/notes/new-file.md');
    });
  });

  // ==========================================================================
  // Delete events
  // ==========================================================================

  describe('delete events', () => {
    it('debounces refreshFileTree on delete events', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/deleted.md', 'delete');

      expect(mockRefreshFileTree).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });

    it('does NOT call indexFile for delete events', async () => {
      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/deleted.md', 'delete');

      await vi.advanceTimersByTimeAsync(500);
      // indexFile is only called for create and modify, not delete
      expect(indexFileSpy).not.toHaveBeenCalled();
    });

    it('triggers debounced git refresh on delete', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/deleted.md', 'delete');
      vi.advanceTimersByTime(500);

      expect(mockRefreshGitForPath).toHaveBeenCalledWith('/project/notes/deleted.md');
    });
  });

  // ==========================================================================
  // Modify events -- clean tab auto-reload
  // ==========================================================================

  describe('modify events -- clean tab (auto-reload)', () => {
    it('sets external change for clean tabs with different content', async () => {
      const tab = makeTab({ content: '# Hello\n\nOriginal content' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nNew content from disk');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      // Wait for per-file debounce (200ms) + async readFile
      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });

    it('skips update when disk content matches tab content', async () => {
      const tab = makeTab({ content: '# Hello\n\nOriginal content' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      // parseFrontmatter strips frontmatter, so return raw content without frontmatter
      setMockInvokeHandler('read_file', () => '# Hello\n\nOriginal content');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeUndefined();
    });

    it('skips update when disk content matches lastSavedContent', async () => {
      const tab = makeTab({
        content: '# Hello\n\nEdited after save',
        isDirty: true,
        lastSavedContent: '# Hello\n\nSaved content',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      // parseFrontmatter returns content after stripping frontmatter
      setMockInvokeHandler('read_file', () => '# Hello\n\nSaved content');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Modify events -- dirty tab
  // ==========================================================================

  describe('modify events -- dirty tab', () => {
    it('sets external change for dirty tabs (prompts user)', async () => {
      const tab = makeTab({ isDirty: true, content: '# Hello\n\nUnsaved changes' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nDifferent content from disk');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });
  });

  // ==========================================================================
  // Diff review beta mode
  // ==========================================================================

  describe('diff review beta mode', () => {
    it('routes clean tab changes to external-change-store when diff review is enabled', async () => {
      useSettingsStore.setState({ externalChangeDiffReview: true });

      const tab = makeTab({ content: '# Hello\n\nOriginal' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nModified externally');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const entries = getExternalChangeEntries();
      expect(entries['/project/notes/test.md']).toBeDefined();
      expect(entries['/project/notes/test.md'].newContent).toBe('# Hello\n\nModified externally');
    });

    it('skips duplicate changes with same new content in diff review mode', async () => {
      useSettingsStore.setState({ externalChangeDiffReview: true });

      const tab = makeTab({ content: '# Hello\n\nOriginal' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nModified externally');

      // Pre-populate with the same change
      useExternalChangeStore.getState().addChange(
        '/project/notes/test.md',
        'test.md',
        '# Hello\n\nOriginal',
        '# Hello\n\nModified externally',
      );

      // Record current timestamp to detect if addChange is called again
      const existingEntry = getExternalChangeEntries()['/project/notes/test.md'];
      const existingTimestamp = existingEntry?.timestamp;

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      // Timestamp should not have changed (no new addChange call)
      const updatedEntry = getExternalChangeEntries()['/project/notes/test.md'];
      expect(updatedEntry?.timestamp).toBe(existingTimestamp);
    });

    it('auto-accepts via setExternalChange when git branch diff review is active', async () => {
      useDiffReviewStore.setState({ reviewActive: true });

      const tab = makeTab({ content: '# Hello\n\nOriginal' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nGit-modified');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });
  });

  // ==========================================================================
  // No matching tab
  // ==========================================================================

  describe('no matching tab', () => {
    it('does not set external change when no tab matches the path', async () => {
      useEditorStore.setState({ tabs: [], activeTabId: null });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/untracked.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Path normalization
  // ==========================================================================

  describe('path normalization', () => {
    it('strips /private/var prefix (macOS FSEvents symlink)', async () => {
      const tab = makeTab({
        filePath: '/var/folders/tmp/test.md',
        content: '# Old',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      renderHook(() => useFileWatcher());
      // FSEvents reports with /private prefix
      emitFileChanged('/private/var/folders/tmp/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/var/folders/tmp/test.md']).toBeDefined();
    });

    it('strips /private/tmp prefix', async () => {
      const tab = makeTab({
        filePath: '/tmp/test-notes/test.md',
        content: '# Old',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      renderHook(() => useFileWatcher());
      emitFileChanged('/private/tmp/test-notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/tmp/test-notes/test.md']).toBeDefined();
    });

    it('does NOT strip /private/Users (not a known symlink)', async () => {
      // A tab at /Users/... should NOT match /private/Users/...
      const tab = makeTab({
        filePath: '/Users/testuser/notes/test.md',
        content: '# Old',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      renderHook(() => useFileWatcher());
      // /private/Users is NOT a symlink, so the path should not be normalized
      emitFileChanged('/private/Users/testuser/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      // The normalized path retains /private/Users so no tab matches
      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it('strips trailing slashes from paths', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/', 'create');
      vi.advanceTimersByTime(300);

      // Should still trigger refreshFileTree (create event)
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Debouncing -- per-file modify coalescing
  // ==========================================================================

  describe('debouncing', () => {
    it('coalesces duplicate modify events for the same file', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());

      // Fire multiple modifies for same file in rapid succession
      emitFileChanged('/project/notes/test.md', 'modify');
      vi.advanceTimersByTime(50);
      emitFileChanged('/project/notes/test.md', 'modify');
      vi.advanceTimersByTime(50);
      emitFileChanged('/project/notes/test.md', 'modify');

      // Wait for debounce to fire
      await vi.advanceTimersByTimeAsync(300);

      // Only one readFile call (the last debounce wins)
      expect(readCount).toBe(1);
    });

    it('handles independent files in parallel', async () => {
      const tab1 = makeTab({
        id: 'tab-1',
        filePath: '/project/notes/file1.md',
        fileName: 'file1.md',
        content: '# File1 Old',
      });
      const tab2 = makeTab({
        id: 'tab-2',
        filePath: '/project/notes/file2.md',
        fileName: 'file2.md',
        content: '# File2 Old',
      });
      useEditorStore.setState({ tabs: [tab1, tab2], activeTabId: tab1.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', (args) => {
        readCount++;
        const p = (args as { path: string }).path;
        return p.includes('file1') ? '# File1 New' : '# File2 New';
      });

      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/file1.md', 'modify');
      emitFileChanged('/project/notes/file2.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      // Both files should be read independently
      expect(readCount).toBe(2);
    });
  });

  // ==========================================================================
  // Batch events (file-changed-batch)
  // ==========================================================================

  describe('batch events', () => {
    it('deduplicates events in a batch (last event wins per path)', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());

      // Batch with multiple events for the same file
      emitFileChangedBatch([
        { path: '/project/notes/test.md', kind: 'create' },
        { path: '/project/notes/test.md', kind: 'modify' },
        { path: '/project/notes/test.md', kind: 'modify' },
      ]);

      await vi.advanceTimersByTimeAsync(300);

      // Last event for test.md is 'modify' -- only one read should happen
      expect(readCount).toBe(1);
    });

    it('handles empty batch gracefully', () => {
      renderHook(() => useFileWatcher());

      emitFileChangedBatch([]);
      vi.advanceTimersByTime(300);

      expect(mockRefreshFileTree).not.toHaveBeenCalled();
    });

    it('processes distinct files in batch', () => {
      renderHook(() => useFileWatcher());

      emitFileChangedBatch([
        { path: '/project/a.md', kind: 'create' },
        { path: '/project/b.md', kind: 'create' },
      ]);

      vi.advanceTimersByTime(300);

      // Creates coalesce into one refreshFileTree call
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // MCP config changes
  // ==========================================================================

  describe('MCP config changes', () => {
    it('triggers MCP rescan when .notesage/mcp.json is modified', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());

      emitFileChanged('/Users/testuser/.notesage/mcp.json', 'modify');

      // getHomeDir is async, then 500ms debounce
      await vi.advanceTimersByTimeAsync(600);

      expect(useMcpStore.getState().rescanCounter).toBeGreaterThan(counterBefore);
    });

    it('triggers MCP rescan when project .notesage/mcp.json is created', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());

      emitFileChanged('/project/.notesage/mcp.json', 'create');

      await vi.advanceTimersByTimeAsync(600);

      expect(useMcpStore.getState().rescanCounter).toBeGreaterThan(counterBefore);
    });

    it('does NOT trigger MCP rescan for non-mcp.json files in .notesage', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());

      emitFileChanged('/project/.notesage/project.json', 'modify');

      await vi.advanceTimersByTimeAsync(600);

      expect(useMcpStore.getState().rescanCounter).toBe(counterBefore);
    });
  });

  // ==========================================================================
  // iCloud discovery
  // ==========================================================================

  describe('iCloud project discovery', () => {
    it('discovers new iCloud projects on create events', async () => {
      const icloudPath = '/Users/testuser/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
      useSettingsStore.setState({ icloudNotesagePath: icloudPath });

      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('list_directory', () => [
        { name: 'note.md', path: `${icloudPath}/NewProject/note.md`, is_directory: false },
      ]);

      const projectCountBefore = useWorkspaceStore.getState().projects.length;

      renderHook(() => useFileWatcher());

      emitFileChanged(`${icloudPath}/NewProject/note.md`, 'create');

      // 1000ms iCloud discovery debounce + async pathExists + listDirectory
      await vi.advanceTimersByTimeAsync(1200);

      const projects = useWorkspaceStore.getState().projects;
      expect(projects.length).toBeGreaterThan(projectCountBefore);
      expect(projects.some((p: { path: string }) => p.path === `${icloudPath}/NewProject`)).toBe(true);
    });

    it('skips iCloud discovery for already-known projects', async () => {
      const icloudPath = '/Users/testuser/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
      useSettingsStore.setState({ icloudNotesagePath: icloudPath });

      // Add an existing project to the workspace store
      const existingProjects = useWorkspaceStore.getState().projects;
      useWorkspaceStore.setState({
        projects: [
          ...existingProjects,
          { path: `${icloudPath}/ExistingProject`, tree: [], name: 'ExistingProject' },
        ],
      } as never);

      const projectCountBefore = useWorkspaceStore.getState().projects.length;

      renderHook(() => useFileWatcher());

      emitFileChanged(`${icloudPath}/ExistingProject/file.md`, 'create');

      await vi.advanceTimersByTimeAsync(1200);

      // Project count should not change -- already known
      expect(useWorkspaceStore.getState().projects.length).toBe(projectCountBefore);
    });

    it('skips iCloud discovery when icloudNotesagePath is not set', async () => {
      useSettingsStore.setState({ icloudNotesagePath: null });

      const projectCountBefore = useWorkspaceStore.getState().projects.length;

      renderHook(() => useFileWatcher());

      emitFileChanged('/some/random/path/file.md', 'create');

      await vi.advanceTimersByTimeAsync(1200);

      expect(useWorkspaceStore.getState().projects.length).toBe(projectCountBefore);
    });

    it('skips iCloud discovery when .notesage metadata is missing', async () => {
      const icloudPath = '/Users/testuser/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
      useSettingsStore.setState({ icloudNotesagePath: icloudPath });

      setMockInvokeHandler('path_exists', () => false);

      const projectCountBefore = useWorkspaceStore.getState().projects.length;

      renderHook(() => useFileWatcher());

      emitFileChanged(`${icloudPath}/NoMetadata/file.md`, 'create');

      await vi.advanceTimersByTimeAsync(1200);

      expect(useWorkspaceStore.getState().projects.length).toBe(projectCountBefore);
    });
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('clears all timers on unmount', () => {
      const { unmount } = renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/file.md', 'create');
      emitFileChanged('/project/notes/test.md', 'modify');

      unmount();

      // Advance timers -- nothing should fire since cleanup cleared them
      vi.advanceTimersByTime(1000);

      expect(mockRefreshFileTree).not.toHaveBeenCalled();
    });

    it('unregisters event listeners on unmount', async () => {
      const { unmount } = renderHook(() => useFileWatcher());

      // Need to wait for the async unlisten promises to resolve
      await vi.advanceTimersByTimeAsync(0);

      unmount();

      // Wait for cleanup promises
      await vi.advanceTimersByTimeAsync(0);

      // Emit events after unmount -- should not trigger anything
      emitFileChanged('/project/notes/file.md', 'create');
      vi.advanceTimersByTime(500);

      expect(mockRefreshFileTree).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================

  describe('error handling', () => {
    it('handles readFile errors gracefully without crashing', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      setMockInvokeHandler('read_file', () => {
        throw new Error('File not found');
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      // Should not throw -- error is caught internally
      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it('handles indexFile errors gracefully for create events', async () => {
      setMockInvokeHandler('index_file', () => {
        throw new Error('Index failed');
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/new.md', 'create');

      // Should not throw -- error is caught in .catch()
      await vi.advanceTimersByTimeAsync(300);

      // refreshFileTree still fires despite indexFile error
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
    });

    it('handles indexFile errors gracefully for modify events', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      setMockInvokeHandler('read_file', () => '# New');
      setMockInvokeHandler('index_file', () => {
        throw new Error('Index failed');
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      // Should not crash
      await vi.advanceTimersByTimeAsync(300);
    });
  });

  // ==========================================================================
  // Git refresh debouncing
  // ==========================================================================

  describe('git refresh', () => {
    it('debounces git refresh at 500ms', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/test.md', 'modify');

      vi.advanceTimersByTime(200);
      expect(mockRefreshGitForPath).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(mockRefreshGitForPath).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid events into one git refresh', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/notes/a.md', 'modify');
      vi.advanceTimersByTime(100);
      emitFileChanged('/project/notes/b.md', 'create');
      vi.advanceTimersByTime(100);
      emitFileChanged('/project/notes/c.md', 'delete');

      vi.advanceTimersByTime(500);
      // The git debounce timer keeps getting reset, so only the last path fires
      expect(mockRefreshGitForPath).toHaveBeenCalledTimes(1);
      expect(mockRefreshGitForPath).toHaveBeenCalledWith('/project/notes/c.md');
    });
  });

  // ==========================================================================
  // Modify event -- reindex
  // ==========================================================================

  describe('modify events call indexFile', () => {
    it('calls indexFile for modified files after debounce', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      expect(indexFileSpy).toHaveBeenCalled();
    });
  });
});
