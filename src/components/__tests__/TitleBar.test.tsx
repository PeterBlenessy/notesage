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
// Mock the stores TitleBar reads.
// ---------------------------------------------------------------------------

// Mutable editor-store state so per-test `setActiveTab()` can seed a tab
// for the dirty-dot + saved-ago assertions.
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

  describe('quiet mode', () => {
    it('does NOT render the chat toggle button', () => {
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByRole('button', { name: /show ai chat/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /hide ai chat/i })).toBeNull();
    });

    it('does NOT render the activity-strip toggle button', () => {
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByRole('button', { name: /show agent panel/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /hide agent panel/i })).toBeNull();
    });

    it('renders no buttons at all on the landing page in quiet mode', () => {
      // beforeEach() clears the active tab. With no active tab the right
      // zone is entirely empty — neither the dirty dot nor the close-
      // document × button render.
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('still renders the title chrome (drag region, document title) in quiet mode', () => {
      renderWithProviders(<TitleBar mode="quiet" />);

      // Document title is the core piece of chrome we must keep.
      expect(screen.getByText('Notesage')).toBeTruthy();
    });

    it('marks the title bar root with data-titlebar-mode="quiet" for CSS hooks', () => {
      const { container } = renderWithProviders(<TitleBar mode="quiet" />);
      const root = container.querySelector('[data-titlebar-mode]') as HTMLElement;
      expect(root).toBeTruthy();
      expect(root.getAttribute('data-titlebar-mode')).toBe('quiet');
    });

    it('renders the filename from the active tab (not "Notesage") when a tab is active', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.getByText('draft.md')).toBeTruthy();
    });

    it('renders the dirty dot when the active tab is dirty', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true });
      const { container } = renderWithProviders(<TitleBar mode="quiet" />);

      // Dirty dot is a role=status span with aria-label="Unsaved changes".
      const dot = container.querySelector('[aria-label="Unsaved changes"]');
      expect(dot).toBeTruthy();
    });

    it('does NOT render the dirty dot when the active tab is clean', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      const { container } = renderWithProviders(<TitleBar mode="quiet" />);

      expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    });

    it('does NOT render a "saved Xs ago" label for a clean tab (moved to StatusBar)', () => {
      const tenSecondsAgo = Date.now() - 10_000;
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false, lastSavedAt: tenSecondsAgo });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
    });

    it('does NOT render an em-dash placeholder for a clean tab without lastSavedAt', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByLabelText('Not yet saved this session')).toBeNull();
    });

    it('suppresses any saved-ago readout while the tab is dirty', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true, lastSavedAt: Date.now() - 5_000 });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
    });

    it('renders the close-document × button when a tab is active', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.getByRole('button', { name: /close document/i })).toBeTruthy();
    });

    it('does NOT render the close-document × button on the landing page (no active tab)', () => {
      // beforeEach() already calls clearActiveTab().
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByRole('button', { name: /close document/i })).toBeNull();
    });

    it('clicking × on a clean active tab calls closeTab(activeTabId)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      (screen.getByRole('button', { name: /close document/i }) as HTMLButtonElement).click();

      expect(editorState.closeTab).toHaveBeenCalledWith('t1');
      expect(editorState.setPendingCloseTabId).not.toHaveBeenCalled();
    });

    it('clicking × on a dirty active tab routes through setPendingCloseTabId (warn flow)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true });
      renderWithProviders(<TitleBar mode="quiet" />);

      (screen.getByRole('button', { name: /close document/i }) as HTMLButtonElement).click();

      expect(editorState.setPendingCloseTabId).toHaveBeenCalledWith('t1');
      expect(editorState.closeTab).not.toHaveBeenCalled();
    });
  });
});
