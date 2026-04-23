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
// Mock useFileOperations — PinnedSection calls openFile on item click and
// renamePath on rename commit (#40).
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();
const mockRenamePath = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: mockRenamePath,
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
    mockRenamePath.mockReset();
    mockRenamePath.mockResolvedValue(true);
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

  // -------------------------------------------------------------------------
  // Task #43 — filter prop
  // -------------------------------------------------------------------------

  it('filters rows by basename substring (case-insensitive) when `filter` is set', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/readme.md', '/p/notes.md', '/p/ideas.md'],
    });

    renderWithProviders(<PinnedSection filter="read" />);

    expect(screen.getByText('readme.md')).toBeTruthy();
    expect(screen.queryByText('notes.md')).toBeNull();
    expect(screen.queryByText('ideas.md')).toBeNull();
  });

  it('renders no rows when no pinned basename matches the filter', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/alpha.md', '/p/beta.md'],
    });

    renderWithProviders(<PinnedSection filter="zzz" />);
    expect(screen.queryByText('alpha.md')).toBeNull();
    expect(screen.queryByText('beta.md')).toBeNull();
  });

  it('passes through all rows when the filter is empty', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/alpha.md', '/p/beta.md'],
    });
    renderWithProviders(<PinnedSection filter="" />);
    expect(screen.getByText('alpha.md')).toBeTruthy();
    expect(screen.getByText('beta.md')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Task #40 — inline rename (F2, double-click, context-menu event)
  // -------------------------------------------------------------------------

  describe('inline rename (#40)', () => {
    async function renderWithRow(path: string) {
      useWorkspaceStore.setState({ pinnedFiles: [path] });
      renderWithProviders(<PinnedSection />);
      const name = path.split('/').pop() ?? path;
      const row = screen
        .getByText(name)
        .closest('[role="button"]') as HTMLElement;
      expect(row).toBeTruthy();
      return { row, name };
    }

    it('enters rename mode on F2 when the row is focused', async () => {
      const { row, name } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      expect(input.value).toBe(name);
      // The row marks itself as renaming via data attribute.
      expect(row.getAttribute('data-renaming')).toBe('true');
    });

    it('enters rename mode on double-click and does NOT open the file', async () => {
      const { row } = await renderWithRow('/notes/alpha.md');
      // `click({ detail: 2 })` emits a DOM click with detail === 2 — the
      // row inspects `event.detail` to distinguish single vs double click.
      fireEvent.click(row, { detail: 2 });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(mockOpenFile).not.toHaveBeenCalled();
    });

    it('commits the rename by calling renamePath with the derived new path', async () => {
      const user = userEvent.setup();
      const { row } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'renamed.md{Enter}');

      await waitFor(() => {
        expect(mockRenamePath).toHaveBeenCalledWith(
          '/notes/alpha.md',
          '/notes/renamed.md',
        );
      });
    });

    it('preserves the original extension when the user omits one', async () => {
      const user = userEvent.setup();
      const { row } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'newname{Enter}');

      await waitFor(() => {
        expect(mockRenamePath).toHaveBeenCalledWith(
          '/notes/alpha.md',
          '/notes/newname.md',
        );
      });
    });

    it('Escape cancels — no renamePath call', async () => {
      const { row } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      fireEvent.keyDown(input, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByLabelText(/rename/i)).toBeNull();
      });
      expect(mockRenamePath).not.toHaveBeenCalled();
    });

    it('is entered when the SIDEBAR_ENTER_RENAME_MODE_EVENT fires with a matching path', async () => {
      const { row } = await renderWithRow('/notes/alpha.md');
      expect(row.getAttribute('data-renaming')).toBeNull();

      window.dispatchEvent(
        new CustomEvent('sidebar:enter-rename-mode', {
          detail: { filePath: '/notes/alpha.md' },
        }),
      );

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      expect(input).toBeTruthy();
    });

    it('ignores SIDEBAR_ENTER_RENAME_MODE_EVENT when the path is not in this section', async () => {
      await renderWithRow('/notes/alpha.md');

      window.dispatchEvent(
        new CustomEvent('sidebar:enter-rename-mode', {
          detail: { filePath: '/somewhere/else.md' },
        }),
      );

      // No input rendered because this section doesn't own the path.
      expect(screen.queryByLabelText(/rename/i)).toBeNull();
    });

    it('validation rejects a slash in the input (input stays open, no rename)', async () => {
      const user = userEvent.setup();
      const { row } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'bad/name{Enter}');

      // Validation error rendered, renamePath never called, input stays.
      expect(screen.getByRole('alert').textContent).toMatch(/slash/i);
      expect(mockRenamePath).not.toHaveBeenCalled();
      expect(input).toBeTruthy();
    });

    it('committing with no change is a no-op (does not call renamePath)', async () => {
      const { row } = await renderWithRow('/notes/alpha.md');
      row.focus();
      fireEvent.keyDown(row, { key: 'F2' });

      const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
      // Enter with the original value.
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.queryByLabelText(/rename/i)).toBeNull();
      });
      expect(mockRenamePath).not.toHaveBeenCalled();
    });
  });
});
