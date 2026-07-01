// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { TitleBar } from '@/components/TitleBar';

// ---------------------------------------------------------------------------
// Mock the three stores TitleBar reads — keep the shape minimal.
// ---------------------------------------------------------------------------

// Mutable editor-store state so per-test `setActiveTab()` can seed a tab
// for the #131 quiet-mode dirty-dot + saved-ago assertions.
const editorState = {
  openDocuments: [] as Array<{
    id: string;
    fileName: string;
    isDirty: boolean;
    lastSavedAt?: number;
  }>,
  activeTabId: null as string | null,
  closeTab: vi.fn(),
  setPendingCloseTabId: vi.fn(),
};

function setActiveTab(tab: { id: string; fileName: string; isDirty: boolean; lastSavedAt?: number }) {
  editorState.openDocuments = [tab];
  editorState.activeTabId = tab.id;
}

function clearActiveTab() {
  editorState.openDocuments = [];
  editorState.activeTabId = null;
  editorState.closeTab.mockReset();
  editorState.setPendingCloseTabId.mockReset();
}

vi.mock('@/stores/editor-store', () => {
  return {
    useEditorStore: Object.assign(
      vi.fn((sel: (s: typeof editorState) => unknown) => sel(editorState)),
      { getState: () => editorState },
    ),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TitleBar', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    clearActiveTab();
  });

  // -----------------------------------------------------------------------
  // Landing page (no active tab)
  // -----------------------------------------------------------------------

  it('renders no buttons at all on the landing page', () => {
    // beforeEach() clears the active tab. With no active tab the right
    // zone is entirely empty — neither the dirty dot nor the close-
    // document × button render.
    renderWithProviders(<TitleBar />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('falls back to the "Notesage" title when no tab is active', () => {
    renderWithProviders(<TitleBar />);

    expect(screen.getByText('Notesage')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Active tab — title, dirty dot, close button
  // -----------------------------------------------------------------------

  it('renders the filename from the active tab when a tab is active (#131)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
    renderWithProviders(<TitleBar />);

    expect(screen.getByText('draft.md')).toBeTruthy();
  });

  it('renders the dirty dot when the active tab is dirty (#131)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true });
    const { container } = renderWithProviders(<TitleBar />);

    // Dirty dot is a role=status span with aria-label="Unsaved changes".
    const dot = container.querySelector('[aria-label="Unsaved changes"]');
    expect(dot).toBeTruthy();
  });

  it('does NOT render the dirty dot when the active tab is clean (#131)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
    const { container } = renderWithProviders(<TitleBar />);

    expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  });

  // Live-test 2026-04-26 — the "saved Xs ago" label moved out of
  // the TitleBar and into the StatusBar (next to the word count),
  // and the em-dash placeholder for never-saved clean tabs was
  // dropped entirely so the right zone is empty for clean docs.
  // The TitleBar now only renders the dirty dot when dirty.

  it('does NOT render a "saved Xs ago" label for a clean tab (moved to StatusBar 2026-04-26)', () => {
    const tenSecondsAgo = Date.now() - 10_000;
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false, lastSavedAt: tenSecondsAgo });
    renderWithProviders(<TitleBar />);

    expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
  });

  it('suppresses any saved-ago readout while the tab is dirty (live-test 2026-04-26)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true, lastSavedAt: Date.now() - 5_000 });
    renderWithProviders(<TitleBar />);

    expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Live-test 2026-04-26 — close-document × button. Quiet Composer has no
  // TabBar (intentional); the TitleBar carries the only visible "close
  // active document" affordance. Wires through the same closeTab /
  // setPendingCloseTabId flow ⌘W uses, so warn-if-dirty stays consistent.
  // ---------------------------------------------------------------------

  it('renders the close-document × button when a tab is active', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
    renderWithProviders(<TitleBar />);

    expect(screen.getByRole('button', { name: /close document/i })).toBeTruthy();
  });

  it('does NOT render the close-document × button on the landing page (no active tab)', () => {
    renderWithProviders(<TitleBar />);

    expect(screen.queryByRole('button', { name: /close document/i })).toBeNull();
  });

  it('clicking × on a clean active tab calls closeTab(activeTabId)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
    renderWithProviders(<TitleBar />);

    (screen.getByRole('button', { name: /close document/i }) as HTMLButtonElement).click();

    expect(editorState.closeTab).toHaveBeenCalledWith('t1');
    expect(editorState.setPendingCloseTabId).not.toHaveBeenCalled();
  });

  it('clicking × on a dirty active tab routes through setPendingCloseTabId (warn flow)', () => {
    setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true });
    renderWithProviders(<TitleBar />);

    (screen.getByRole('button', { name: /close document/i }) as HTMLButtonElement).click();

    // Dirty tab must NOT close immediately — same contract as ⌘W.
    expect(editorState.setPendingCloseTabId).toHaveBeenCalledWith('t1');
    expect(editorState.closeTab).not.toHaveBeenCalled();
  });
});
