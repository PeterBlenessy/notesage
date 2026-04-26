// @vitest-environment jsdom

/**
 * Unit tests for `MentionsSection` — the @-mention sidebar list. Mirrors
 * `TagsSection.test.tsx` so the two sections stay symmetric and any future
 * regression in either reads identically.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from '@/test/component-harness';
import userEvent from '@testing-library/user-event';
import { MentionsSection, DEFAULT_MENTION_CAP } from '../MentionsSection';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const indexMentionsMock = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexMentions: (...args: unknown[]) => indexMentionsMock(...args),
  },
}));

const mockWorkspaceState: { projects: Array<{ path: string }> } = { projects: [] };
vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: <T,>(selector: (s: typeof mockWorkspaceState) => T) =>
    selector(mockWorkspaceState),
}));

const emitCmdBarEventMock = vi.fn();
vi.mock('@/lib/cmd-bar-events', () => ({
  emitCmdBarEvent: (...args: unknown[]) => emitCmdBarEventMock(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MentionsSection', () => {
  beforeEach(() => {
    indexMentionsMock.mockReset();
    emitCmdBarEventMock.mockReset();
    useSettingsStore.setState({
      sidebarMentionsCap: 5,
    });
  });

  it('renders the uppercase "Mentions" heading', async () => {
    indexMentionsMock.mockResolvedValue([]);
    renderWithProviders(<MentionsSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /mentions/i });
    expect(heading.textContent).toBe('Mentions');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('does NOT render an add-button (mentions come from the document index)', async () => {
    indexMentionsMock.mockResolvedValue([]);
    renderWithProviders(<MentionsSection />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders one row per mention up to the cap, with name + count visible', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'alice', file_count: 12 },
      { mention: 'bob', file_count: 7 },
      { mention: 'carol', file_count: 3 },
    ]);

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(3);

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText('carol')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('caps rows at DEFAULT_MENTION_CAP and shows "Show more" when overflow exists', async () => {
    const fixture = Array.from({ length: DEFAULT_MENTION_CAP + 3 }, (_, i) => ({
      mention: `user${i}`,
      file_count: 100 - i,
    }));
    indexMentionsMock.mockResolvedValue(fixture);

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('user0')).toBeTruthy();
    });

    const rows = screen
      .getAllByRole('button')
      .filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('Search for'));
    expect(rows).toHaveLength(DEFAULT_MENTION_CAP);

    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy();
    expect(screen.queryByText(`user${DEFAULT_MENTION_CAP}`)).toBeNull();
  });

  it('clicking "Show more" reveals all entries and toggles to "Show fewer"', async () => {
    const fixture = Array.from({ length: DEFAULT_MENTION_CAP + 3 }, (_, i) => ({
      mention: `user${i}`,
      file_count: 100 - i,
    }));
    indexMentionsMock.mockResolvedValue(fixture);
    const user = userEvent.setup();

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('user0')).toBeTruthy();
    });

    const showMore = screen.getByRole('button', { name: /show more/i });
    expect(showMore.getAttribute('aria-expanded')).toBe('false');

    await user.click(showMore);

    for (let i = 0; i < fixture.length; i++) {
      expect(screen.getByText(`user${i}`)).toBeTruthy();
    }

    const showFewer = screen.getByRole('button', { name: /show fewer/i });
    expect(showFewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders no overflow button when mention count is within the cap', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'alpha', file_count: 2 },
      { mention: 'beta', file_count: 1 },
    ]);

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /show fewer/i })).toBeNull();
  });

  it('clicking a mention fires a cmd-bar focus event with the @ prefix', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'finance', file_count: 4 },
      { mention: 'travel', file_count: 2 },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('finance')).toBeTruthy();
    });

    await user.click(screen.getByText('finance'));

    expect(emitCmdBarEventMock).toHaveBeenCalledTimes(1);
    expect(emitCmdBarEventMock).toHaveBeenCalledWith({
      type: 'focus',
      prefix: '@',
      drilldown: { kind: 'mention', name: 'finance' },
    });
  });

  it('pressing Enter on a focused row fires the mention-search event', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'finance', file_count: 4 },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('finance')).toBeTruthy();
    });

    const row = screen.getByRole('button', { name: /search for @finance/i });
    row.focus();
    await user.keyboard('{Enter}');

    expect(emitCmdBarEventMock).toHaveBeenCalledTimes(1);
    expect(emitCmdBarEventMock).toHaveBeenCalledWith({
      type: 'focus',
      prefix: '@',
      drilldown: { kind: 'mention', name: 'finance' },
    });
  });

  it('renders only the header when the mention list is empty', async () => {
    indexMentionsMock.mockResolvedValue([]);

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(indexMentionsMock).toHaveBeenCalled();
    });

    const section = screen.getByRole('region', { name: /mentions/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: /mentions/i })).toBeTruthy();
  });

  it('filters mention rows by name substring when `filter` is set', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'alice', file_count: 4 },
      { mention: 'allan', file_count: 2 },
      { mention: 'bob', file_count: 7 },
    ]);

    renderWithProviders(<MentionsSection filter="al" />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });
    expect(screen.getByText('allan')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();
  });

  it('filter is case-insensitive on mention names', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'Alice', file_count: 4 },
      { mention: 'bob', file_count: 7 },
    ]);

    renderWithProviders(<MentionsSection filter="ALI" />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
    });
    expect(screen.queryByText('bob')).toBeNull();
  });

  it('renders no rows when no mention matches the filter', async () => {
    indexMentionsMock.mockResolvedValue([
      { mention: 'alpha', file_count: 2 },
      { mention: 'beta', file_count: 1 },
    ]);

    renderWithProviders(<MentionsSection filter="zzz" />);

    await waitFor(() => {
      expect(indexMentionsMock).toHaveBeenCalled();
    });

    const section = screen.getByRole('region', { name: /mentions/i });
    expect(section.querySelectorAll('li')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('drops stale fetches — a newer request wins even if it resolves first', async () => {
    mockWorkspaceState.projects = [{ path: '/project/a' }];

    type MentionRow = { mention: string; file_count: number };
    type Resolver = (v: MentionRow[]) => void;
    const deferred: { resolve: Resolver | null } = { resolve: null };
    const stalePromise = new Promise<MentionRow[]>((resolve) => {
      deferred.resolve = resolve;
    });

    indexMentionsMock.mockImplementationOnce(() => stalePromise);
    indexMentionsMock.mockResolvedValueOnce([
      { mention: 'fresh', file_count: 9 },
    ]);

    const { rerender } = renderWithProviders(<MentionsSection />);

    mockWorkspaceState.projects = [{ path: '/project/a' }, { path: '/project/b' }];
    rerender(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('fresh')).toBeTruthy();
    });

    deferred.resolve?.([
      { mention: 'stale-a', file_count: 99 },
      { mention: 'stale-b', file_count: 42 },
    ]);

    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('stale-a')).toBeNull();
    expect(screen.queryByText('stale-b')).toBeNull();
    expect(screen.getByText('fresh')).toBeTruthy();

    mockWorkspaceState.projects = [];
  });

  it('uses sidebarMentionsCap from settings when no explicit `cap` prop is passed', async () => {
    useSettingsStore.setState({ sidebarMentionsCap: 3 });
    indexMentionsMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        mention: `user${i}`,
        file_count: 100 - i,
      })),
    );

    renderWithProviders(<MentionsSection />);

    await waitFor(() => {
      expect(screen.getByText('user0')).toBeTruthy();
    });

    const rows = screen
      .getAllByRole('button')
      .filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('Search for'));
    expect(rows).toHaveLength(3);
    expect(screen.queryByText('user3')).toBeNull();

    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy();
  });

  it('explicit `cap` prop overrides the setting', async () => {
    useSettingsStore.setState({ sidebarMentionsCap: 15 });
    indexMentionsMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        mention: `user${i}`,
        file_count: 100 - i,
      })),
    );

    renderWithProviders(<MentionsSection cap={2} />);

    await waitFor(() => {
      expect(screen.getByText('user0')).toBeTruthy();
    });

    const rows = screen
      .getAllByRole('button')
      .filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('Search for'));
    expect(rows).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Roving tabindex parity with TagsSection.
  // -------------------------------------------------------------------------

  describe('roving tabindex', () => {
    it('only the first mention row carries tabIndex=0 before any focus lands', async () => {
      indexMentionsMock.mockResolvedValue([
        { mention: 'alpha', file_count: 4 },
        { mention: 'beta', file_count: 2 },
        { mention: 'gamma', file_count: 1 },
      ]);
      renderWithProviders(<MentionsSection />);

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeTruthy();
      });

      const rows = screen
        .getAllByRole('button')
        .filter((el) =>
          (el.getAttribute('aria-label') ?? '').startsWith('Search for'),
        );
      expect(rows[0].getAttribute('tabindex')).toBe('0');
      expect(rows[1].getAttribute('tabindex')).toBe('-1');
      expect(rows[2].getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowDown moves focus to the next mention row', async () => {
      indexMentionsMock.mockResolvedValue([
        { mention: 'alpha', file_count: 4 },
        { mention: 'beta', file_count: 2 },
      ]);
      renderWithProviders(<MentionsSection />);

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeTruthy();
      });

      const alpha = screen.getByRole('button', { name: /search for @alpha/i });
      const beta = screen.getByRole('button', { name: /search for @beta/i });

      alpha.focus();
      fireEvent.keyDown(alpha, { key: 'ArrowDown' });

      expect(document.activeElement).toBe(beta);
    });

    it('ArrowUp at the top wraps to the bottom of the mention list', async () => {
      indexMentionsMock.mockResolvedValue([
        { mention: 'alpha', file_count: 4 },
        { mention: 'beta', file_count: 2 },
        { mention: 'gamma', file_count: 1 },
      ]);
      renderWithProviders(<MentionsSection />);

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeTruthy();
      });

      const alpha = screen.getByRole('button', { name: /search for @alpha/i });
      const gamma = screen.getByRole('button', { name: /search for @gamma/i });

      alpha.focus();
      fireEvent.keyDown(alpha, { key: 'ArrowUp' });

      expect(document.activeElement).toBe(gamma);
    });

    it('ArrowDown at the bottom wraps to the top of the mention list', async () => {
      indexMentionsMock.mockResolvedValue([
        { mention: 'alpha', file_count: 4 },
        { mention: 'beta', file_count: 2 },
        { mention: 'gamma', file_count: 1 },
      ]);
      renderWithProviders(<MentionsSection />);

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeTruthy();
      });

      const alpha = screen.getByRole('button', { name: /search for @alpha/i });
      const gamma = screen.getByRole('button', { name: /search for @gamma/i });

      gamma.focus();
      fireEvent.keyDown(gamma, { key: 'ArrowDown' });

      expect(document.activeElement).toBe(alpha);
    });
  });
});
