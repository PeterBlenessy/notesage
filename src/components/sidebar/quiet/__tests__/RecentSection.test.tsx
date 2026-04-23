// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from '@/test/component-harness';
import { RecentSection, DEFAULT_RECENT_CAP } from '../RecentSection';
import { useEditorStore, type RecentFile } from '@/stores/editor-store';

// Mock useFileOperations so tests never hit Tauri IPC.
const openFileMock = vi.fn();
vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    openFile: openFileMock,
  }),
}));

// ---------------------------------------------------------------------------
// Clipboard mock for the ⌘⌥C regression test. jsdom's clipboard getter is
// not directly assignable, so we redefine the property.
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

function makeRecent(n: number): RecentFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `/workspace/notes/file-${i + 1}.md`,
    name: `file-${i + 1}.md`,
  }));
}

function setRecent(recentFiles: RecentFile[], opts?: { activeFilePath?: string }) {
  const active = opts?.activeFilePath;
  useEditorStore.setState({
    recentFiles,
    tabs: active
      ? [
          {
            id: 'tab-active',
            filePath: active,
            fileName: active.split('/').pop() ?? active,
            isDirty: false,
            content: '',
            frontmatter: null,
            fileType: 'markdown',
          },
        ]
      : [],
    activeTabId: active ? 'tab-active' : null,
  });
}

beforeEach(() => {
  openFileMock.mockReset();
  openFileMock.mockResolvedValue(undefined);
  mockClipboardWrite.mockClear();
  installClipboardMock();
  useEditorStore.setState({
    recentFiles: [],
    tabs: [],
    activeTabId: null,
  });
});

describe('RecentSection — shell', () => {
  it('renders the uppercase "Recent" heading', () => {
    renderWithProviders(<RecentSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /recent/i });
    expect(heading.textContent).toBe('Recent');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('does NOT render an add-button (derived list)', () => {
    renderWithProviders(<RecentSection />);
    // Recent is derived from last-touched order — no user "add" action.
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('renders header only when recentFiles is empty (no rows, no Show more button)', () => {
    renderWithProviders(<RecentSection />);
    const section = screen.getByRole('region', { name: /recent/i });
    // No row buttons.
    expect(section.querySelectorAll('[role="button"]').length).toBe(0);
    // No Show more / Show fewer toggle.
    expect(screen.queryByRole('button', { name: /show (more|fewer)/i })).toBeNull();
  });
});

describe('RecentSection — rendering rows', () => {
  it('renders one row per recent file (up to cap)', () => {
    setRecent(makeRecent(3));
    renderWithProviders(<RecentSection />);
    expect(screen.getByText('file-1.md')).toBeTruthy();
    expect(screen.getByText('file-2.md')).toBeTruthy();
    expect(screen.getByText('file-3.md')).toBeTruthy();
    // No overflow → no Show more button.
    expect(screen.queryByRole('button', { name: /show (more|fewer)/i })).toBeNull();
  });

  it('respects the order from editor-store (does not re-sort)', () => {
    const files: RecentFile[] = [
      { path: '/ws/c.md', name: 'c.md' },
      { path: '/ws/a.md', name: 'a.md' },
      { path: '/ws/b.md', name: 'b.md' },
    ];
    setRecent(files);
    renderWithProviders(<RecentSection />);
    const rendered = screen
      .getAllByRole('button')
      .map((el) => el.textContent ?? '')
      .filter((txt) => txt.endsWith('.md') || txt.includes('.md'));
    // Should match store order (c, a, b) not alphabetical (a, b, c).
    expect(rendered[0]).toContain('c.md');
    expect(rendered[1]).toContain('a.md');
    expect(rendered[2]).toContain('b.md');
  });

  it('exports a DEFAULT_RECENT_CAP constant equal to 5', () => {
    expect(DEFAULT_RECENT_CAP).toBe(5);
  });
});

describe('RecentSection — Show more / Show fewer', () => {
  it('shows cap rows + "Show more" when recentFiles exceeds cap', () => {
    // Use a small cap so we can test overflow; the store caps at 5 today,
    // but the component is cap-agnostic and #35 will raise the cap to 15.
    setRecent(makeRecent(7));
    renderWithProviders(<RecentSection cap={3} />);
    expect(screen.getByText('file-1.md')).toBeTruthy();
    expect(screen.getByText('file-2.md')).toBeTruthy();
    expect(screen.getByText('file-3.md')).toBeTruthy();
    expect(screen.queryByText('file-4.md')).toBeNull();
    const more = screen.getByRole('button', { name: /show more/i });
    expect(more).toBeTruthy();
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking "Show more" reveals all files and flips label to "Show fewer"', async () => {
    const user = userEvent.setup();
    setRecent(makeRecent(7));
    renderWithProviders(<RecentSection cap={3} />);
    await user.click(screen.getByRole('button', { name: /show more/i }));

    // All 7 now visible.
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(`file-${i}.md`)).toBeTruthy();
    }
    const fewer = screen.getByRole('button', { name: /show fewer/i });
    expect(fewer).toBeTruthy();
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides the "Show more" button if recentFiles shrinks below cap while expanded', async () => {
    const user = userEvent.setup();
    setRecent(makeRecent(7));
    renderWithProviders(<RecentSection cap={3} />);
    await user.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getByRole('button', { name: /show fewer/i })).toBeTruthy();

    // List shrinks below cap.
    act(() => {
      setRecent(makeRecent(2));
    });

    // Button should be gone, and all remaining rows visible.
    expect(screen.queryByRole('button', { name: /show (more|fewer)/i })).toBeNull();
    expect(screen.getByText('file-1.md')).toBeTruthy();
    expect(screen.getByText('file-2.md')).toBeTruthy();
  });
});

describe('RecentSection — activation', () => {
  it('clicking a row opens the file with the correct path and name', async () => {
    const user = userEvent.setup();
    setRecent(makeRecent(2));
    renderWithProviders(<RecentSection />);

    await user.click(screen.getByText('file-1.md'));

    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith('/workspace/notes/file-1.md', 'file-1.md');
  });

  it('Enter key on a row also opens the file', async () => {
    const user = userEvent.setup();
    setRecent(makeRecent(1));
    renderWithProviders(<RecentSection />);
    const row = screen.getByText('file-1.md').closest('[role="button"]') as HTMLElement;
    row.focus();
    await user.keyboard('{Enter}');
    expect(openFileMock).toHaveBeenCalledWith('/workspace/notes/file-1.md', 'file-1.md');
  });

  it('marks the active file with aria-current="page"', () => {
    setRecent(makeRecent(3), { activeFilePath: '/workspace/notes/file-2.md' });
    renderWithProviders(<RecentSection />);

    const activeRow = screen.getByText('file-2.md').closest('[role="button"]') as HTMLElement;
    expect(activeRow.getAttribute('aria-current')).toBe('page');
    expect(activeRow.getAttribute('data-active')).toBe('true');

    const inactiveRow = screen.getByText('file-1.md').closest('[role="button"]') as HTMLElement;
    expect(inactiveRow.getAttribute('aria-current')).toBeNull();
  });

  it('copies the path to the clipboard on ⌘⌥C when a row is focused (#46)', async () => {
    setRecent(makeRecent(2));
    renderWithProviders(<RecentSection />);

    const row = screen.getByText('file-1.md').closest('[role="button"]') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'c', metaKey: true, altKey: true });

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith('/workspace/notes/file-1.md');
  });
});
