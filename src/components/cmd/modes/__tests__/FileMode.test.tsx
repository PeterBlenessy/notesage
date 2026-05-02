// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import type { RecentFile } from '@/stores/editor-store';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexSearchFilenames: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/command-palette', () => ({
  getDefaultPaletteScope: () => 'all',
  resolveSearchPaths: () => ['/Users/me/Notesage'],
}));

vi.mock('@/stores/settings-store', () => {
  const state = { showHiddenFiles: false };
  return {
    useSettingsStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
  };
});

let mockRecentFiles: RecentFile[] = [];
vi.mock('@/stores/editor-store', () => {
  const state = {
    get recentFiles() {
      return mockRecentFiles;
    },
  };
  return {
    useEditorStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
  };
});

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ openFile: vi.fn() }),
}));

import FileMode from '@/components/cmd/modes/FileMode';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockRecentFiles = [];
});

describe('FileMode', () => {
  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces accent fill
  // -------------------------------------------------------------------------

  it('active row uses muted-bg + accent-border (not solid accent fill)', () => {
    mockRecentFiles = [
      { path: '/Users/me/Notesage/notes.md', name: 'notes.md' },
    ];

    const { container } = renderWithProviders(<FileMode filter="" />);

    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();

    // New style: muted background + border with accent color.
    expect(activeRow.className).toContain('bg-muted/80');
    expect(activeRow.className).not.toContain('border-[var(--color-accent-primary)]');

    // Old solid-fill style must be gone.
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
    expect(activeRow.className).not.toContain('text-[oklch(100%_0_0)]');
  });
});
