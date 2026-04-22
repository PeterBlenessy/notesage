// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
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
// expanded.
vi.mock('@/components/cmd/AttachmentChips', () => ({
  __esModule: true,
  default: () => <div data-testid="chips-stub" />,
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
vi.mock('@/components/cmd/modes/SkillMode', () => ({
  default: () => <div data-testid="skill-mode-stub" />,
}));
vi.mock('@/components/cmd/modes/ReferenceMode', () => ({
  default: () => <div data-testid="reference-mode-stub" />,
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
    // Clean DOM between tests — portals leak otherwise
    document.body.innerHTML = '';
    // Also clean the CSS variable that pinned mode sets on <html>
    document.documentElement.style.removeProperty('--cmd-bar-pinned-width');
  });

  it('renders compact state by default with the placeholder hint visible', () => {
    renderWithProviders(<FloatingCommandBar />);
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
    // The input must NOT be present in compact state.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('expands to show an autofocused input when the compact pill is clicked', () => {
    renderWithProviders(<FloatingCommandBar />);
    const compact = screen.getByText(/press ⌘k to ask/i);
    fireEvent.click(compact);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeTruthy();
    // Autofocus should be active on expansion.
    expect(document.activeElement).toBe(input);
    // CommandBarStream (#12) mounts inside the expanded bar.
    expect(screen.getByTestId('cmd-stream-stub')).toBeTruthy();
  });

  it('collapses back to compact when Escape is pressed in the expanded input', () => {
    renderWithProviders(<FloatingCommandBar />);
    fireEvent.click(screen.getByText(/press ⌘k to ask/i));

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });

    // Compact placeholder is back, input is gone.
    expect(screen.getByText(/press ⌘k to ask/i)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
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

    const input = screen.getByRole('textbox') as HTMLInputElement;
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

    const input = screen.getByRole('textbox') as HTMLInputElement;
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
    expect(screen.queryByRole('textbox')).toBeTruthy();

    // Second Esc → bar collapses.
    const stillThere = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(stillThere, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
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

    const input = screen.getByRole('textbox') as HTMLInputElement;
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
      expect(screen.getByRole('textbox')).toBeTruthy();
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

      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Escape' });

      // Input is still there — no collapse.
      expect(screen.queryByRole('textbox')).toBeTruthy();
    });

    it('Esc with an active prefix clears just the prefix, not the bar', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);

      const input = screen.getByRole('textbox') as HTMLInputElement;
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
      expect(screen.queryByRole('textbox')).toBeTruthy();
    });

    it('focusing the input does NOT un-pin (⌘K-equivalent in pinned mode)', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<FloatingCommandBar />);

      const input = screen.getByRole('textbox') as HTMLInputElement;
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
});
