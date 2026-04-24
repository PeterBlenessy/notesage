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

vi.mock('@/stores/editor-store', () => {
  const state = {
    openDocuments: [],
    activeTabId: null,
  };
  return {
    useEditorStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
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
  });
});
