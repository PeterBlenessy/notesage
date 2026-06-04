// @vitest-environment jsdom
/**
 * Red test — verifies that `ChildRow` lives in its own dedicated file
 * (`../ChildRow`) and renders correctly.  This test will FAIL before the
 * extraction refactor because `../ChildRow` does not yet exist.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ChildRow } from '../ChildRow';
import type { RowDescriptor } from '../ProjectsSection';

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: vi.fn(),
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

const sampleProject = {
  path: '/Users/me/Notesage/alpha',
  fileTree: [],
};

const fileRow: RowDescriptor = {
  id: '/Users/me/Notesage/alpha::/Users/me/Notesage/alpha/note.md',
  kind: 'child',
  project: sampleProject,
  entry: {
    name: 'note.md',
    path: '/Users/me/Notesage/alpha/note.md',
    is_directory: false,
    hidden: false,
  },
};

const folderRow: RowDescriptor = {
  id: '/Users/me/Notesage/alpha::/Users/me/Notesage/alpha/docs',
  kind: 'child',
  project: sampleProject,
  entry: {
    name: 'docs',
    path: '/Users/me/Notesage/alpha/docs',
    is_directory: true,
    hidden: false,
    children: [],
  },
};

const baseProps = {
  isFocused: false,
  hasFocusWithin: false,
  isRenaming: false,
  onActivate: vi.fn(),
  onKeyDown: vi.fn(),
  onFocus: vi.fn(),
  onStartRename: vi.fn(),
  onCommitRename: vi.fn(),
  onCancelRename: vi.fn(),
  registerRef: vi.fn(),
};

describe('ChildRow (dedicated file)', () => {
  it('renders a treeitem with the file name for a file entry', () => {
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} />);
    const item = screen.getByRole('treeitem');
    expect(item.textContent).toContain('note.md');
  });

  it('renders a treeitem with the folder name for a directory entry', () => {
    renderWithProviders(<ChildRow row={folderRow} {...baseProps} />);
    const item = screen.getByRole('treeitem');
    expect(item.textContent).toContain('docs');
  });

  it('file row has draggable="true"', () => {
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} />);
    expect(screen.getByRole('treeitem').getAttribute('draggable')).toBe('true');
  });

  it('folder row is NOT draggable', () => {
    renderWithProviders(<ChildRow row={folderRow} {...baseProps} />);
    // Folders are not draggable per the "file-only drag" rule.
    expect(screen.getByRole('treeitem').getAttribute('draggable')).not.toBe('true');
  });

  it('calls onActivate when file row is clicked (single click)', () => {
    const onActivate = vi.fn();
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('has aria-level="2"', () => {
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} />);
    expect(screen.getByRole('treeitem').getAttribute('aria-level')).toBe('2');
  });
});
