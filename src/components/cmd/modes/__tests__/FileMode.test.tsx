// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  waitFor,
} from '@/test/component-harness';

// ---------------------------------------------------------------------------
// Mocks
// vi.mock factories are hoisted — no top-level const refs allowed inside.
// ---------------------------------------------------------------------------

vi.mock('@/lib/command-palette', () => ({
  getDefaultPaletteScope: () => 'all',
  resolveSearchPaths: () => ['/Users/u/proj'],
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexSearchFilenames: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((sel: (s: { showHiddenFiles: boolean }) => unknown) =>
    sel({ showHiddenFiles: false }),
  ),
}));

vi.mock('@/stores/editor-store', () => ({
  useEditorStore: vi.fn(
    (sel: (s: { recentFiles: Array<{ path: string; name: string }> }) => unknown) =>
      sel({
        recentFiles: [
          { path: '/Users/u/proj/alpha.md', name: 'alpha.md' },
          { path: '/Users/u/proj/beta.md', name: 'beta.md' },
        ],
      }),
  ),
}));

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ openFile: vi.fn() }),
}));

// Import AFTER mocks are registered.
import FileMode from '@/components/cmd/modes/FileMode';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileMode', () => {
  it('renders recent files for empty filter', async () => {
    renderWithProviders(<FileMode filter="" onPick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('alpha.md')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Issue #38 — discrete checkmark selection indicator
  // -------------------------------------------------------------------------

  it('active file row shows a data-picker-check element instead of an accent background fill', async () => {
    const { container } = renderWithProviders(
      <FileMode filter="" onPick={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('alpha.md')).toBeTruthy());

    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
    expect(activeRow.querySelector('[data-picker-check]')).toBeTruthy();
  });

  it('inactive file rows do not show a checkmark', async () => {
    const { container } = renderWithProviders(
      <FileMode filter="" onPick={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('alpha.md')).toBeTruthy());

    const inactiveRows = container.querySelectorAll<HTMLElement>('[aria-selected="false"]');
    expect(inactiveRows.length).toBeGreaterThan(0);
    inactiveRows.forEach((row) => {
      expect(row.querySelector('[data-picker-check]')).toBeNull();
    });
  });
});
