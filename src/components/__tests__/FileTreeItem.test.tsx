// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, registerDefaultHandlers } from '@/test/component-harness';
import { FileTree } from '@/components/sidebar/FileTree';
import { FileTreeItem } from '@/components/sidebar/FileTreeItem';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { createMockFileEntry } from '@/test/mock-data';

// ---------------------------------------------------------------------------
// Mock heavy sub-components that don't render meaningfully in jsdom
// ---------------------------------------------------------------------------

vi.mock('@/components/sidebar/SyncedIcon', () => ({
  SyncedIcon: ({ icon: Icon }: { icon: React.ComponentType<{ className?: string }>; synced?: boolean; folder?: boolean }) => (
    <span data-testid="synced-icon"><Icon className="h-4 w-4" /></span>
  ),
}));

vi.mock('@/components/sidebar/FolderPickerItem', () => ({
  FolderPickerItem: () => null,
}));

vi.mock('@/components/sidebar/NewFolderDialog', () => ({
  NewFolderDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Mock hooks with heavy dependencies
// ---------------------------------------------------------------------------

const mockRenamePath = vi.fn();
const mockDeletePath = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    renamePath: mockRenamePath,
    deletePath: mockDeletePath,
    openFile: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
  })),
}));

const mockFileTreeItemState = {
  isActive: false,
  hasExternalChange: false,
  isCloudFile: false,
  gitInfo: null,
};

vi.mock('@/hooks/useFileTreeItemState', () => ({
  useFileTreeItemState: vi.fn(() => mockFileTreeItemState),
}));

vi.mock('@/lib/drag-utils', () => ({
  NOTESAGE_DRAG_MIME: 'application/x-notesage-drag',
  parseNotesageDrop: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Store state reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  registerDefaultHandlers();

  useWorkspaceStore.setState({
    expandedFolders: new Set<string>(),
    projects: [],
    explorerFolders: [],
    notesTree: [],
  });

  useSettingsStore.setState({
    notesRootPath: '/test/notes',
  });

  useProjectMetadataStore.setState({
    metadataMap: {},
  });

  // Reset mock return values
  mockFileTreeItemState.isActive = false;
  mockFileTreeItemState.hasExternalChange = false;
  mockFileTreeItemState.isCloudFile = false;
  mockFileTreeItemState.gitInfo = null;

  mockRenamePath.mockReset();
  mockDeletePath.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileTreeItem', () => {
  const defaultProps = {
    level: 0,
    onFileClick: vi.fn(),
  };

  it('renders the file name for a file entry', () => {
    const entry = createMockFileEntry({ name: 'hello.md', path: '/test/hello.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.getByText('hello.md')).toBeTruthy();
  });

  it('renders the folder name for a directory entry', () => {
    const entry = createMockFileEntry({
      name: 'documents',
      path: '/test/documents',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.getByText('documents')).toBeTruthy();
  });

  it('calls onFileClick with correct path and name when a file is clicked', () => {
    const onFileClick = vi.fn();
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} level={0} onFileClick={onFileClick} />,
    );

    fireEvent.click(screen.getByText('note.md'));
    expect(onFileClick).toHaveBeenCalledWith('/test/note.md', 'note.md');
  });

  it('toggles folder expansion when a directory is clicked', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    // Click to expand
    fireEvent.click(screen.getByText('docs'));

    const state = useWorkspaceStore.getState();
    expect(state.expandedFolders.has('/test/docs')).toBe(true);
  });

  it('renders children when directory is expanded', () => {
    const childEntry = createMockFileEntry({
      name: 'child.md',
      path: '/test/docs/child.md',
    });
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [childEntry],
    });

    // Pre-expand the folder
    useWorkspaceStore.setState({
      expandedFolders: new Set(['/test/docs']),
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.getByText('child.md')).toBeTruthy();
  });

  it('does not render children when directory is collapsed', () => {
    const childEntry = createMockFileEntry({
      name: 'child.md',
      path: '/test/docs/child.md',
    });
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [childEntry],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.queryByText('child.md')).toBeNull();
  });

  it('shows context menu items on right-click', () => {
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    // Right-click triggers context menu
    fireEvent.contextMenu(screen.getByText('note.md'));

    // Context menu should show standard items
    expect(screen.getByText('New File')).toBeTruthy();
    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Reveal in Finder')).toBeTruthy();
  });

  it('shows "New Folder" in context menu for directory entries', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    fireEvent.contextMenu(screen.getByText('docs'));

    expect(screen.getByText('New Folder')).toBeTruthy();
  });

  it('does not show "New Folder" in context menu for file entries', () => {
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    fireEvent.contextMenu(screen.getByText('note.md'));

    expect(screen.queryByText('New Folder')).toBeNull();
  });

  it('expands collapsed directory on ArrowRight keypress', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const itemEl = screen.getByText('docs').closest('[tabindex="0"]')!;
    fireEvent.keyDown(itemEl, { key: 'ArrowRight' });

    expect(useWorkspaceStore.getState().expandedFolders.has('/test/docs')).toBe(true);
  });

  it('collapses expanded directory on ArrowLeft keypress', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    // Pre-expand the folder
    useWorkspaceStore.setState({
      expandedFolders: new Set(['/test/docs']),
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const itemEl = screen.getByText('docs').closest('[tabindex="0"]')!;
    fireEvent.keyDown(itemEl, { key: 'ArrowLeft' });

    expect(useWorkspaceStore.getState().expandedFolders.has('/test/docs')).toBe(false);
  });

  it('does not expand on ArrowRight for file entries', () => {
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const itemEl = screen.getByText('note.md').closest('[tabindex="0"]')!;
    fireEvent.keyDown(itemEl, { key: 'ArrowRight' });

    // Should remain empty (no folder toggled)
    expect(useWorkspaceStore.getState().expandedFolders.size).toBe(0);
  });

  it('applies active styling when file is the active tab', () => {
    mockFileTreeItemState.isActive = true;

    const entry = createMockFileEntry({ name: 'active.md', path: '/test/active.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const itemEl = screen.getByText('active.md').closest('[tabindex="0"]')!;
    expect(itemEl.getAttribute('aria-current')).toBe('page');
  });

  it('does not set aria-current when file is not active', () => {
    mockFileTreeItemState.isActive = false;

    const entry = createMockFileEntry({ name: 'inactive.md', path: '/test/inactive.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const itemEl = screen.getByText('inactive.md').closest('[tabindex="0"]')!;
    expect(itemEl.getAttribute('aria-current')).toBeNull();
  });

  it('shows "Export as..." context menu item for .md files when onExportFile is provided', () => {
    const onExportFile = vi.fn();
    const entry = createMockFileEntry({ name: 'document.md', path: '/test/document.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} level={0} onFileClick={vi.fn()} onExportFile={onExportFile} />,
    );

    fireEvent.contextMenu(screen.getByText('document.md'));

    expect(screen.getByText('Export as...')).toBeTruthy();
  });

  it('does not show "Export as..." for non-.md files', () => {
    const onExportFile = vi.fn();
    const entry = createMockFileEntry({ name: 'image.png', path: '/test/image.png' });

    renderWithProviders(
      <FileTreeItem entry={entry} level={0} onFileClick={vi.fn()} onExportFile={onExportFile} />,
    );

    fireEvent.contextMenu(screen.getByText('image.png'));

    expect(screen.queryByText('Export as...')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // ARIA tree view tests (#5, #7)
  // -----------------------------------------------------------------------

  it('has role="treeitem" on interactive elements', () => {
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const item = screen.getByRole('treeitem');
    expect(item).toBeTruthy();
    expect(item.getAttribute('aria-label')).toBe('note.md');
  });

  it('sets aria-label with folder type for directories', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const item = screen.getByRole('treeitem');
    expect(item.getAttribute('aria-label')).toBe('docs, folder');
  });

  it('sets aria-expanded=false on collapsed folders', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const item = screen.getByRole('treeitem');
    expect(item.getAttribute('aria-expanded')).toBe('false');
  });

  it('sets aria-expanded=true on expanded folders', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [createMockFileEntry({ name: 'child.md', path: '/test/docs/child.md' })],
    });

    useWorkspaceStore.setState({
      expandedFolders: new Set(['/test/docs']),
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const items = screen.getAllByRole('treeitem');
    const folderItem = items.find((el) => el.getAttribute('aria-label') === 'docs, folder')!;
    expect(folderItem.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not set aria-expanded on file entries', () => {
    const entry = createMockFileEntry({ name: 'note.md', path: '/test/note.md' });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const item = screen.getByRole('treeitem');
    expect(item.hasAttribute('aria-expanded')).toBe(false);
  });

  it('renders children wrapper with role="group"', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [createMockFileEntry({ name: 'child.md', path: '/test/docs/child.md' })],
    });

    useWorkspaceStore.setState({
      expandedFolders: new Set(['/test/docs']),
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    const group = screen.getByRole('group');
    expect(group).toBeTruthy();
  });

  it('marks decorative icons with aria-hidden', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    // The chevron span and the file icon wrapper should have aria-hidden
    const hiddenElements = document.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenElements.length).toBeGreaterThanOrEqual(2);
  });

  it('uses expandKeyPrefix in folder toggle key', () => {
    const entry = createMockFileEntry({
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [],
    });

    renderWithProviders(
      <FileTreeItem entry={entry} level={0} onFileClick={vi.fn()} expandKeyPrefix="project:" />,
    );

    fireEvent.click(screen.getByText('docs'));

    expect(useWorkspaceStore.getState().expandedFolders.has('project:/test/docs')).toBe(true);
  });
});

describe('FileTree', () => {
  it('has role="tree" and aria-label on the container', () => {
    registerDefaultHandlers();

    const tree = [
      createMockFileEntry({ name: 'note.md', path: '/test/note.md' }),
    ];

    renderWithProviders(
      <FileTree tree={tree} onFileClick={vi.fn()} />,
    );

    const treeEl = screen.getByRole('tree');
    expect(treeEl).toBeTruthy();
    expect(treeEl.getAttribute('aria-label')).toBe('File explorer');
  });
});

// ---------------------------------------------------------------------------
// AI Provider Lock badge (#13) — lock overlay on project folder icon
// ---------------------------------------------------------------------------

describe('FileTreeItem — AI Provider Lock badge', () => {
  const defaultProps = { level: 0, onFileClick: vi.fn() };

  it('renders padlock overlay on project folder when aiLock is set', () => {
    const entry = createMockFileEntry({
      name: 'Alpha',
      path: '/workspace/Alpha',
      is_directory: true,
      children: [createMockFileEntry({ name: '.notesage', path: '/workspace/Alpha/.notesage', is_directory: true, children: [] })],
    });

    useProjectMetadataStore.setState({
      metadataMap: {
        '/workspace/Alpha': {
          version: 1,
          name: 'Alpha',
          description: '',
          ai: { provider: null, agentName: null, projectContext: '' },
          aiLock: { connectionId: 'conn-claude', lockedAt: 1 },
        },
      },
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.getByTestId('project-lock-badge')).toBeTruthy();
  });

  it('does not render padlock overlay when aiLock is unset', () => {
    const entry = createMockFileEntry({
      name: 'Alpha',
      path: '/workspace/Alpha',
      is_directory: true,
      children: [createMockFileEntry({ name: '.notesage', path: '/workspace/Alpha/.notesage', is_directory: true, children: [] })],
    });

    useProjectMetadataStore.setState({
      metadataMap: {
        '/workspace/Alpha': {
          version: 1,
          name: 'Alpha',
          description: '',
          ai: { provider: null, agentName: null, projectContext: '' },
        },
      },
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    expect(screen.queryByTestId('project-lock-badge')).toBeNull();
  });

  it('does not render padlock overlay on non-project folders even with metadata entries', () => {
    const entry = createMockFileEntry({
      name: 'subfolder',
      path: '/workspace/Alpha/subfolder',
      is_directory: true,
      children: [],
    });

    // Even if some metadata is present at this unrelated path, the lock badge
    // only applies to project folders.
    useProjectMetadataStore.setState({
      metadataMap: {
        '/workspace/Alpha/subfolder': {
          version: 1,
          name: 'subfolder',
          description: '',
          ai: { provider: null, agentName: null, projectContext: '' },
          aiLock: { connectionId: 'conn-claude', lockedAt: 1 },
        },
      },
    });

    renderWithProviders(
      <FileTreeItem entry={entry} {...defaultProps} />,
    );

    // subfolder isn't a project (no .notesage child, not in projects list)
    expect(screen.queryByTestId('project-lock-badge')).toBeNull();
  });
});
