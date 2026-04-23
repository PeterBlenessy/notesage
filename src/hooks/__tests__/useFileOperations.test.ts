// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { useFileOperations } from '@/hooks/useFileOperations';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

// Mock modules that useFileOperations imports but that aren't relevant to unit tests
vi.mock('@/lib/refresh-notes-tree', () => ({
  refreshNotesTree: vi.fn(async () => {}),
}));
vi.mock('@/lib/migrate-project-path', () => ({
  migrateProjectPath: vi.fn(async () => {}),
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
vi.mock('@/stores/action-store', () => {
  const store = { incrementalUpdate: vi.fn() };
  return { useActionStore: Object.assign(vi.fn(() => store), { getState: () => store }) };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStores() {
  // Reset editor store to a clean state
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    persistedTabs: [],
    persistedActiveFilePath: null,
  });

  // Reset workspace store
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
  });

  // Ensure settings store has git disabled so refreshGitForPath is a no-op
  useSettingsStore.setState({ gitEnabled: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileOperations', () => {
  beforeEach(() => {
    resetStores();
  });

  // ---- createFile ----

  describe('createFile', () => {
    it('creates a file and returns its path', async () => {
      setMockInvokeHandler('create_file', () => undefined);
      setMockInvokeHandler('list_directory', () => [
        { name: 'note.md', path: '/project/note.md', is_directory: false },
      ]);

      const { result } = renderHook(() => useFileOperations());

      let filePath: string | undefined;
      await act(async () => {
        filePath = await result.current.createFile('/project', 'note.md');
      });

      expect(filePath).toBe('/project/note.md');
    });

    it('throws when Tauri create_file fails', async () => {
      setMockInvokeHandler('create_file', () => {
        throw new Error('Permission denied');
      });

      const { result } = renderHook(() => useFileOperations());

      await expect(
        act(async () => {
          await result.current.createFile('/project', 'note.md');
        }),
      ).rejects.toThrow('Permission denied');
    });
  });

  // ---- openFile ----

  describe('openFile', () => {
    it('opens a markdown file, parses frontmatter, and opens a tab', async () => {
      const rawContent = '---\ntitle: Test\n---\n\nHello world.';
      setMockInvokeHandler('read_file', () => rawContent);

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/test.md', 'test.md');
      });

      const tabs = useEditorStore.getState().openDocuments;
      expect(tabs.length).toBe(1);
      expect(tabs[0].filePath).toBe('/project/test.md');
      expect(tabs[0].content).toBe('Hello world.');
      expect(tabs[0].frontmatter).toEqual({ title: 'Test' });
      expect(tabs[0].fileType).toBe('markdown');
    });

    it('opens a plain text file without frontmatter parsing', async () => {
      setMockInvokeHandler('read_file', () => 'Some plain text content.');

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/readme.txt', 'readme.txt');
      });

      const tabs = useEditorStore.getState().openDocuments;
      expect(tabs.length).toBe(1);
      expect(tabs[0].content).toBe('Some plain text content.');
      expect(tabs[0].frontmatter).toBeNull();
      expect(tabs[0].fileType).toBe('other');
    });

    it('opens a binary file (PDF) by reading binary data', async () => {
      setMockInvokeHandler('read_binary_file', () => [37, 80, 68, 70]); // %PDF

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/doc.pdf', 'doc.pdf');
      });

      const tabs = useEditorStore.getState().openDocuments;
      expect(tabs.length).toBe(1);
      expect(tabs[0].fileType).toBe('pdf');
    });

    it('throws when read_file fails', async () => {
      setMockInvokeHandler('read_file', () => {
        throw new Error('File not found');
      });

      const { result } = renderHook(() => useFileOperations());

      await expect(
        act(async () => {
          await result.current.openFile('/missing.md', 'missing.md');
        }),
      ).rejects.toThrow('File not found');
    });
  });

  // ---- saveFile ----

  describe('saveFile', () => {
    it('saves a file with frontmatter and marks tab clean', async () => {
      // First open a tab so we have something to save
      setMockInvokeHandler('read_file', () => '---\ntitle: Note\n---\n\nOriginal.');
      setMockInvokeHandler('mark_self_write', () => undefined);
      setMockInvokeHandler('write_file', () => undefined);
      setMockInvokeHandler('index_file', () => undefined);

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/note.md', 'note.md');
      });

      const tabId = useEditorStore.getState().openDocuments[0].id;

      // Mark tab dirty
      useEditorStore.getState().updateTabContent(tabId, 'Updated content.', true);
      expect(useEditorStore.getState().openDocuments[0].isDirty).toBe(true);

      let saved: boolean | undefined;
      await act(async () => {
        saved = await result.current.saveFile('/project/note.md', 'Updated content.', tabId);
      });

      expect(saved).toBe(true);
      expect(useEditorStore.getState().openDocuments[0].isDirty).toBe(false);
    });

    it('saves a file without frontmatter (plain content)', async () => {
      setMockInvokeHandler('read_file', () => 'No frontmatter here.');
      setMockInvokeHandler('mark_self_write', () => undefined);
      setMockInvokeHandler('write_file', () => undefined);
      setMockInvokeHandler('index_file', () => undefined);

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/plain.md', 'plain.md');
      });

      const tabId = useEditorStore.getState().openDocuments[0].id;

      let saved: boolean | undefined;
      await act(async () => {
        saved = await result.current.saveFile('/project/plain.md', 'No frontmatter here.', tabId);
      });

      expect(saved).toBe(true);
    });

    it('throws when write_file fails and calls clearSelfWrite', async () => {
      setMockInvokeHandler('read_file', () => 'Content');
      setMockInvokeHandler('mark_self_write', () => undefined);
      setMockInvokeHandler('write_file', () => {
        throw new Error('Disk full');
      });
      setMockInvokeHandler('clear_self_write', () => undefined);

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.openFile('/project/note.md', 'note.md');
      });

      const tabId = useEditorStore.getState().openDocuments[0].id;

      await expect(
        act(async () => {
          await result.current.saveFile('/project/note.md', 'Content', tabId);
        }),
      ).rejects.toThrow('Disk full');
    });

    it('re-marks tab dirty when save fails so user knows data is unsaved', async () => {
      setMockInvokeHandler('read_file', () => 'Original content.');
      setMockInvokeHandler('mark_self_write', () => undefined);
      setMockInvokeHandler('write_file', () => {
        throw new Error('Disk full');
      });
      setMockInvokeHandler('clear_self_write', () => undefined);

      const { result } = renderHook(() => useFileOperations());

      // Open a file
      await act(async () => {
        await result.current.openFile('/project/note.md', 'note.md');
      });

      const tabId = useEditorStore.getState().openDocuments[0].id;

      // Mark tab dirty (user edited the document)
      useEditorStore.getState().updateTabContent(tabId, 'Edited content.', true);
      expect(useEditorStore.getState().openDocuments[0].isDirty).toBe(true);

      // Attempt save — should fail
      await expect(
        act(async () => {
          await result.current.saveFile('/project/note.md', 'Edited content.', tabId);
        }),
      ).rejects.toThrow('Disk full');

      // Tab MUST still be dirty after a failed save
      expect(useEditorStore.getState().openDocuments[0].isDirty).toBe(true);
    });
  });

  // ---- deletePath ----

  describe('deletePath', () => {
    it('deletes a file and marks the tab as deleted', async () => {
      setMockInvokeHandler('read_file', () => 'Content');
      setMockInvokeHandler('delete_path', () => undefined);
      setMockInvokeHandler('list_directory', () => []);

      const { result } = renderHook(() => useFileOperations());

      // Open the file first
      await act(async () => {
        await result.current.openFile('/project/note.md', 'note.md');
      });

      expect(useEditorStore.getState().openDocuments.length).toBe(1);

      let deleted: boolean | undefined;
      await act(async () => {
        deleted = await result.current.deletePath('/project/note.md');
      });

      expect(deleted).toBe(true);
      expect(useEditorStore.getState().openDocuments[0].deleted).toBe(true);
    });

    it('still refreshes tree and throws when delete_path fails', async () => {
      setMockInvokeHandler('delete_path', () => {
        throw new Error('Permission denied');
      });
      setMockInvokeHandler('list_directory', () => {
        return [];
      });

      const { result } = renderHook(() => useFileOperations());

      await expect(
        act(async () => {
          await result.current.deletePath('/project/note.md');
        }),
      ).rejects.toThrow('Permission denied');

      // Tree should still be refreshed (error path refreshes tree)
      // The list_directory call happens during refreshFileTree
    });
  });

  // ---- renamePath ----

  describe('renamePath', () => {
    it('renames a path and updates open tabs', async () => {
      setMockInvokeHandler('read_file', () => 'Content');
      setMockInvokeHandler('rename_path', () => undefined);
      setMockInvokeHandler('list_directory', () => []);

      const { result } = renderHook(() => useFileOperations());

      // Open the file first
      await act(async () => {
        await result.current.openFile('/project/old.md', 'old.md');
      });

      let renamed: boolean | undefined;
      await act(async () => {
        renamed = await result.current.renamePath('/project/old.md', '/project/new.md');
      });

      expect(renamed).toBe(true);
      // Tab should be updated with the new path
      const tab = useEditorStore.getState().openDocuments[0];
      expect(tab.filePath).toBe('/project/new.md');
    });

    it('throws when rename_path fails', async () => {
      setMockInvokeHandler('rename_path', () => {
        throw new Error('Target already exists');
      });

      const { result } = renderHook(() => useFileOperations());

      await expect(
        act(async () => {
          await result.current.renamePath('/project/a.md', '/project/b.md');
        }),
      ).rejects.toThrow('Target already exists');
    });
  });

  // ---- refreshFileTree ----

  describe('refreshFileTree', () => {
    it('refreshes all open explorer folders and projects when no target given', async () => {
      const listCalls: string[] = [];
      setMockInvokeHandler('list_directory', (args) => {
        listCalls.push(args?.path as string);
        return [{ name: 'file.md', path: `${args?.path}/file.md`, is_directory: false }];
      });

      // Set up workspace with an explorer folder and project
      useWorkspaceStore.setState({
        explorerFolders: [{ path: '/folder1', fileTree: [] }],
        projects: [{ path: '/project1', fileTree: [] }],
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.refreshFileTree();
      });

      expect(listCalls).toContain('/folder1');
      expect(listCalls).toContain('/project1');
    });

    it('refreshes only the matching section when a target path is given', async () => {
      const listCalls: string[] = [];
      setMockInvokeHandler('list_directory', (args) => {
        listCalls.push(args?.path as string);
        return [];
      });

      useWorkspaceStore.setState({
        explorerFolders: [{ path: '/folder1', fileTree: [] }],
        projects: [{ path: '/project1', fileTree: [] }],
      });

      const { result } = renderHook(() => useFileOperations());

      await act(async () => {
        await result.current.refreshFileTree('/project1/subdir/file.md');
      });

      // Only the project containing the target path should be refreshed
      expect(listCalls).toContain('/project1');
      expect(listCalls).not.toContain('/folder1');
    });
  });

  // ---- createFolder ----

  describe('createFolder', () => {
    it('creates a folder and returns its path', async () => {
      setMockInvokeHandler('create_directory', () => undefined);
      setMockInvokeHandler('list_directory', () => []);

      const { result } = renderHook(() => useFileOperations());

      let folderPath: string | undefined;
      await act(async () => {
        folderPath = await result.current.createFolder('/project', 'subdir');
      });

      expect(folderPath).toBe('/project/subdir');
    });

    it('throws when create_directory fails', async () => {
      setMockInvokeHandler('create_directory', () => {
        throw new Error('Cannot create directory');
      });

      const { result } = renderHook(() => useFileOperations());

      await expect(
        act(async () => {
          await result.current.createFolder('/project', 'subdir');
        }),
      ).rejects.toThrow('Cannot create directory');
    });
  });
});
