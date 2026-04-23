// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  waitFor,
} from '@/test/component-harness';
import userEvent from '@testing-library/user-event';
import { TagsSection, DEFAULT_TAG_CAP } from '../TagsSection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const indexTagsMock = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTags: (...args: unknown[]) => indexTagsMock(...args),
  },
}));

// Mock workspace-store so the section resolves "all project paths" without
// touching real Zustand state. Supports the selector pattern used by the
// component (`useWorkspaceStore((s) => s.projects)`). `mockWorkspaceState`
// is mutable so individual tests can vary the project set and exercise the
// effect's dependency.
const mockWorkspaceState: { projects: Array<{ path: string }> } = { projects: [] };
vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: <T,>(selector: (s: typeof mockWorkspaceState) => T) =>
    selector(mockWorkspaceState),
}));

// Mock the cmd-bar-events bus so we can assert the click handler fires a
// focus intent into the FloatingCommandBar (#20 ⌘3 path).
const emitCmdBarEventMock = vi.fn();
vi.mock('@/lib/cmd-bar-events', () => ({
  emitCmdBarEvent: (...args: unknown[]) => emitCmdBarEventMock(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagsSection', () => {
  beforeEach(() => {
    indexTagsMock.mockReset();
    emitCmdBarEventMock.mockReset();
  });

  it('renders the uppercase "Tags" heading', async () => {
    indexTagsMock.mockResolvedValue([]);
    renderWithProviders(<TagsSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /tags/i });
    expect(heading.textContent).toBe('Tags');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('does NOT render an add-button (tags come from the document index)', async () => {
    indexTagsMock.mockResolvedValue([]);
    renderWithProviders(<TagsSection />);
    // Button role reserved for "Show more" when overflow exists; with an
    // empty tag list there should be no buttons at all.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders one row per tag up to the cap, label #tagname + count visible', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'personal', file_count: 7 },
      { tag: 'fiction', file_count: 3 },
    ]);

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('work')).toBeTruthy();
    });

    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(3);

    expect(screen.getByText('work')).toBeTruthy();
    expect(screen.getByText('personal')).toBeTruthy();
    expect(screen.getByText('fiction')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('caps rows at DEFAULT_TAG_CAP and shows "Show more" when overflow exists', async () => {
    const fixture = Array.from({ length: DEFAULT_TAG_CAP + 3 }, (_, i) => ({
      tag: `tag${i}`,
      file_count: 100 - i,
    }));
    indexTagsMock.mockResolvedValue(fixture);

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('tag0')).toBeTruthy();
    });

    // Cap rows plus the "Show more" button button role; the toggle button
    // also has role="button", so filter to row-shaped buttons (aria-label
    // starts with "Search for").
    const rows = screen
      .getAllByRole('button')
      .filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('Search for'));
    expect(rows).toHaveLength(DEFAULT_TAG_CAP);

    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy();
    // Overflow entries should NOT be visible yet.
    expect(screen.queryByText(`tag${DEFAULT_TAG_CAP}`)).toBeNull();
  });

  it('clicking "Show more" reveals all entries and toggles to "Show fewer"', async () => {
    const fixture = Array.from({ length: DEFAULT_TAG_CAP + 3 }, (_, i) => ({
      tag: `tag${i}`,
      file_count: 100 - i,
    }));
    indexTagsMock.mockResolvedValue(fixture);
    const user = userEvent.setup();

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('tag0')).toBeTruthy();
    });

    const showMore = screen.getByRole('button', { name: /show more/i });
    expect(showMore.getAttribute('aria-expanded')).toBe('false');

    await user.click(showMore);

    // All rows now visible.
    for (let i = 0; i < fixture.length; i++) {
      expect(screen.getByText(`tag${i}`)).toBeTruthy();
    }

    const showFewer = screen.getByRole('button', { name: /show fewer/i });
    expect(showFewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders no overflow button when tag count is within the cap', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'alpha', file_count: 2 },
      { tag: 'beta', file_count: 1 },
    ]);

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /show fewer/i })).toBeNull();
  });

  it('clicking a tag fires a cmd-bar focus event with the # prefix', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'finance', file_count: 4 },
      { tag: 'travel', file_count: 2 },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('finance')).toBeTruthy();
    });

    await user.click(screen.getByText('finance'));

    expect(emitCmdBarEventMock).toHaveBeenCalledTimes(1);
    expect(emitCmdBarEventMock).toHaveBeenCalledWith({ type: 'focus', prefix: '#' });
  });

  it('pressing Enter on a focused row fires the tag-search event', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'finance', file_count: 4 },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<TagsSection />);

    await waitFor(() => {
      expect(screen.getByText('finance')).toBeTruthy();
    });

    const row = screen.getByRole('button', { name: /search for #finance/i });
    row.focus();
    await user.keyboard('{Enter}');

    expect(emitCmdBarEventMock).toHaveBeenCalledTimes(1);
    expect(emitCmdBarEventMock).toHaveBeenCalledWith({ type: 'focus', prefix: '#' });
  });

  it('renders only the header when the tag list is empty', async () => {
    indexTagsMock.mockResolvedValue([]);

    renderWithProviders(<TagsSection />);

    // Wait a microtask to drain the fetch.
    await waitFor(() => {
      expect(indexTagsMock).toHaveBeenCalled();
    });

    const section = screen.getByRole('region', { name: /tags/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
    // Heading is still there.
    expect(screen.getByRole('heading', { level: 2, name: /tags/i })).toBeTruthy();
  });

  it('filters tag rows by name substring when `filter` is set (#43)', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'finance', file_count: 4 },
      { tag: 'fiction', file_count: 2 },
      { tag: 'work', file_count: 7 },
    ]);

    renderWithProviders(<TagsSection filter="fi" />);

    await waitFor(() => {
      expect(screen.getByText('finance')).toBeTruthy();
    });
    expect(screen.getByText('fiction')).toBeTruthy();
    expect(screen.queryByText('work')).toBeNull();
  });

  it('filter is case-insensitive on tag names (#43)', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'Finance', file_count: 4 },
      { tag: 'work', file_count: 7 },
    ]);

    renderWithProviders(<TagsSection filter="FIN" />);

    await waitFor(() => {
      expect(screen.getByText('Finance')).toBeTruthy();
    });
    expect(screen.queryByText('work')).toBeNull();
  });

  it('renders no rows when no tag matches the filter (#43)', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'alpha', file_count: 2 },
      { tag: 'beta', file_count: 1 },
    ]);

    renderWithProviders(<TagsSection filter="zzz" />);

    await waitFor(() => {
      expect(indexTagsMock).toHaveBeenCalled();
    });

    const section = screen.getByRole('region', { name: /tags/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
    // Show more button should not appear either.
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('drops stale fetches — a newer request wins even if it resolves first', async () => {
    // Set up mutable workspace state so the component's projectPaths memo
    // changes identity when we mutate `mockWorkspaceState.projects` — that
    // triggers the fetch effect a second time and bumps the reqId guard.
    mockWorkspaceState.projects = [{ path: '/project/a' }];

    // First fetch: stale, resolves later. Second fetch: fresh, resolves now.
    type TagRow = { tag: string; file_count: number };
    type Resolver = (v: TagRow[]) => void;
    const deferred: { resolve: Resolver | null } = { resolve: null };
    const stalePromise = new Promise<TagRow[]>((resolve) => {
      deferred.resolve = resolve;
    });

    indexTagsMock.mockImplementationOnce(() => stalePromise);
    indexTagsMock.mockResolvedValueOnce([
      { tag: 'fresh', file_count: 9 },
    ]);

    const { rerender } = renderWithProviders(<TagsSection />);

    // Change the mocked project set so a new effect run fires.
    mockWorkspaceState.projects = [{ path: '/project/a' }, { path: '/project/b' }];
    rerender(<TagsSection />);

    // Fresh fetch resolves — wait for its payload to appear.
    await waitFor(() => {
      expect(screen.getByText('fresh')).toBeTruthy();
    });

    // Now resolve the stale one — it should be ignored by the reqId guard.
    deferred.resolve?.([
      { tag: 'stale-a', file_count: 99 },
      { tag: 'stale-b', file_count: 42 },
    ]);

    // Give React a tick to potentially mis-apply the stale data.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('stale-a')).toBeNull();
    expect(screen.queryByText('stale-b')).toBeNull();
    expect(screen.getByText('fresh')).toBeTruthy();

    // Clean up state for other tests.
    mockWorkspaceState.projects = [];
  });
});
