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

vi.mock('@/stores/settings-store', () => {
  const state = { chatPanelOpen: false };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

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

vi.mock('@/stores/activity-store', () => {
  const state = {
    isManuallyHidden: true,
    tasks: [] as Array<{ status: string }>,
  };
  return {
    useActivityStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
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

  describe('classic mode (default)', () => {
    it('renders both toggle buttons when mode is omitted (defaults to classic)', () => {
      renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      // Chat toggle (MessageSquare icon) is reachable via its aria-label.
      expect(screen.getByRole('button', { name: /show ai chat/i })).toBeTruthy();
      // Activity-strip toggle (Bot icon).
      expect(screen.getByRole('button', { name: /show agent panel/i })).toBeTruthy();
    });

    it('renders both toggle buttons when mode="classic" is explicit', () => {
      renderWithProviders(
        <TitleBar
          mode="classic"
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /show ai chat/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /show agent panel/i })).toBeTruthy();
    });

    it('still renders the document title (chrome) in classic mode', () => {
      renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      // No active tab → title falls back to "Notesage".
      expect(screen.getByText('Notesage')).toBeTruthy();
    });

    it('fires onToggleChat when the chat button is clicked', () => {
      const onToggleChat = vi.fn();
      renderWithProviders(
        <TitleBar
          onToggleChat={onToggleChat}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      (screen.getByRole('button', { name: /show ai chat/i }) as HTMLButtonElement).click();
      expect(onToggleChat).toHaveBeenCalledOnce();
    });

    it('fires onToggleActivityStrip when the agent button is clicked', () => {
      const onToggleActivityStrip = vi.fn();
      renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={onToggleActivityStrip}
        />,
      );

      (screen.getByRole('button', { name: /show agent panel/i }) as HTMLButtonElement).click();
      expect(onToggleActivityStrip).toHaveBeenCalledOnce();
    });
  });

  describe('quiet mode (tasks #103 + #124)', () => {
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
      // document × button render. This guards against accidentally
      // leaving stray classic-mode buttons or wrappers with role=button.
      // (When a tab IS active, the close-document × button does render —
      // see the dedicated tests further down.)
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

    it('marks the title bar root with data-titlebar-mode="classic" by default', () => {
      const { container } = renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );
      const root = container.querySelector('[data-titlebar-mode]') as HTMLElement;
      expect(root).toBeTruthy();
      expect(root.getAttribute('data-titlebar-mode')).toBe('classic');
    });

    // ---------------------------------------------------------------------
    // #131 — DocHead breadcrumb removed; dirty dot + "saved Xs ago"
    // moved into TitleBar's quiet-mode right zone. The classic shell keeps
    // its TabBar-owned dirty dots and does NOT render these two indicators.
    // ---------------------------------------------------------------------

    it('renders the filename from the active tab (not "Notesage") when a tab is active (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.getByText('draft.md')).toBeTruthy();
    });

    it('renders the dirty dot when the active tab is dirty (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true });
      const { container } = renderWithProviders(<TitleBar mode="quiet" />);

      // Dirty dot is a role=status span with aria-label="Unsaved changes".
      const dot = container.querySelector('[aria-label="Unsaved changes"]');
      expect(dot).toBeTruthy();
    });

    it('does NOT render the dirty dot when the active tab is clean (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      const { container } = renderWithProviders(<TitleBar mode="quiet" />);

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
      renderWithProviders(<TitleBar mode="quiet" />);

      expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
    });

    it('does NOT render an em-dash placeholder for a clean tab without lastSavedAt (live-test 2026-04-26)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      // The right zone is now empty for clean tabs — no SavedLabel,
      // no em-dash, no aria-labelled placeholder.
      expect(screen.queryByLabelText('Not yet saved this session')).toBeNull();
    });

    it('suppresses any saved-ago readout while the tab is dirty (live-test 2026-04-26)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true, lastSavedAt: Date.now() - 5_000 });
      renderWithProviders(<TitleBar mode="quiet" />);

      // Even pre-2026-04-26 the saved label was suppressed mid-edit;
      // post-relocation it's not in the TitleBar at all.
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

      // Dirty tab must NOT close immediately — same contract as ⌘W and the
      // legacy TabBar X. The user-facing AlertDialog is mounted by TabBar
      // in the classic shell; in quiet mode this still flips
      // `pendingCloseTabId` so any future quiet-mode dialog can pick it up.
      expect(editorState.setPendingCloseTabId).toHaveBeenCalledWith('t1');
      expect(editorState.closeTab).not.toHaveBeenCalled();
    });

    it('does NOT render the close-document × button in classic mode', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      // Classic shell uses the TabBar X; the TitleBar must not duplicate it.
      expect(screen.queryByRole('button', { name: /close document/i })).toBeNull();
    });

    it('renders NO dirty-dot / saved-ago chrome in classic mode (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true, lastSavedAt: Date.now() - 5_000 });
      const { container } = renderWithProviders(
        <TitleBar
          onToggleChat={vi.fn()}
          onToggleActivityStrip={vi.fn()}
        />,
      );

      // Classic shell's TabBar owns the per-tab dirty dot; TitleBar must
      // not duplicate it.
      expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
      expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
    });
  });
});
