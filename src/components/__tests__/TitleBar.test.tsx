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
};

function setActiveTab(tab: { id: string; fileName: string; isDirty: boolean; lastSavedAt?: number }) {
  editorState.openDocuments = [tab];
  editorState.activeTabId = tab.id;
}

function clearActiveTab() {
  editorState.openDocuments = [];
  editorState.activeTabId = null;
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

    it('renders no buttons at all in quiet mode (the two toggles are the only buttons)', () => {
      renderWithProviders(<TitleBar mode="quiet" />);

      // The title bar's only interactive controls are the two toggles. In
      // quiet mode the right-zone is entirely suppressed — this asserts we
      // aren't accidentally leaving a stray button or a dangling wrapper
      // with role=button.
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

    it('renders a "saved Xs ago" label for a clean tab with lastSavedAt (#131)', () => {
      const tenSecondsAgo = Date.now() - 10_000;
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false, lastSavedAt: tenSecondsAgo });
      renderWithProviders(<TitleBar mode="quiet" />);

      // Should render "saved Ns ago" for N = 10 (±1 second tolerance).
      expect(screen.getByText(/saved \d+s ago/i)).toBeTruthy();
    });

    it('renders an em-dash placeholder for a clean tab without lastSavedAt (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: false });
      renderWithProviders(<TitleBar mode="quiet" />);

      // SavedLabel renders "—" for tabs that have never been saved this session.
      expect(screen.getByLabelText('Not yet saved this session')).toBeTruthy();
    });

    it('suppresses the "saved Xs ago" label while the tab is dirty (#131)', () => {
      setActiveTab({ id: 't1', fileName: 'draft.md', isDirty: true, lastSavedAt: Date.now() - 5_000 });
      renderWithProviders(<TitleBar mode="quiet" />);

      // The saved label should NOT render while the doc is dirty — showing
      // "saved 5s ago" mid-edit would be misleading.
      expect(screen.queryByText(/saved \d+s ago/i)).toBeNull();
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
