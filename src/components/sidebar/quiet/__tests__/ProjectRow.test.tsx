// @vitest-environment jsdom
/**
 * Red test — verifies that `ProjectRow` lives in its own dedicated file
 * (`../ProjectRow`) and renders correctly.  This test will FAIL before the
 * extraction refactor because `../ProjectRow` does not yet exist.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProjectRow } from '../ProjectRow';
import type { WorkspaceProject } from '@/stores/workspace-store';

vi.mock('@/stores/project-metadata-store', () => ({
  useProjectMetadataStore: vi.fn(() => undefined),
}));

const sampleProject: WorkspaceProject = {
  path: '/Users/me/Notesage/alpha',
  fileTree: [
    { name: 'note.md', path: '/Users/me/Notesage/alpha/note.md', is_directory: false, hidden: false },
  ],
};

const baseProps = {
  project: sampleProject,
  isActive: false,
  isExpanded: false,
  isFocused: false,
  hasFocusWithin: false,
  isRenaming: false,
  onOpen: vi.fn(),
  onKeyDown: vi.fn(),
  onFocus: vi.fn(),
  onAddNote: vi.fn(),
  onStartRename: vi.fn(),
  onCommitRename: vi.fn(),
  onCancelRename: vi.fn(),
  registerRef: vi.fn(),
};

describe('ProjectRow (dedicated file)', () => {
  it('renders a treeitem with the project basename as visible text', () => {
    renderWithProviders(<ProjectRow {...baseProps} />);
    expect(screen.getByRole('treeitem').textContent).toContain('alpha');
  });

  it('has aria-expanded="false" when isExpanded=false', () => {
    renderWithProviders(<ProjectRow {...baseProps} isExpanded={false} />);
    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('false');
  });

  it('has aria-expanded="true" when isExpanded=true', () => {
    renderWithProviders(<ProjectRow {...baseProps} isExpanded={true} />);
    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('true');
  });

  it('calls onOpen when clicked (single click)', () => {
    const onOpen = vi.fn();
    renderWithProviders(<ProjectRow {...baseProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a "New note in <name>" button for the per-row add action', () => {
    renderWithProviders(<ProjectRow {...baseProps} />);
    expect(screen.getByRole('button', { name: /new note in alpha/i })).toBeTruthy();
  });
});
