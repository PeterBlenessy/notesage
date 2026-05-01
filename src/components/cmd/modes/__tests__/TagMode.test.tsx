// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import TagMode from '@/components/cmd/modes/TagMode';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const indexTagsMock = vi.fn();
const indexTagOccurrencesMock = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTags: (...args: unknown[]) => indexTagsMock(...args),
    indexTagOccurrences: (...args: unknown[]) =>
      indexTagOccurrencesMock(...args),
  },
}));

// Mock workspace-store so the component can resolve "all project paths" without
// pulling in real Zustand state. The mock supports the selector pattern
// (`useWorkspaceStore((s) => s.projects)`) used by the picker.
vi.mock('@/stores/workspace-store', () => {
  const state = { projects: [] as Array<{ path: string }> };
  return {
    useWorkspaceStore: <T,>(selector: (s: typeof state) => T) =>
      selector(state),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagMode', () => {
  beforeEach(() => {
    indexTagsMock.mockReset();
    indexTagOccurrencesMock.mockReset();
    indexTagOccurrencesMock.mockResolvedValue([]);
  });

  it('shows top tags ordered by usage descending when filter is empty', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'personal', file_count: 7 },
      { tag: 'fiction', file_count: 3 },
    ]);

    renderWithProviders(
      <TagMode filter="" onPick={() => {}} />,
    );

    // Wait for async fetch.
    await waitFor(() => {
      expect(screen.getByText('work')).toBeTruthy();
    });

    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(3);

    // Ordering should be preserved as-given (backend already orders by usage).
    expect(rows[0].textContent).toContain('work');
    expect(rows[1].textContent).toContain('personal');
    expect(rows[2].textContent).toContain('fiction');
  });

  it('filters tags by case-insensitive substring on the name', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'fiction', file_count: 12 },
      { tag: 'fictional', file_count: 4 },
      { tag: 'facts', file_count: 9 },
      { tag: 'work', file_count: 7 },
    ]);

    renderWithProviders(
      <TagMode filter="fic" onPick={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText('fiction')).toBeTruthy();
    });

    expect(screen.getByText('fiction')).toBeTruthy();
    expect(screen.getByText('fictional')).toBeTruthy();
    expect(screen.queryByText('facts')).toBeNull();
    expect(screen.queryByText('work')).toBeNull();
  });

  it('drills into occurrences (not onPick) when a tag row is clicked', async () => {
    // Live-test 2026-04-26 (slice 2) — TagMode now owns a two-level
    // drilldown. Clicking a tag at level 1 transitions to the level-2
    // occurrences view; `onPick` does NOT fire until the user picks an
    // occurrence at level 2.
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'fiction', file_count: 3 },
    ]);
    indexTagOccurrencesMock.mockResolvedValue([
      {
        path: '/p/notes.md',
        file_name: 'notes.md',
        context_before: 'about ',
        context_after: ' rocks',
      },
    ]);
    const onPick = vi.fn();

    renderWithProviders(<TagMode filter="" onPick={onPick} />);

    await waitFor(() => expect(screen.getByText('fiction')).toBeTruthy());

    fireEvent.click(screen.getByText('fiction'));

    // Level-2 view rendered, occurrences fetched.
    await waitFor(() => expect(screen.getByText('notes.md')).toBeTruthy());
    expect(indexTagOccurrencesMock).toHaveBeenCalledWith(
      'fiction',
      expect.any(Array),
    );
    // onPick must NOT have fired yet — only level-2 selection triggers it.
    expect(onPick).not.toHaveBeenCalled();
  });

  it('fires onPick with the occurrence payload when a level-2 row is clicked', async () => {
    indexTagsMock.mockResolvedValue([{ tag: 'work', file_count: 5 }]);
    indexTagOccurrencesMock.mockResolvedValue([
      {
        path: '/p/notes.md',
        file_name: 'notes.md',
        context_before: 'about ',
        context_after: ' rocks',
      },
      {
        path: '/p/other.md',
        file_name: 'other.md',
        context_before: 'see ',
        context_after: ' here',
      },
    ]);
    const onPick = vi.fn();

    renderWithProviders(<TagMode filter="" onPick={onPick} />);

    await waitFor(() => expect(screen.getByText('work')).toBeTruthy());
    fireEvent.click(screen.getByText('work'));

    await waitFor(() => expect(screen.getByText('other.md')).toBeTruthy());
    fireEvent.click(screen.getByText('other.md'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({
      kind: 'occurrence',
      filePath: '/p/other.md',
      fileName: 'other.md',
      symbol: '#work',
      occurrenceInFile: 1,
    });
  });

  it('shows the file count for each tag', async () => {
    // Live-test 2026-04-26 (slice 2) — wording changed from "N uses" to
    // "N files" to match the legacy palette and avoid confusion: the
    // count is files-containing-the-tag, not total occurrences.
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'one', file_count: 1 },
    ]);

    renderWithProviders(<TagMode filter="" onPick={() => {}} />);

    await waitFor(() => expect(screen.getByText('work')).toBeTruthy());

    expect(screen.getByText(/12 files/i)).toBeTruthy();
    expect(screen.getByText(/\b1 file/i)).toBeTruthy();
  });

  it('drills into the highlighted tag when ArrowDown then Enter is pressed', async () => {
    // Live-test 2026-04-26 (slice 2) — Enter at level 1 opens the
    // occurrence drilldown, NOT a direct onPick call.
    indexTagsMock.mockResolvedValue([
      { tag: 'first', file_count: 5 },
      { tag: 'second', file_count: 4 },
      { tag: 'third', file_count: 3 },
    ]);
    indexTagOccurrencesMock.mockResolvedValue([
      {
        path: '/p/a.md',
        file_name: 'a.md',
        context_before: '',
        context_after: '',
      },
    ]);
    const onPick = vi.fn();

    renderWithProviders(<TagMode filter="" onPick={onPick} />);

    await waitFor(() => expect(screen.getByText('second')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    // Level-2 view rendered for the SECOND tag.
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    expect(indexTagOccurrencesMock).toHaveBeenCalledWith(
      'second',
      expect.any(Array),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it('renders an empty-state message when no tags match', async () => {
    indexTagsMock.mockResolvedValue([]);

    renderWithProviders(
      <TagMode filter="zzz" onPick={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no tags match/i)).toBeTruthy();
    });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('auto-highlights the first result', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'alpha', file_count: 9 },
      { tag: 'beta', file_count: 4 },
    ]);

    renderWithProviders(
      <TagMode filter="" onPick={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy();
    });

    const rows = screen.getAllByRole('option');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
  });

  // -------------------------------------------------------------------------
  // Issue #38 — discrete checkmark selection indicator
  // -------------------------------------------------------------------------

  it('active tag row shows a data-picker-check element instead of an accent background fill', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'alpha', file_count: 9 },
      { tag: 'beta', file_count: 4 },
    ]);

    const { container } = renderWithProviders(
      <TagMode filter="" onPick={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
    expect(activeRow.querySelector('[data-picker-check]')).toBeTruthy();
  });

  it('inactive tag rows do not show a checkmark', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'alpha', file_count: 9 },
      { tag: 'beta', file_count: 4 },
    ]);

    const { container } = renderWithProviders(
      <TagMode filter="" onPick={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    const inactiveRows = container.querySelectorAll<HTMLElement>('[aria-selected="false"]');
    expect(inactiveRows.length).toBeGreaterThan(0);
    inactiveRows.forEach((row) => {
      expect(row.querySelector('[data-picker-check]')).toBeNull();
    });
  });
});
