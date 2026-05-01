// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/test/component-harness';
import type { IndexResearchResult } from '@/lib/tauri';
import type { AttachmentChip } from '@/components/cmd/AttachmentChips';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Spy that lets each test choose what `indexSearchResearch` returns and
// inspect the arguments it was called with.
const indexSearchResearchMock = vi.fn<
  (
    projectPaths: string[],
    query?: string,
    tag?: string,
    limit?: number,
  ) => Promise<IndexResearchResult[]>
>();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexSearchResearch: (...args: Parameters<typeof indexSearchResearchMock>) =>
      indexSearchResearchMock(...args),
  },
}));

// Stub out the path resolver — the picker only cares that paths are passed
// through to the Tauri command, not where they came from.
vi.mock('@/lib/command-palette', () => ({
  getDefaultPaletteScope: () => 'all',
  resolveSearchPaths: () => ['/Users/u/Notesage/.notesage/research'],
}));

// Import AFTER mocks are registered so the component picks them up.
import ResearchMode from '@/components/cmd/modes/ResearchMode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<IndexResearchResult> = {}): IndexResearchResult {
  return {
    file: '/Users/u/Notesage/.notesage/research/sample.md',
    title: 'Sample research',
    tags: ['climate'],
    source_url: 'https://example.com/article',
    snippet: 'A brief snippet of the article body.',
    date_saved: '2026-04-01',
    word_count: 1234,
    ...overrides,
  };
}

beforeEach(() => {
  indexSearchResearchMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResearchMode', () => {
  it('shows top results when filter is empty (passes empty query to backend)', async () => {
    const results: IndexResearchResult[] = [
      makeResult({ file: '/r/a.md', title: 'Alpha paper' }),
      makeResult({ file: '/r/b.md', title: 'Beta paper' }),
      makeResult({ file: '/r/c.md', title: 'Gamma paper' }),
    ];
    indexSearchResearchMock.mockResolvedValue(results);

    renderWithProviders(<ResearchMode filter="" onPick={() => {}} />);

    const { findByText } = screen;
    await findByText('Alpha paper');
    expect(screen.getByText('Beta paper')).toBeTruthy();
    expect(screen.getByText('Gamma paper')).toBeTruthy();

    // Backend was invoked at least once with an empty string query.
    expect(indexSearchResearchMock).toHaveBeenCalled();
    const firstCallArgs = indexSearchResearchMock.mock.calls[0];
    // [paths, query, tag, limit]
    expect(firstCallArgs[1]).toBe('');
  });

  it('passes the user filter as the query parameter to the Tauri command', async () => {
    indexSearchResearchMock.mockResolvedValue([
      makeResult({ title: 'Climate paper' }),
    ]);

    renderWithProviders(
      <ResearchMode filter="climate" onPick={() => {}} />,
    );

    await screen.findByText('Climate paper');
    const firstCallArgs = indexSearchResearchMock.mock.calls[0];
    expect(firstCallArgs[1]).toBe('climate');
    // Live-test 2026-04-26 — limit bumped 10 → 50 to match the legacy
    // palette. The bar's picker tray is `overflow-y-auto` so a long
    // result list scrolls instead of overflowing.
    expect(firstCallArgs[3]).toBe(50);
  });

  it('clicking a row fires onPick with { kind: "research", id, name }', async () => {
    const result = makeResult({
      file: '/Users/u/Notesage/.notesage/research/article.md',
      title: 'Important article',
    });
    indexSearchResearchMock.mockResolvedValue([result]);

    const onPick = vi.fn<(chip: AttachmentChip) => void>();
    renderWithProviders(<ResearchMode filter="" onPick={onPick} />);

    const row = await screen.findByText('Important article');
    fireEvent.click(row);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({
      id: '/Users/u/Notesage/.notesage/research/article.md',
      kind: 'research',
      name: 'Important article',
    });
  });

  it('shows the source URL on each result row', async () => {
    indexSearchResearchMock.mockResolvedValue([
      makeResult({
        title: 'Paper A',
        source_url: 'https://nature.com/articles/abc',
      }),
    ]);

    renderWithProviders(<ResearchMode filter="" onPick={() => {}} />);

    await screen.findByText('Paper A');
    // Either the full URL or the hostname is acceptable — the picker shows
    // a recognisable source identifier.
    const url = screen.queryByText(/nature\.com/);
    expect(url).toBeTruthy();
  });

  it('arrow-down then Enter selects the second result', async () => {
    const onPick = vi.fn<(chip: AttachmentChip) => void>();
    indexSearchResearchMock.mockResolvedValue([
      makeResult({ file: '/r/first.md', title: 'First' }),
      makeResult({ file: '/r/second.md', title: 'Second' }),
      makeResult({ file: '/r/third.md', title: 'Third' }),
    ]);

    const { container } = renderWithProviders(
      <ResearchMode filter="" onPick={onPick} />,
    );
    await screen.findByText('First');

    // The picker listens for arrow keys on the document so the parent input
    // can keep focus; dispatching on document mirrors how the bar will use it.
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({
      kind: 'research',
      name: 'Second',
      id: '/r/second.md',
    });
  });

  it('renders "No research matches" when the index returns an empty array', async () => {
    indexSearchResearchMock.mockResolvedValue([]);

    renderWithProviders(
      <ResearchMode filter="anything" onPick={() => {}} />,
    );

    // Wait for the call to settle.
    await screen.findByText('No research matches');
  });

  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces solid fill
  // -------------------------------------------------------------------------

  it('active row uses muted bg with accent border instead of solid accent fill (#88)', async () => {
    indexSearchResearchMock.mockResolvedValue([
      makeResult({ file: '/r/alpha.md', title: 'Alpha' }),
    ]);
    const { container } = renderWithProviders(
      <ResearchMode filter="" onPick={() => {}} />,
    );
    await screen.findByText('Alpha');
    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    // New styling
    expect(activeRow.classList.contains('bg-muted')).toBe(true);
    expect(activeRow.className).toContain('border-[var(--color-accent-primary)]');
    expect(activeRow.classList.contains('text-foreground')).toBe(true);
    // Old solid accent fill must be gone
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
