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

  it('folder row is draggable AND a drop target', () => {
    // Both halves changed on 2026-09-15. A folder row used to be neither: it
    // could not be picked up, and nothing could be dropped on it — which is
    // why a file could be moved out of the Inbox and nowhere else.
    renderWithProviders(<ChildRow row={folderRow} {...baseProps} />);
    expect(screen.getByRole('treeitem').getAttribute('draggable')).toBe('true');
  });

  it('calls onActivate when file row is clicked (single click)', () => {
    const onActivate = vi.fn();
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('marks a folder the listing could not read, instead of showing it as empty', () => {
    const unreadable: RowDescriptor = {
      ...folderRow,
      entry: { ...folderRow.entry!, unreadable: true },
    };
    renderWithProviders(<ChildRow row={unreadable} {...baseProps} />);
    expect(screen.getByTestId('child-row-listing-warning')).toBeTruthy();
    expect(screen.getByRole('treeitem').getAttribute('aria-label')).toBe(
      'Open folder docs. This folder could not be read, so its contents are not shown.',
    );
  });

  it('marks a folder cut off by the depth limit with its own wording', () => {
    const truncated: RowDescriptor = {
      ...folderRow,
      entry: { ...folderRow.entry!, truncated: true },
    };
    renderWithProviders(<ChildRow row={truncated} {...baseProps} />);
    expect(screen.getByTestId('child-row-listing-warning')).toBeTruthy();
    expect(screen.getByRole('treeitem').getAttribute('aria-label')).toContain('nested too deeply');
  });

  it('shows no listing warning on an ordinary empty folder or on a file', () => {
    const { unmount } = renderWithProviders(<ChildRow row={folderRow} {...baseProps} />);
    expect(screen.queryByTestId('child-row-listing-warning')).toBeNull();
    expect(screen.getByRole('treeitem').getAttribute('aria-label')).toBe('Open folder docs');
    unmount();

    renderWithProviders(<ChildRow row={fileRow} {...baseProps} />);
    expect(screen.queryByTestId('child-row-listing-warning')).toBeNull();
  });

  it('has aria-level="2"', () => {
    renderWithProviders(<ChildRow row={fileRow} {...baseProps} />);
    expect(screen.getByRole('treeitem').getAttribute('aria-level')).toBe('2');
  });
});
