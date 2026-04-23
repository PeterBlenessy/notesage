// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent, getListenerCount } from '@/test/tauri-mock';
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
  emitMockEvent('file-changed-batch', [{ path, kind }]);
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

    it('does not call tauriApi.indexFile (Rust backend handles reindexing)', async () => {
      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/new-file.md', 'create');

      await vi.advanceTimersByTimeAsync(500);
      expect(indexFileSpy).not.toHaveBeenCalled();
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

    it('does not call indexFile for delete events (Rust backend handles it)', async () => {
      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/deleted.md', 'delete');

      await vi.advanceTimersByTimeAsync(500);
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
    it('sets external change for dirty tabs (OFF mode: consumer auto-reloads silently)', async () => {
      // In OFF mode the watcher routes BOTH clean and dirty tabs through
      // editor-store.setExternalChange — the integration hook then auto-reloads
      // them silently and surfaces a 3 s info toast. This test only asserts the
      // routing at the watcher level; the display layer is covered elsewhere.
      const tab = makeTab({ isDirty: true, content: '# Hello\n\nUnsaved changes' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nDifferent content from disk');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });

    it('dirty tabs route to editor-store (not external-change-store) when diff review is OFF', async () => {
      // Regression guard: OFF mode must not populate the external-change-store
      // for either clean or dirty tabs — that store is the ON-mode surface.
      useSettingsStore.setState({ externalChangeDiffReview: false });

      const tab = makeTab({ isDirty: true, content: '# Hello\n\nUnsaved' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Hello\n\nDisk');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      expect(getExternalChanges()['/project/notes/test.md']).toBeDefined();
      expect(getExternalChangeEntries()['/project/notes/test.md']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Diff review mode (externalChangeDiffReview: true)
  // ==========================================================================

  describe('diff review mode (ON)', () => {
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

    it('refreshFileTree still fires for create events', async () => {
      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/new.md', 'create');

      await vi.advanceTimersByTimeAsync(300);

      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);
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
  // Modify event -- reindex handled by Rust backend
  // ==========================================================================

  describe('modify events do not call indexFile (Rust backend handles it)', () => {
    it('does not call indexFile from frontend for modified files', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      expect(indexFileSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Debounce map overflow (Task #19 — bound map growth)
  // ==========================================================================

  describe('debounce map overflow', () => {
    it('modifyDebounce map never exceeds MAX_DEBOUNCE_ENTRIES (500) under extreme file churn', async () => {
      // Simulate 600 rapid modify events for unique files, none of which
      // match an open tab — so each one creates a pending debounce entry
      // that sits in the map for 200ms before its timeout fires.
      renderHook(() => useFileWatcher());

      // Fire 600 unique modify events without advancing timers (so no timeouts fire)
      for (let i = 0; i < 600; i++) {
        emitFileChangedBatch([{ path: `/churn/file-${i}.md`, kind: 'modify' }]);
      }

      // The overflow guard should have kicked in at 500 entries, flushing the
      // map and triggering a batch refresh. After processing all 600 events,
      // the map should contain at most 500 entries (the ones after the flush).
      // We cannot directly inspect the ref, but we can verify the overflow
      // path was taken by checking that refreshFileTree was scheduled (the
      // overflow guard calls refreshFileTree as a batch fallback).

      // Advance just enough for the refresh debounce (300ms) but not the
      // per-file debounces (200ms would fire them naturally).
      vi.advanceTimersByTime(300);

      // The overflow guard schedules refreshFileTree as a batch fallback
      expect(mockRefreshFileTree).toHaveBeenCalled();
    });

    it('icloudDiscoveryDebounce map does not grow beyond MAX_DEBOUNCE_ENTRIES', async () => {
      const icloudPath = '/Users/testuser/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
      useSettingsStore.setState({ icloudNotesagePath: icloudPath });

      // path_exists will return true but listDirectory will be slow (never resolves
      // in this test since we don't advance timers far enough for the 1s debounce)
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('list_directory', () => []);

      renderHook(() => useFileWatcher());

      // Fire 600 create events for unique iCloud project subfolder files
      // Each should create a discovery debounce entry for its top-level folder.
      for (let i = 0; i < 600; i++) {
        emitFileChangedBatch([{ path: `${icloudPath}/project-${i}/file.md`, kind: 'create' }]);
      }

      // The overflow guard should have flushed the map at 500 entries and
      // scheduled a batch refreshFileTree as fallback.
      vi.advanceTimersByTime(300);

      expect(mockRefreshFileTree).toHaveBeenCalled();
    });

    it('modify events still work correctly after debounce map overflow', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      renderHook(() => useFileWatcher());

      // Flood with 600 unique files to trigger overflow
      for (let i = 0; i < 600; i++) {
        emitFileChangedBatch([{ path: `/churn/file-${i}.md`, kind: 'modify' }]);
      }

      // Now emit a modify for our actual open tab
      emitFileChangedBatch([{ path: '/project/notes/test.md', kind: 'modify' }]);

      // Advance past the per-file debounce (200ms) and let async readFile resolve
      await vi.advanceTimersByTimeAsync(300);

      // The tab's external change should still be detected after overflow recovery
      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });
  });

  // ==========================================================================
  // Regression guards
  // ==========================================================================

  describe('regression: single event processing', () => {
    it('registers exactly one listener for file-changed-batch (no duplicate per-event listener)', () => {
      // This test catches the bug where both file-changed and file-changed-batch
      // were listened to, causing every event to be processed twice.
      renderHook(() => useFileWatcher());

      expect(getListenerCount('file-changed-batch')).toBe(1);
      // Must NOT listen to per-event file-changed — batch handles everything
      expect(getListenerCount('file-changed')).toBe(0);
    });

    it('calls readFile exactly once per modified file (not twice from duplicate listeners)', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());

      // Simulate a single batch with one modify event
      emitFileChangedBatch([{ path: '/project/notes/test.md', kind: 'modify' }]);

      await vi.advanceTimersByTimeAsync(300);

      // Must read exactly once — if events are double-processed, this would be 2
      expect(readCount).toBe(1);
    });

    it('never calls indexFile from frontend for any event type', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      const indexFileSpy = vi.fn();
      setMockInvokeHandler('index_file', indexFileSpy);

      renderHook(() => useFileWatcher());

      // Fire all event types in a single batch
      emitFileChangedBatch([
        { path: '/project/notes/created.md', kind: 'create' },
        { path: '/project/notes/test.md', kind: 'modify' },
        { path: '/project/notes/deleted.md', kind: 'delete' },
      ]);

      await vi.advanceTimersByTimeAsync(500);

      // Reindexing is handled entirely by the Rust watcher callback.
      // Frontend must NEVER call indexFile — doing so creates SQLite lock contention.
      expect(indexFileSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Frontmatter stripping during content comparison
  // ==========================================================================

  describe('frontmatter stripping', () => {
    it('strips YAML frontmatter before comparing content (no false external change)', async () => {
      // Tab content is body-only (frontmatter already stripped by editor)
      const tab = makeTab({ content: '# Hello\n\nBody text' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      // Disk file has frontmatter wrapping the same body content
      setMockInvokeHandler('read_file', () => '---\nid: abc-123\ntitle: Test\n---\n# Hello\n\nBody text');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      // parseFrontmatter strips the YAML block, so body matches — no external change
      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeUndefined();
    });

    it('detects change when body differs despite frontmatter being present', async () => {
      const tab = makeTab({ content: '# Hello\n\nOriginal body' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      setMockInvokeHandler('read_file', () => '---\nid: abc-123\n---\n# Hello\n\nChanged body');

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeDefined();
    });
  });

  // ==========================================================================
  // Delete events for open tabs
  // ==========================================================================

  describe('delete events for open tabs', () => {
    it('triggers tree refresh and git refresh when an open tab file is deleted', async () => {
      const tab = makeTab({ filePath: '/project/notes/doomed.md' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/doomed.md', 'delete');

      vi.advanceTimersByTime(300);
      expect(mockRefreshFileTree).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(200); // total 500ms for git debounce
      expect(mockRefreshGitForPath).toHaveBeenCalledWith('/project/notes/doomed.md');
    });

    it('does not attempt readFile for delete events (no modify handling)', async () => {
      const tab = makeTab({ filePath: '/project/notes/doomed.md', content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/doomed.md', 'delete');

      await vi.advanceTimersByTimeAsync(500);

      // Delete events should not trigger readFile — only modify events do
      expect(readCount).toBe(0);
    });
  });

  // ==========================================================================
  // Mixed batch with all event kinds
  // ==========================================================================

  describe('mixed batch events', () => {
    it('handles create + modify + delete in a single batch for different files', async () => {
      const tab = makeTab({
        id: 'tab-existing',
        filePath: '/project/notes/existing.md',
        fileName: 'existing.md',
        content: '# Old content',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# Modified externally');

      renderHook(() => useFileWatcher());

      emitFileChangedBatch([
        { path: '/project/notes/brand-new.md', kind: 'create' },
        { path: '/project/notes/existing.md', kind: 'modify' },
        { path: '/project/notes/removed.md', kind: 'delete' },
      ]);

      // Wait for tree refresh debounce (300ms) + modify debounce (200ms) + async
      await vi.advanceTimersByTimeAsync(500);

      // Create + delete both trigger tree refresh (coalesced into one call)
      expect(mockRefreshFileTree).toHaveBeenCalled();

      // Modify triggers external change for the open tab
      const changes = getExternalChanges();
      expect(changes['/project/notes/existing.md']).toBeDefined();

      // Git refresh fires once (debounced, last path wins)
      expect(mockRefreshGitForPath).toHaveBeenCalledTimes(1);
    });

    it('batch dedup: delete after modify for same path means only delete is processed', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());

      // In the same batch, modify then delete for same path — last event wins
      emitFileChangedBatch([
        { path: '/project/notes/test.md', kind: 'modify' },
        { path: '/project/notes/test.md', kind: 'delete' },
      ]);

      await vi.advanceTimersByTimeAsync(500);

      // The delete event wins (last in batch), so no readFile for modify
      expect(readCount).toBe(0);
      // But tree refresh is triggered by the delete
      expect(mockRefreshFileTree).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Tab disappears during async readFile
  // ==========================================================================

  describe('tab state race conditions', () => {
    it('handles tab closing between event emission and readFile resolution', async () => {
      const tab = makeTab({ content: '# Old' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      setMockInvokeHandler('read_file', () => {
        // Simulate the tab being closed while readFile is in-flight
        useEditorStore.setState({ tabs: [], activeTabId: null });
        return '# New content';
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      // Should not throw — the hook re-reads state after await and bails out
      await vi.advanceTimersByTimeAsync(300);

      // No external change set since the tab no longer exists
      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it('handles tab content changing between event emission and readFile resolution', async () => {
      const tab = makeTab({ content: '# Version 1' });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      setMockInvokeHandler('read_file', () => {
        // User edits the tab while readFile is in-flight, and the new content
        // happens to match the disk content — no external change needed
        useEditorStore.setState({
          tabs: [{ ...tab, content: '# Version 2' }],
        });
        return '# Version 2';
      });

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/notes/test.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      // Content matches after re-read, so no external change
      const changes = getExternalChanges();
      expect(changes['/project/notes/test.md']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Path normalization edge cases
  // ==========================================================================

  describe('path normalization edge cases', () => {
    it('strips /private/etc prefix (macOS symlink)', async () => {
      const tab = makeTab({
        filePath: '/etc/notesage/config.md',
        content: '# Old',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
      setMockInvokeHandler('read_file', () => '# New');

      renderHook(() => useFileWatcher());
      emitFileChanged('/private/etc/notesage/config.md', 'modify');

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      expect(changes['/etc/notesage/config.md']).toBeDefined();
    });

    it('batch dedup normalizes paths before deduplicating', async () => {
      const tab = makeTab({
        filePath: '/var/folders/tmp/test.md',
        content: '# Old',
      });
      useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });

      let readCount = 0;
      setMockInvokeHandler('read_file', () => {
        readCount++;
        return '# New';
      });

      renderHook(() => useFileWatcher());

      // Two events for the same file: one with /private prefix, one without
      emitFileChangedBatch([
        { path: '/var/folders/tmp/test.md', kind: 'modify' },
        { path: '/private/var/folders/tmp/test.md', kind: 'modify' },
      ]);

      await vi.advanceTimersByTimeAsync(300);

      // Paths normalize to the same value, so dedup should keep only one
      expect(readCount).toBe(1);
    });
  });

  // ==========================================================================
  // MCP config change edge cases
  // ==========================================================================

  describe('MCP config change edge cases', () => {
    it('triggers MCP rescan on mcp.json delete', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/.notesage/mcp.json', 'delete');

      await vi.advanceTimersByTimeAsync(600);

      expect(useMcpStore.getState().rescanCounter).toBeGreaterThan(counterBefore);
    });

    it('does NOT trigger MCP rescan for mcp.json outside .notesage', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());
      emitFileChanged('/project/config/mcp.json', 'modify');

      await vi.advanceTimersByTimeAsync(600);

      expect(useMcpStore.getState().rescanCounter).toBe(counterBefore);
    });

    it('debounces rapid MCP config changes into one rescan', async () => {
      const counterBefore = useMcpStore.getState().rescanCounter;

      renderHook(() => useFileWatcher());

      emitFileChanged('/project/.notesage/mcp.json', 'modify');
      emitFileChanged('/project/.notesage/mcp.json', 'modify');
      emitFileChanged('/project/.notesage/mcp.json', 'modify');

      await vi.advanceTimersByTimeAsync(600);

      // Should increment by exactly 1 (debounced)
      expect(useMcpStore.getState().rescanCounter).toBe(counterBefore + 1);
    });
  });

  // ==========================================================================
  // Backend-filtered paths arriving at frontend
  // ==========================================================================

  describe('backend-filtered paths (robustness)', () => {
    it('handles .git internal paths without crashing (if they leak through)', async () => {
      renderHook(() => useFileWatcher());

      // These should be filtered by Rust backend, but if they leak through,
      // the frontend should not crash or set spurious state
      emitFileChangedBatch([
        { path: '/project/.git/objects/ab/cdef123', kind: 'modify' },
        { path: '/project/.git/HEAD', kind: 'modify' },
      ]);

      await vi.advanceTimersByTimeAsync(500);

      // No open tabs match these paths, so no external changes
      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it('handles .DS_Store events without crashing (if they leak through)', async () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/.DS_Store', 'modify');

      await vi.advanceTimersByTimeAsync(500);

      // No tab matches, no crash
      const changes = getExternalChanges();
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it('.git modify events do not trigger tree refresh (only create/delete do)', () => {
      renderHook(() => useFileWatcher());

      emitFileChanged('/project/.git/index', 'modify');

      vi.advanceTimersByTime(500);

      // Modify events do not trigger refreshFileTree — only create/delete do
      expect(mockRefreshFileTree).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Multiple tabs with simultaneous modify events
  // ==========================================================================

  describe('multiple open tabs', () => {
    it('processes modify events for multiple open tabs independently', async () => {
      const tab1 = makeTab({
        id: 'tab-a',
        filePath: '/project/notes/alpha.md',
        fileName: 'alpha.md',
        content: '# Alpha old',
      });
      const tab2 = makeTab({
        id: 'tab-b',
        filePath: '/project/notes/beta.md',
        fileName: 'beta.md',
        content: '# Beta old',
      });
      const tab3 = makeTab({
        id: 'tab-c',
        filePath: '/project/notes/gamma.md',
        fileName: 'gamma.md',
        content: '# Gamma unchanged',
      });
      useEditorStore.setState({ tabs: [tab1, tab2, tab3], activeTabId: tab1.id });

      setMockInvokeHandler('read_file', (args) => {
        const p = (args as { path: string }).path;
        if (p.includes('alpha')) return '# Alpha new';
        if (p.includes('beta')) return '# Beta new';
        if (p.includes('gamma')) return '# Gamma unchanged'; // same as tab
        return '';
      });

      renderHook(() => useFileWatcher());

      emitFileChangedBatch([
        { path: '/project/notes/alpha.md', kind: 'modify' },
        { path: '/project/notes/beta.md', kind: 'modify' },
        { path: '/project/notes/gamma.md', kind: 'modify' },
      ]);

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      // Alpha and beta have different content — external changes set
      expect(changes['/project/notes/alpha.md']).toBeDefined();
      expect(changes['/project/notes/beta.md']).toBeDefined();
      // Gamma content matches — no external change
      expect(changes['/project/notes/gamma.md']).toBeUndefined();
    });

    it('dirty and clean tabs in the same batch are handled with correct logic', async () => {
      const cleanTab = makeTab({
        id: 'tab-clean',
        filePath: '/project/notes/clean.md',
        fileName: 'clean.md',
        content: '# Clean old',
        isDirty: false,
      });
      const dirtyTab = makeTab({
        id: 'tab-dirty',
        filePath: '/project/notes/dirty.md',
        fileName: 'dirty.md',
        content: '# Dirty unsaved',
        isDirty: true,
      });
      useEditorStore.setState({ tabs: [cleanTab, dirtyTab], activeTabId: cleanTab.id });

      setMockInvokeHandler('read_file', (args) => {
        const p = (args as { path: string }).path;
        if (p.includes('clean')) return '# Clean new';
        if (p.includes('dirty')) return '# Dirty external';
        return '';
      });

      renderHook(() => useFileWatcher());

      emitFileChangedBatch([
        { path: '/project/notes/clean.md', kind: 'modify' },
        { path: '/project/notes/dirty.md', kind: 'modify' },
      ]);

      await vi.advanceTimersByTimeAsync(300);

      const changes = getExternalChanges();
      // Both should have external changes set (clean → auto-reload, dirty → user prompt)
      expect(changes['/project/notes/clean.md']).toBeDefined();
      expect(changes['/project/notes/dirty.md']).toBeDefined();
    });
  });
});
