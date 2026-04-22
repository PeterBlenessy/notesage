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

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTags: (...args: unknown[]) => indexTagsMock(...args),
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

  it('calls onPick with the bare tag name (no leading #) on click', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'fiction', file_count: 3 },
    ]);
    const onPick = vi.fn();

    renderWithProviders(
      <TagMode filter="" onPick={onPick} />,
    );

    await waitFor(() => {
      expect(screen.getByText('fiction')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('fiction'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('fiction');
  });

  it('shows the usage count for each tag', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'work', file_count: 12 },
      { tag: 'one', file_count: 1 },
    ]);

    renderWithProviders(
      <TagMode filter="" onPick={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText('work')).toBeTruthy();
    });

    expect(screen.getByText(/12 uses/i)).toBeTruthy();
    // Singular form is acceptable but not required; match the count digit.
    expect(screen.getByText(/\b1 use/i)).toBeTruthy();
  });

  it('selects the second result when ArrowDown then Enter is pressed', async () => {
    indexTagsMock.mockResolvedValue([
      { tag: 'first', file_count: 5 },
      { tag: 'second', file_count: 4 },
      { tag: 'third', file_count: 3 },
    ]);
    const onPick = vi.fn();

    renderWithProviders(
      <TagMode filter="" onPick={onPick} />,
    );

    await waitFor(() => {
      expect(screen.getByText('second')).toBeTruthy();
    });

    // Simulate keyboard nav at the document level — the mode picker listens
    // globally so the host bar's input remains focused.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('second');
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
});
