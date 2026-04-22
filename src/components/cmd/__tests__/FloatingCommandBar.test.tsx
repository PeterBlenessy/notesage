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
    // Clean DOM between tests — portals leak otherwise
    document.body.innerHTML = '';
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
});
