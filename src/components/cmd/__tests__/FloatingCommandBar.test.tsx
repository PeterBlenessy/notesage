// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import FloatingCommandBar from '@/components/cmd/FloatingCommandBar';

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
let mockCmdBarPinned = false;
let mockCmdBarPinnedWidth = 400;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
    get cmdBarPinnedWidth() { return mockCmdBarPinnedWidth; },
    setCmdBarPinned: (v: boolean) => setCmdBarPinnedMock(v),
    setCmdBarPinnedWidth: (v: number) => setCmdBarPinnedWidthMock(v),
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
        onClick={() => onPick({ id: 'chip-test', kind: 'file', name: 'notes.md' })}
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
  function useChatStore<T>(selector: (state: { isLoading: boolean }) => T): T {
    return selector({ isLoading: false });
  }
  return {
    useChatStore,
    selectMessages: () => [],
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FloatingCommandBar', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    // Reset mocked settings-store state.
    mockCmdBarPinned = false;
    mockCmdBarPinnedWidth = 400;
    setCmdBarPinnedMock.mockReset();
    setCmdBarPinnedWidthMock.mockReset();
    sendChatMessageMock.mockReset();
    sendChatMessageMock.mockImplementation(() => Promise.resolve());
    // Clean DOM between tests — portals leak otherwise
    document.body.innerHTML = '';
    // Also clean the CSS variable that pinned mode sets on <html>
    document.documentElement.style.removeProperty('--cmd-bar-pinned-width');
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
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Escape' });

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

  it('mounts AttachmentChips exactly once when expanded', () => {
    renderWithProviders(<FloatingCommandBar />);
    // Compact state — chips strip not yet mounted (only the expanded contents
    // include it).
    expect(screen.queryAllByTestId('chips-stub')).toHaveLength(0);

    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    // After expansion, the AttachmentChips component is rendered exactly once.
    expect(screen.getAllByTestId('chips-stub')).toHaveLength(1);
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
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });

    // Sanity: badge is up.
    expect(
      document.body.querySelector('[data-cmd-bar-prefix-badge]'),
    ).toBeTruthy();

    // First Esc → badge gone, bar still expanded, input intact.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(
      document.body.querySelector('[data-cmd-bar-prefix-badge]'),
    ).toBeNull();
    expect(screen.queryByRole('combobox')).toBeTruthy();

    // Second Esc → bar collapses.
    const stillThere = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.keyDown(stillThere, { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
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

      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Escape' });

      // Input is still there — no collapse.
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

      fireEvent.keyDown(input, { key: 'Escape' });

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

    it('clears chips after send (chip count drops to 0)', async () => {
      const input = expand();

      // Drive a chip into state via the @ ReferenceMode picker stub.
      fireEvent.change(input, { target: { value: '@' } });
      fireEvent.click(screen.getByTestId('reference-mode-add-chip'));

      // Chip is now in state — the AttachmentChips stub reflects the count.
      const chipsStripBefore = screen.getByTestId('chips-stub');
      expect(chipsStripBefore.getAttribute('data-chip-count')).toBe('1');

      // Type a message and send.
      const inputAfter = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(inputAfter, { target: { value: 'check this' } });
      fireEvent.keyDown(inputAfter, { key: 'Enter' });

      // #126 — async handleSend.
      await waitFor(() =>
        expect(sendChatMessageMock).toHaveBeenCalledTimes(1),
      );
      const chipsStripAfter = screen.getByTestId('chips-stub');
      expect(chipsStripAfter.getAttribute('data-chip-count')).toBe('0');
    });

    it('Enter while a prefix is active does NOT send — picker reserves Enter', () => {
      const input = expand();
      // Active prefix = "/" → SkillMode owns Enter.
      fireEvent.change(input, { target: { value: '/skill' } });

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(sendChatMessageMock).not.toHaveBeenCalled();
    });

    it('Enter with empty input but non-empty chips still sends (chips are content)', async () => {
      const input = expand();

      // Add one chip via the @ picker stub.
      fireEvent.change(input, { target: { value: '@' } });
      fireEvent.click(screen.getByTestId('reference-mode-add-chip'));

      // Clear the input again so it's empty when we press Enter — the chip
      // alone should still be enough to send.
      const inputAfter = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(inputAfter, { target: { value: '' } });

      fireEvent.keyDown(inputAfter, { key: 'Enter' });

      // #126 — async handleSend.
      await waitFor(() => expect(sendChatMessageMock).toHaveBeenCalledTimes(1));
    });

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

      // Esc clears the prefix → collapsed again.
      fireEvent.keyDown(input, { key: 'Escape' });
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

      fireEvent.keyDown(input, { key: 'Escape' });

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
});
