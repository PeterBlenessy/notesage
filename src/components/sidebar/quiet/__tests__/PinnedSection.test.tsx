// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import { PinnedSection } from '../PinnedSection';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';

// ---------------------------------------------------------------------------
// Mock useFileOperations — PinnedSection calls openFile on item click
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
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

// ---------------------------------------------------------------------------
// Clipboard mock for ⌘⌥C regression test. jsdom's clipboard getter cannot
// be directly assigned, so we redefine the property.
// ---------------------------------------------------------------------------

const mockClipboardWrite = vi
  .fn<(text: string) => Promise<void>>()
  .mockImplementation(() => Promise.resolve());

function installClipboardMock() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    get: () => ({ writeText: mockClipboardWrite }),
  });
}
installClipboardMock();

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
  });
}

describe('PinnedSection', () => {
  beforeEach(() => {
    resetStores();
    mockOpenFile.mockReset();
    mockOpenFile.mockResolvedValue(undefined);
    mockClipboardWrite.mockClear();
    installClipboardMock();
  });

  it('renders the uppercase "Pinned" heading', () => {
    renderWithProviders(<PinnedSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /pinned/i });
    expect(heading.textContent).toBe('Pinned');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('renders an accessible add-button', () => {
    renderWithProviders(<PinnedSection onAdd={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /add pinned/i });
    expect(btn).toBeTruthy();
  });

  it('calls onAdd when the add-button is clicked', () => {
    const onAdd = vi.fn();
    renderWithProviders(<PinnedSection onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add pinned/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders header only (no list) when pinnedFiles is empty', () => {
    renderWithProviders(<PinnedSection />);
    const section = screen.getByRole('region', { name: /pinned/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
  });

  it('renders a row per pinned file with basename as visible text', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/Users/me/notes/alpha.md', '/work/proj/readme.md'],
    });

    renderWithProviders(<PinnedSection />);
    const section = screen.getByRole('region', { name: /pinned/i });
    expect(section.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('alpha.md')).toBeTruthy();
    expect(screen.getByText('readme.md')).toBeTruthy();
  });

  it('invokes openFile when a pinned row is clicked', async () => {
    useWorkspaceStore.setState({ pinnedFiles: ['/docs/intro.md'] });

    renderWithProviders(<PinnedSection />);
    const user = userEvent.setup();
    await user.click(screen.getByText('intro.md'));

    expect(mockOpenFile).toHaveBeenCalledWith('/docs/intro.md', 'intro.md');
  });

  it('opens the pinned file when Enter is pressed on the row', async () => {
    useWorkspaceStore.setState({ pinnedFiles: ['/notes/beta.md'] });

    renderWithProviders(<PinnedSection />);
    const row = screen.getByText('beta.md').closest('[role="button"]') as HTMLElement;
    expect(row).toBeTruthy();
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });

    expect(mockOpenFile).toHaveBeenCalledWith('/notes/beta.md', 'beta.md');
  });

  it('marks the active row with aria-current="page" and data-active', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/a.md', '/p/b.md'],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          filePath: '/p/b.md',
          fileName: 'b.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
        },
      ],
      activeTabId: 'tab-1',
    });

    renderWithProviders(<PinnedSection />);
    const activeRow = screen.getByText('b.md').closest('[role="button"]') as HTMLElement;
    const otherRow = screen.getByText('a.md').closest('[role="button"]') as HTMLElement;

    expect(activeRow.getAttribute('aria-current')).toBe('page');
    expect(activeRow.getAttribute('data-active')).toBe('true');
    expect(otherRow.getAttribute('aria-current')).toBeNull();
    expect(otherRow.getAttribute('data-active')).toBeNull();
  });

  it('copies the path to the clipboard on ⌘⌥C when a row is focused (#46)', async () => {
    useWorkspaceStore.setState({ pinnedFiles: ['/notes/gamma.md'] });

    renderWithProviders(<PinnedSection />);
    const row = screen.getByText('gamma.md').closest('[role="button"]') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'c', metaKey: true, altKey: true });

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith('/notes/gamma.md');
  });
});
