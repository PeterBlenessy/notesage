// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import FloatingCommandBar from '@/components/cmd/FloatingCommandBar';
import { emitCmdBarEvent } from '@/lib/cmd-bar-events';

// ---------------------------------------------------------------------------
// Mock useReducedMotion — flipped per-test via mockReturnValue
// ---------------------------------------------------------------------------

const useReducedMotionMock = vi.fn<() => boolean>(() => false);

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

// ---------------------------------------------------------------------------
// Mock settings-store so we can flip `cmdBarPinned` and assert
// `setCmdBarPinnedWidth` calls without going through the real Zustand store.
// ---------------------------------------------------------------------------

const setCmdBarPinnedMock = vi.fn<(pinned: boolean) => void>();
const setCmdBarPinnedWidthMock = vi.fn<(width: number) => void>();
const setCmdBarExpandedHeightMock = vi.fn<(height: number) => void>();
let mockCmdBarPinned = false;
let mockCmdBarPinnedWidth = 400;
let mockCmdBarExpandedHeight = 480;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
    get cmdBarPinnedWidth() { return mockCmdBarPinnedWidth; },
    get cmdBarExpandedHeight() { return mockCmdBarExpandedHeight; },
    setCmdBarPinned: (v: boolean) => setCmdBarPinnedMock(v),
    setCmdBarPinnedWidth: (v: number) => setCmdBarPinnedWidthMock(v),
    setCmdBarExpandedHeight: (v: number) => setCmdBarExpandedHeightMock(v),
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// Stub AttachmentChips so we can detect its presence without exercising its
// real rendering surface here. The chip component has its own dedicated test
// file. We just want to confirm FloatingCommandBar mounts it once when
// expanded — the stub also exposes the chip count so #23 send tests can
// assert chips are cleared after send.
vi.mock('@/components/cmd/AttachmentChips', () => ({
  __esModule: true,
  default: ({ chips }: { chips: Array<{ id: string }> }) => (
    <div data-testid="chips-stub" data-chip-count={chips.length} />
  ),
}));

// Stub CommandBarContext so this test focuses on the bar shell.
// (Verifying the context row's wiring lives in CommandBarContext.test.tsx.)
vi.mock('@/components/cmd/CommandBarContext', () => ({
  default: () => <div data-testid="ctx-stub">context</div>,
}));

// Stub CommandBarStream so the FloatingCommandBar tests stay focused on the
// outer chrome (#9). The stream's own test file covers its behaviour.
vi.mock('@/components/cmd/CommandBarStream', () => ({
  default: () => <div data-testid="cmd-stream-stub">stream</div>,
}));

// Stub all 6 mode pickers (#14–#19). They each have their own dedicated test
// file. The FloatingCommandBar test verifies that the dispatcher mounts the
// right picker for the active prefix, not the picker's internals.
//
// SkillMode also forwards `listboxId` + `onActiveOptionChange` so the ARIA
// wiring tests (#78) can verify the combobox attributes update as the
// picker reports active-option info upward.
vi.mock('@/components/cmd/modes/SkillMode', async () => {
  const React = await import('react');
  return {
    default: ({
      listboxId,
      onActiveOptionChange,
    }: {
      filter: string;
      onPick: (name: string) => void;
      listboxId?: string;
      onActiveOptionChange?: (info: {
        listboxId: string;
        activeOptionId: string | null;
        count: number;
      }) => void;
    }) => {
      const id = listboxId ?? 'cmd-skill-listbox';
      const [activeIndex, setActiveIndex] = React.useState(0);
      // Mock 3 options so we can drive ↓ keyboard navigation.
      const count = 3;
      React.useEffect(() => {
        onActiveOptionChange?.({
          listboxId: id,
          activeOptionId: count > 0 ? `${id}-opt-${activeIndex}` : null,
          count,
        });
      }, [id, activeIndex, onActiveOptionChange]);
      return (
        <div
          data-testid="skill-mode-stub"
          id={id}
          role="listbox"
          tabIndex={-1}
        >
          <button
            type="button"
            data-testid="skill-mode-down"
            onClick={() => setActiveIndex((i) => (i + 1) % count)}
          >
            down
          </button>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              opt {i}
            </div>
          ))}
        </div>
      );
    },
  };
});
vi.mock('@/components/cmd/modes/ReferenceMode', () => ({
  default: ({ onPick }: { filter: string; onPick: (chip: { id: string; kind: 'file'; name: string }) => void }) => (
    <div data-testid="reference-mode-stub">
      <button
        type="button"
        data-testid="reference-mode-add-chip"
        onClick={() => onPick({ id: 'file:/abs/notes.md', kind: 'file', name: 'notes.md' })}
      >
        add chip
      </button>
    </div>
  ),
}));
vi.mock('@/components/cmd/modes/TagMode', () => ({
  default: () => <div data-testid="tag-mode-stub" />,
}));
vi.mock('@/components/cmd/modes/TaskMode', () => ({
  default: () => <div data-testid="task-mode-stub" />,
}));
vi.mock('@/components/cmd/modes/ResearchMode', () => ({
  default: () => <div data-testid="research-mode-stub" />,
}));
vi.mock('@/components/cmd/modes/PaletteMode', () => ({
  default: () => <div data-testid="palette-mode-stub" />,
}));
vi.mock('@/components/cmd/modes/FileMode', () => ({
  default: ({ filter }: { filter: string }) => (
    <div data-testid="file-mode-stub" data-filter={filter} />
  ),
}));

// ---------------------------------------------------------------------------
// Mock useAIOperations + chat-store so #23 can assert send wiring without
// dragging the full provider/credentials/streaming stack into the test.
// ---------------------------------------------------------------------------

const sendChatMessageMock = vi.fn<(content: string, messages: unknown[], opts?: unknown) => Promise<void>>(
  () => Promise.resolve(),
);

vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: () => ({
    sendChatMessage: sendChatMessageMock,
    generateText: vi.fn(),
    cancelChat: vi.fn(),
  }),
}));

vi.mock('@/stores/chat-store', () => {
  // State surface for the selectors used by FloatingCommandBar. Keep
  // minimal — the bar reads `isLoading` directly and `setActiveConversation`
  // via store API; history mode (#118) reads `selectProjectPaths`.
  const state = {
    isLoading: false,
    setActiveConversation: vi.fn(),
  };
  function useChatStore<T>(selector: (s: typeof state) => T): T {
    return selector(state);
  }
  return {
    useChatStore: Object.assign(useChatStore, {
      getState: () => state,
    }),
    selectMessages: () => [],
    // #118 — the history-mode selector is a pure projection of
    // `conv.projectPaths`. Stubbed to an empty list; the ChatHistoryView
    // render is mocked separately.
    selectProjectPaths: () => [],
    // Live-test 2026-04-26 audit gap #10 — pending-switch selectors
    // for the disabled-input wiring. Both nullish in the test surface
    // since we don't exercise the AgentSwitchCard flow here.
    selectPendingProjectSwitch: () => null,
    selectPendingAgentSwitch: () => null,
  };
});

// useChatSwitchPrompts pulls from chat-store / connections-store / routing-store /
// project-metadata-store and runs effects that write back to chat-store. None
// of those side-effects matter for FloatingCommandBar's own behaviour, so
// stub the hook to a no-op in this test surface.
vi.mock('@/hooks/useChatSwitchPrompts', () => ({
  useChatSwitchPrompts: () => undefined,
}));

// #118 — ChatHistoryView pulls in the full chat stack (providers, routing).
// Stub to a visible marker so tests can assert the history view renders
// without dragging the rest of the chat tree into the mock surface.
vi.mock('@/components/chat/ChatHistoryView', () => ({
  ChatHistoryView: () => <div data-testid="chat-history-stub" />,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FloatingCommandBar', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    // Reset mocked settings-store state.
    mockCmdBarPinned = false;
    mockCmdBarPinnedWidth = 400;
    mockCmdBarExpandedHeight = 480;
    setCmdBarPinnedMock.mockReset();
    setCmdBarPinnedWidthMock.mockReset();
    setCmdBarExpandedHeightMock.mockReset();
    sendChatMessageMock.mockReset();
    sendChatMessageMock.mockImplementation(() => Promise.resolve());
    // Clean DOM between tests — portals leak otherwise
    document.body.innerHTML = '';
    // Also clean the CSS variables that resize handles set on <html>
    document.documentElement.style.removeProperty('--cmd-bar-pinned-width');
    document.documentElement.style.removeProperty('--cmd-bar-expanded-height');
  });

  it('renders compact state by default with the placeholder hint visible', () => {
    renderWithProviders(<FloatingCommandBar />);
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
    // The input must NOT be present in compact state.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('expands to show an autofocused input when the compact pill is clicked', () => {
    renderWithProviders(<FloatingCommandBar />);
    const compact = screen.getByText(/press ⌘k to ask/i);
    fireEvent.click(compact);

    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input).toBeTruthy();
    // Autofocus should be active on expansion.
    expect(document.activeElement).toBe(input);
    // CommandBarStream (#12) mounts inside the expanded bar.
    expect(screen.getByTestId('cmd-stream-stub')).toBeTruthy();
  });

  it('collapses back to compact when Escape is pressed in the expanded input', () => {
    // Live-test 2026-04-25: Esc handling moved off the input keydown
    // onto the cmd-bar-events bus (single source of truth so the
    // window-level shortcut hook + the input don't double-fire and
    // skip the prefix-clear stage). Drive the bus directly here —
    // `useCommandBarShortcuts` (which normally bridges keyDown → bus)
    // isn't mounted in this isolated component test.
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    expect(screen.getByRole('combobox')).toBeTruthy();
    act(() => emitCmdBarEvent({ type: 'dismiss' }));

    // Compact placeholder is back, input is gone.
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('portals to document.body when not pinned (bar is NOT inside the result container)', () => {
    const { container } = renderWithProviders(<FloatingCommandBar />);

    // The placeholder text is in the DOM via portal — findable by screen
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
    // ...but NOT inside the React render container — portals escape it.
    expect(container.querySelector('[data-cmd-bar]')).toBeNull();
    // The bar should be somewhere on document.body
    expect(document.body.querySelector('[data-cmd-bar]')).toBeTruthy();
  });

  it('renders inline (not via portal) when isPinned is true', () => {
    const { container } = renderWithProviders(<FloatingCommandBar isPinned />);

    // When pinned, the bar lives directly inside the render container.
    expect(container.querySelector('[data-cmd-bar]')).toBeTruthy();
  });

  it('mounts CommandBarContext when expanded', () => {
    renderWithProviders(<FloatingCommandBar />);
    // Compact state: the context stub is NOT mounted.
    expect(screen.queryByTestId('ctx-stub')).toBeNull();

    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    // Expanded state: the context stub appears above the input.
    expect(screen.getByTestId('ctx-stub')).toBeTruthy();
  });

  it('selecting a file reference dispatches an open-file event and does NOT add a chip', () => {
    // Live-test 2026-04-26 — the chip-attach UX from earlier rounds was
    // dropped. Picking a file reference now navigates: it dispatches
    // `notesage:open-file` so App.tsx routes to `openFile`, and the
    // chips state is left untouched. Esc dismisses; the bar + picker
    // stay open so a wrong pick is one Enter away.
    renderWithProviders(<FloatingCommandBar />);
    expect(document.querySelectorAll('[data-chip-kind]').length).toBe(0);

    const events: Array<{ filePath?: string; fileName?: string }> = [];
    const handler = (e: Event) => {
      events.push((e as CustomEvent).detail ?? {});
    };
    window.addEventListener('notesage:open-file', handler);

    try {
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '@' } });
      fireEvent.click(screen.getByTestId('reference-mode-add-chip'));

      expect(events).toHaveLength(1);
      expect(events[0].fileName).toBe('notes.md');
      // No chip was added — the picker is a navigation intent now.
      expect(document.querySelectorAll('[data-chip-kind]').length).toBe(0);
    } finally {
      window.removeEventListener('notesage:open-file', handler);
    }
  });

  it('skips the lift transition when prefers-reduced-motion is reduce', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderWithProviders(<FloatingCommandBar />);

    const bar = document.body.querySelector('[data-cmd-bar]') as HTMLElement;
    expect(bar).toBeTruthy();
    // No transition utilities applied when reduced-motion is requested.
    expect(bar.className).not.toMatch(/transition-/);
    expect(bar.className).not.toMatch(/duration-/);
  });

  it('shows a mode badge when typing a prefix character ("/")', () => {
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });

    // Badge announces the active mode for screen readers + visual users.
    const badge = document.body.querySelector(
      '[data-cmd-bar-prefix-badge]',
    ) as HTMLElement | null;
    expect(badge).toBeTruthy();
    expect(badge!.textContent ?? '').toMatch(/skill/i);

    // The bar's data attribute also reflects the active mode (handy for
    // styling and for downstream pickers in #14–#19).
    const bar = document.body.querySelector('[data-cmd-bar]') as HTMLElement;
    expect(bar.getAttribute('data-prefix-mode')).toBe('skill');
  });

  it('first Esc clears the active prefix; second Esc collapses the bar', () => {
    // Live-test 2026-04-25: Esc handling moved off the input onto the
    // cmd-bar-events bus. Drive via `emitCmdBarEvent({ type: 'dismiss' })`
    // — `useCommandBarShortcuts` isn't mounted here.
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });

    // Sanity: badge is up.
    expect(
      document.body.querySelector('[data-cmd-bar-prefix-badge]'),
    ).toBeTruthy();

    // First dismiss → badge gone, bar still expanded, input intact.
    act(() => emitCmdBarEvent({ type: 'dismiss' }));
    expect(
      document.body.querySelector('[data-cmd-bar-prefix-badge]'),
    ).toBeNull();
    expect(screen.queryByRole('combobox')).toBeTruthy();

    // Second dismiss → bar collapses.
    act(() => emitCmdBarEvent({ type: 'dismiss' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
  });

  it('preserves the typed draft across collapse and restores it on reopen', () => {
    // Closing the bar (Esc, or opening Settings — which dispatches a synthetic
    // Escape) used to wipe the input. The draft must survive collapse and come
    // back on reopen; only an actual send (or the explicit X) clears it.
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'half-written thought' } });

    // Dismiss collapses the bar (no prefix → single stage).
    act(() => emitCmdBarEvent({ type: 'dismiss' }));
    expect(screen.queryByRole('combobox')).toBeNull();

    // Reopen — the draft is still there.
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));
    const reopened = screen.getByRole('combobox') as HTMLInputElement;
    expect(reopened.value).toBe('half-written thought');
  });

  it.each([
    ['/', 'skill-mode-stub'],
    ['@', 'reference-mode-stub'],
    ['#', 'tag-mode-stub'],
    ['!', 'task-mode-stub'],
    ['?', 'research-mode-stub'],
    ['>', 'palette-mode-stub'],
  ])('mounts the right picker for prefix "%s"', (prefix, stubTestId) => {
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: prefix } });

    expect(screen.getByTestId(stubTestId)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Verb prefix wiring (PRD `2026-04-28-cmd-bar-verb-prefixes`, #11 + #12)
  // -------------------------------------------------------------------------

  describe('verb prefix wiring', () => {
    it('⌘⇧F chord seeds the bar with `:file ` and mounts FileMode (#11)', async () => {
      renderWithProviders(<FloatingCommandBar />);
      // Bar starts collapsed.
      expect(screen.queryByTestId('file-mode-stub')).toBeNull();

      // Emit the focus event the keyboard hook would emit on ⌘⇧F.
      act(() => {
        emitCmdBarEvent({ type: 'focus', prefix: ':file ' });
      });

      const stub = await screen.findByTestId('file-mode-stub');
      expect(stub.getAttribute('data-filter')).toBe('');
      // Input is prefilled with the verb prefix so the cursor lands
      // in the filter slot.
      const input = screen.getByRole('combobox') as HTMLInputElement;
      expect(input.value).toBe(':file ');
    });

    it('typing `:` shows the verb discovery menu (#7 wiring + #4 registry)', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: ':' } });
      // Discovery menu surfaces every registered verb. We only check
      // for the `file` verb name to avoid fragile assertions about
      // the full registry.
      expect(screen.getByText(/:file/)).toBeTruthy();
    });

    it('typing `:fi` keeps the discovery menu (no full match yet)', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: ':fi' } });
      // Discovery menu (FileMode is NOT mounted yet — verb is unmatched).
      expect(screen.queryByTestId('file-mode-stub')).toBeNull();
      expect(screen.getByText(/:file/)).toBeTruthy();
    });

    it('typing `:file ` mounts FileMode with empty filter', async () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: ':file ' } });
      const stub = await screen.findByTestId('file-mode-stub');
      expect(stub.getAttribute('data-filter')).toBe('');
    });

    it('typing `:file readme` passes the filter to FileMode', async () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: ':file readme' } });
      const stub = await screen.findByTestId('file-mode-stub');
      expect(stub.getAttribute('data-filter')).toBe('readme');
    });
  });

  // -------------------------------------------------------------------------
  // Pinned-panel mode (#28)
  // -------------------------------------------------------------------------

  describe('pinned-panel mode (#28)', () => {
    it('renders inline (no portal) and marks data-cmd-bar-pinned="true" when settings.cmdBarPinned is true', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<FloatingCommandBar />);

      const bar = container.querySelector('[data-cmd-bar]') as HTMLElement;
      expect(bar).toBeTruthy();
      expect(bar.getAttribute('data-cmd-bar-pinned')).toBe('true');
    });

    it('reads cmdBarPinned from settings-store when no isPinned prop is provided', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<FloatingCommandBar />);
      // Inline render (not portalled) confirms the store-driven pinned mode.
      expect(container.querySelector('[data-cmd-bar]')).toBeTruthy();
    });

    it('explicit isPinned prop overrides the store setting', () => {
      // Store says floating, but we pass isPinned={true}.
      mockCmdBarPinned = false;
      const { container } = renderWithProviders(<FloatingCommandBar isPinned />);
      const bar = container.querySelector('[data-cmd-bar]') as HTMLElement;
      expect(bar).toBeTruthy();
      expect(bar.getAttribute('data-cmd-bar-pinned')).toBe('true');
    });

    it('is always expanded — no compact pill, input is always present', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);
      // No compact placeholder text in pinned mode.
      expect(screen.queryByText(/press ⌘k to ask/i)).toBeNull();
      // Input is always rendered.
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    it('renders the resize handle with role="slider" and ARIA orientation', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 400;
      renderWithProviders(<FloatingCommandBar />);

      const handle = screen.getByRole('slider', { name: /resize chat panel/i });
      expect(handle).toBeTruthy();
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      expect(handle.getAttribute('aria-valuemin')).toBe('280');
      expect(handle.getAttribute('aria-valuemax')).toBe('800');
      expect(handle.getAttribute('aria-valuenow')).toBe('400');
      expect((handle as HTMLElement).tabIndex).toBe(0);
    });

    it('does NOT render the resize handle when not pinned', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<FloatingCommandBar />);
      expect(screen.queryByRole('slider', { name: /resize chat panel/i })).toBeNull();
    });

    it('ArrowLeft on the resize handle widens the panel and persists via setCmdBarPinnedWidth', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 400;
      renderWithProviders(<FloatingCommandBar />);

      const handle = screen.getByRole('slider', { name: /resize chat panel/i });
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });

      // Widens by the keyboard step (20).
      expect(setCmdBarPinnedWidthMock).toHaveBeenCalledWith(420);
    });

    it('ArrowRight on the resize handle narrows the panel and persists', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 400;
      renderWithProviders(<FloatingCommandBar />);

      const handle = screen.getByRole('slider', { name: /resize chat panel/i });
      fireEvent.keyDown(handle, { key: 'ArrowRight' });

      expect(setCmdBarPinnedWidthMock).toHaveBeenCalledWith(380);
    });

    it('ArrowLeft at the maximum width clamps to 800 (no further growth)', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 800;
      renderWithProviders(<FloatingCommandBar />);

      const handle = screen.getByRole('slider', { name: /resize chat panel/i });
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });

      expect(setCmdBarPinnedWidthMock).toHaveBeenCalledWith(800);
    });

    it('ArrowRight at the minimum width clamps to 280 (no further shrink)', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 280;
      renderWithProviders(<FloatingCommandBar />);

      const handle = screen.getByRole('slider', { name: /resize chat panel/i });
      fireEvent.keyDown(handle, { key: 'ArrowRight' });

      expect(setCmdBarPinnedWidthMock).toHaveBeenCalledWith(280);
    });

    it('Esc with no active prefix does NOT collapse — bar stays expanded', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);

      // Dismiss via the bus (the bar's collapse code is gated on
      // !isPinned anyway). Input remains.
      act(() => emitCmdBarEvent({ type: 'dismiss' }));

      expect(screen.queryByRole('combobox')).toBeTruthy();
    });

    it('Esc with an active prefix clears just the prefix, not the bar', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/' } });
      // Prefix badge appears.
      expect(
        document.body.querySelector('[data-cmd-bar-prefix-badge]'),
      ).toBeTruthy();

      act(() => emitCmdBarEvent({ type: 'dismiss' }));

      // Badge cleared, input still rendered.
      expect(
        document.body.querySelector('[data-cmd-bar-prefix-badge]'),
      ).toBeNull();
      expect(screen.queryByRole('combobox')).toBeTruthy();
    });

    it('focusing the input does NOT un-pin (⌘K-equivalent in pinned mode)', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);

      const input = screen.getByRole('combobox') as HTMLInputElement;
      input.focus();

      // Setter should NOT have been called — focus alone does not toggle pin.
      expect(setCmdBarPinnedMock).not.toHaveBeenCalled();
    });

    it('applies the CSS variable for the panel width on <html>', () => {
      mockCmdBarPinned = true;
      mockCmdBarPinnedWidth = 520;
      renderWithProviders(<FloatingCommandBar />);

      // The handle's effect syncs the persisted width to the CSS variable.
      const cssVar = document.documentElement.style.getPropertyValue(
        '--cmd-bar-pinned-width',
      );
      expect(cssVar).toBe('520px');
    });
  });

  // -------------------------------------------------------------------------
  // Send wiring (#23) — Enter sends via the existing chat-store / useAIOperations
  // pipeline. We mock useAIOperations.sendChatMessage and assert the wiring,
  // not the downstream provider streaming. Chips are an optional payload.
  // -------------------------------------------------------------------------

  describe('send wiring (#23)', () => {
    function expand() {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));
      return screen.getByRole('combobox') as HTMLInputElement;
    }

    it('Enter with non-empty input calls sendChatMessage with the typed text', async () => {
      const input = expand();
      fireEvent.change(input, { target: { value: 'hello world' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // #126 — handleSend is now async (awaits `@agent` / `/skill`
      // expansion helpers before dispatching). Await a microtask so the
      // send dispatches.
      await waitFor(() => expect(sendChatMessageMock).toHaveBeenCalledTimes(1));
      const [content] = sendChatMessageMock.mock.calls[0];
      expect(content).toBe('hello world');
    });

    it('Enter with empty input AND no chips is a no-op (sendChatMessage NOT called)', () => {
      const input = expand();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(sendChatMessageMock).not.toHaveBeenCalled();
    });

    it('clears the input after a successful send', async () => {
      const input = expand();
      fireEvent.change(input, { target: { value: 'hi' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // #126 — async handleSend; wait for the post-send state update.
      await waitFor(() =>
        expect((input as HTMLInputElement).value).toBe(''),
      );
    });

    it('keeps focus in the input after send (ready for the next message)', () => {
      const input = expand();
      fireEvent.change(input, { target: { value: 'hi' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Focus stays in the input — autofocus effect re-fires when the input
      // re-renders with cleared value, AND we explicitly do not blur on send.
      expect(document.activeElement).toBe(input);
    });

    // Live-test 2026-04-26 — "clears chips after send" was exercising the
    // chip-attach path from the @ picker. That path was deliberately
    // dropped (selection is now a navigation intent), so the precondition
    // is unreachable from the picker. Image-attachment paste/drop still
    // populates chips at the integration tier.

    it('Enter while a prefix is active does NOT send — picker reserves Enter', () => {
      const input = expand();
      // Active prefix = "/" → SkillMode owns Enter.
      fireEvent.change(input, { target: { value: '/skill' } });

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(sendChatMessageMock).not.toHaveBeenCalled();
    });

    // Live-test 2026-04-26 — "Enter with chips still sends" — same reason
    // as the test above: chip-attach via picker is gone. The "send empty
    // input + only chips" flow still works for image attachments (paste
    // / drop), but those are exercised at the integration tier.

    // ---------------------------------------------------------------------
    // #126 — ChatInput parity: image attach button + Send / Stop affordance.
    // The paste / drop handlers rely on clipboard/DnD APIs that jsdom only
    // partially emulates, so those flows are exercised at the integration
    // tier; here we assert the visible affordances render correctly.
    // ---------------------------------------------------------------------

    it('renders the image-attach button in the input row (#126)', () => {
      expand();
      expect(screen.getByLabelText('Attach image')).toBeTruthy();
    });

    it('renders the Send button and disables it while the composer is empty (#126)', () => {
      const input = expand();
      const send = screen.getByLabelText('Send message') as HTMLButtonElement;
      expect(send).toBeTruthy();
      expect(send.disabled).toBe(true);

      // Typing a character should enable the send button.
      fireEvent.change(input, { target: { value: 'hi' } });
      expect(
        (screen.getByLabelText('Send message') as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('clicking the Send button dispatches sendChatMessage (#126)', async () => {
      const input = expand();
      fireEvent.change(input, { target: { value: 'from button' } });
      fireEvent.click(screen.getByLabelText('Send message'));

      await waitFor(() =>
        expect(sendChatMessageMock).toHaveBeenCalledTimes(1),
      );
      expect(sendChatMessageMock.mock.calls[0][0]).toBe('from button');
    });
  });

  // -------------------------------------------------------------------------
  // ARIA wiring (#78) — input becomes a combobox; mode pickers expose stable
  // option ids; activeIndex moves are reported up via the picker callback so
  // the input can mirror them via aria-activedescendant.
  // -------------------------------------------------------------------------

  describe('combobox ARIA wiring (#78)', () => {
    it('input has role="combobox" + listbox haspopup, aria-autocomplete="list"', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.getAttribute('aria-haspopup')).toBe('listbox');
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
    });

    it('aria-expanded flips with the active prefix', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      // Before any prefix → collapsed.
      expect(input.getAttribute('aria-expanded')).toBe('false');

      // Type "/" → SkillMode active → expanded.
      fireEvent.change(input, { target: { value: '/' } });
      expect(input.getAttribute('aria-expanded')).toBe('true');

      // Dismiss via the bus (Esc handling lives there now) → collapsed.
      act(() => emitCmdBarEvent({ type: 'dismiss' }));
      expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('aria-controls + aria-activedescendant are unset when no picker is open', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      expect(input.hasAttribute('aria-controls')).toBe(false);
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('aria-controls points to the active picker listbox id', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/' } });

      expect(input.getAttribute('aria-controls')).toBe('cmd-skill-listbox');
    });

    it('aria-activedescendant points to the highlighted option id and updates on ↓', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/' } });

      // Initial highlight is on option 0.
      expect(input.getAttribute('aria-activedescendant')).toBe(
        'cmd-skill-listbox-opt-0',
      );

      // Drive the picker stub's ↓ action — this advances the active index
      // and the picker reports it back via onActiveOptionChange.
      fireEvent.click(screen.getByTestId('skill-mode-down'));

      expect(input.getAttribute('aria-activedescendant')).toBe(
        'cmd-skill-listbox-opt-1',
      );
    });

    it('clears aria-controls + aria-activedescendant when the prefix is dismissed via Esc', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/' } });
      expect(input.getAttribute('aria-controls')).toBe('cmd-skill-listbox');

      act(() => emitCmdBarEvent({ type: 'dismiss' }));

      expect(input.hasAttribute('aria-controls')).toBe(false);
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('PrefixModeBadge has role="status" + aria-live="polite"', () => {
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/' } });

      const badge = document.body.querySelector(
        '[data-cmd-bar-prefix-badge]',
      ) as HTMLElement | null;
      expect(badge).toBeTruthy();
      expect(badge!.getAttribute('role')).toBe('status');
      expect(badge!.getAttribute('aria-live')).toBe('polite');
    });
  });

  // -------------------------------------------------------------------------
  // Pinned region landmark (#82) — pinned panel exposes a region landmark
  // with an explicit aria-label so screen-reader users can jump to it.
  // -------------------------------------------------------------------------

  describe('pinned panel region landmark (#82)', () => {
    it('renders the bar as role="region" with aria-label="Chat panel" when pinned', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<FloatingCommandBar />);

      const region = container.querySelector(
        '[data-cmd-bar][role="region"]',
      ) as HTMLElement | null;
      expect(region).toBeTruthy();
      expect(region!.getAttribute('aria-label')).toBe('Chat panel');
    });

    it('does NOT add the region role when floating (transient overlay)', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<FloatingCommandBar />);

      const bar = document.body.querySelector(
        '[data-cmd-bar]',
      ) as HTMLElement | null;
      expect(bar).toBeTruthy();
      expect(bar!.hasAttribute('role')).toBe(false);
      expect(bar!.hasAttribute('aria-label')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Top resize handle — expanded height (#37)
  // Drag the top edge of the expanded floating bar to change its height.
  // -------------------------------------------------------------------------

  describe('top resize handle — expanded height (#37)', () => {
    it('renders when the bar is floating and expanded (not compact, not pinned)', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      expect(handle).toBeTruthy();
    });

    it('does NOT render when the bar is compact (not expanded)', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<FloatingCommandBar />);
      // Bar stays compact — no click.
      expect(
        screen.queryByRole('slider', { name: /resize command bar height/i }),
      ).toBeNull();
    });

    it('does NOT render when the bar is pinned', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);
      expect(
        screen.queryByRole('slider', { name: /resize command bar height/i }),
      ).toBeNull();
    });

    it('has correct ARIA attributes (role, orientation, min, max, now)', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 480;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      expect(handle.getAttribute('aria-valuemin')).toBe('240');
      expect(handle.getAttribute('aria-valuemax')).toBe('800');
      expect(handle.getAttribute('aria-valuenow')).toBe('480');
      expect((handle as HTMLElement).tabIndex).toBe(0);
    });

    it('ArrowUp increases height by the keyboard step and calls setCmdBarExpandedHeight', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 480;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      fireEvent.keyDown(handle, { key: 'ArrowUp' });

      expect(setCmdBarExpandedHeightMock).toHaveBeenCalledWith(500);
    });

    it('ArrowDown decreases height by the keyboard step and calls setCmdBarExpandedHeight', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 480;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      fireEvent.keyDown(handle, { key: 'ArrowDown' });

      expect(setCmdBarExpandedHeightMock).toHaveBeenCalledWith(460);
    });

    it('ArrowUp at the maximum height clamps to 800', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 800;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      fireEvent.keyDown(handle, { key: 'ArrowUp' });

      expect(setCmdBarExpandedHeightMock).toHaveBeenCalledWith(800);
    });

    it('ArrowDown at the minimum height clamps to 240', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 240;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const handle = screen.getByRole('slider', {
        name: /resize command bar height/i,
      });
      fireEvent.keyDown(handle, { key: 'ArrowDown' });

      expect(setCmdBarExpandedHeightMock).toHaveBeenCalledWith(240);
    });

    it('syncs --cmd-bar-expanded-height CSS variable from persisted value on mount', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 600;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      expect(
        document.documentElement.style.getPropertyValue('--cmd-bar-expanded-height'),
      ).toBe('600px');
    });

    it('expanded bar inline style drives height via var(--cmd-bar-expanded-height)', () => {
      mockCmdBarPinned = false;
      mockCmdBarExpandedHeight = 480;
      renderWithProviders(<FloatingCommandBar />);
      fireEvent.click(screen.getByText(/press ⌘k to ask/i));

      const bar = document.body.querySelector('[data-cmd-bar]') as HTMLElement | null;
      expect(bar).toBeTruthy();
      expect(bar!.getAttribute('style')).toContain('--cmd-bar-expanded-height');
    });
  });
});
