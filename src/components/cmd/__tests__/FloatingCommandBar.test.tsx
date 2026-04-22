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
    // The future-stream placeholder zone is rendered.
    expect(screen.getByText(/conversation will render here/i)).toBeTruthy();
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

  it('skips the lift transition when prefers-reduced-motion is reduce', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderWithProviders(<FloatingCommandBar />);

    const bar = document.body.querySelector('[data-cmd-bar]') as HTMLElement;
    expect(bar).toBeTruthy();
    // No transition utilities applied when reduced-motion is requested.
    expect(bar.className).not.toMatch(/transition-/);
    expect(bar.className).not.toMatch(/duration-/);
  });
});
