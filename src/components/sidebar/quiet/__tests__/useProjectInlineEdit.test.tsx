// @vitest-environment jsdom
/**
 * Red test — verifies that `useProjectInlineEdit` lives in its own dedicated
 * file (`../useProjectInlineEdit`) and exposes the correct API.  This test
 * will FAIL before the extraction refactor because `../useProjectInlineEdit`
 * does not yet exist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectInlineEdit } from '../useProjectInlineEdit';
import { useQuietSidebarStore } from '@/stores/quiet-sidebar-store';
import type { WorkspaceProject } from '@/stores/workspace-store';
import type { FileEntry } from '@/lib/tauri';

const mockRenamePath = vi.fn();
const mockCreateFile = vi.fn();
const mockCreateFolder = vi.fn();
const mockOpenFile = vi.fn();

const noopSetExpandedPaths = vi.fn();

function makeFile(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: false };
}

const alpha: WorkspaceProject = {
  path: '/Users/me/Notesage/alpha',
  fileTree: [makeFile('note.md', '/Users/me/Notesage/alpha/note.md')],
};

beforeEach(() => {
  useQuietSidebarStore.setState({ pendingCreate: null, pendingCreateProject: false });
  mockRenamePath.mockReset();
  mockCreateFile.mockReset();
  mockCreateFolder.mockReset();
  mockOpenFile.mockReset();
});

describe('useProjectInlineEdit', () => {
  it('starts with no renaming state', () => {
    const { result } = renderHook(() =>
      useProjectInlineEdit({
        projects: [alpha],
        visibleChildPaths: new Set<string>(),
        setExpandedPaths: noopSetExpandedPaths,
        renamePath: mockRenamePath,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        openFile: mockOpenFile,
      }),
    );
    expect(result.current.renamingPath).toBeNull();
    expect(result.current.renamingProjectPath).toBeNull();
  });

  it('startRename sets renamingPath', () => {
    const { result } = renderHook(() =>
      useProjectInlineEdit({
        projects: [alpha],
        visibleChildPaths: new Set<string>(),
        setExpandedPaths: noopSetExpandedPaths,
        renamePath: mockRenamePath,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        openFile: mockOpenFile,
      }),
    );
    act(() => {
      result.current.startRename('/Users/me/Notesage/alpha/note.md');
    });
    expect(result.current.renamingPath).toBe('/Users/me/Notesage/alpha/note.md');
  });

  it('cancelRename clears renamingPath', () => {
    const { result } = renderHook(() =>
      useProjectInlineEdit({
        projects: [alpha],
        visibleChildPaths: new Set<string>(),
        setExpandedPaths: noopSetExpandedPaths,
        renamePath: mockRenamePath,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        openFile: mockOpenFile,
      }),
    );
    act(() => {
      result.current.startRename('/Users/me/Notesage/alpha/note.md');
    });
    expect(result.current.renamingPath).toBe('/Users/me/Notesage/alpha/note.md');
    act(() => {
      result.current.cancelRename();
    });
    expect(result.current.renamingPath).toBeNull();
  });

  it('handleAddToProject sets pendingCreate for the given project path', () => {
    const { result } = renderHook(() =>
      useProjectInlineEdit({
        projects: [alpha],
        visibleChildPaths: new Set<string>(),
        setExpandedPaths: noopSetExpandedPaths,
        renamePath: mockRenamePath,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        openFile: mockOpenFile,
      }),
    );
    act(() => {
      result.current.handleAddToProject('/Users/me/Notesage/alpha');
    });
    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha',
    });
  });

  it('exposes pendingCreateProjectPath derived from pendingCreate and projects', () => {
    const { result } = renderHook(() =>
      useProjectInlineEdit({
        projects: [alpha],
        visibleChildPaths: new Set<string>(),
        setExpandedPaths: noopSetExpandedPaths,
        renamePath: mockRenamePath,
        createFile: mockCreateFile,
        createFolder: mockCreateFolder,
        openFile: mockOpenFile,
      }),
    );
    expect(result.current.pendingCreateProjectPath).toBeNull();
    act(() => {
      useQuietSidebarStore.getState().setPendingCreate({
        parentDir: '/Users/me/Notesage/alpha',
      });
    });
    expect(result.current.pendingCreateProjectPath).toBe('/Users/me/Notesage/alpha');
  });
});
