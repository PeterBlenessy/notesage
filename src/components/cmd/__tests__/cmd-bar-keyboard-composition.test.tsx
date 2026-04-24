// @vitest-environment jsdom

/**
 * Composition tests for #114 — wire keyboard shortcuts to FloatingCommandBar
 * via the cmd-bar-events bus.
 *
 * These are OUTCOME-SHAPED tests: they render a real `<FloatingCommandBar />`
 * AND mount `useCommandBarShortcuts()` (the hook normally composed into
 * useKeyboardShortcuts). Then they dispatch REAL keyboard events at `window`
 * and assert the observable result on the bar's `data-expanded` and
 * `data-prefix-mode` attributes.
 *
 * These tests exist because the unit tests for each component in isolation
 * (hook emits correct event; bar has expand/collapse state) all passed, yet
 * the feature was fully broken end-to-end — the hook emitted on the bus and
 * the bar never subscribed. Testing the composition is the only way to catch
 * that class of regression.
 *
 * Expected-to-fail rows (red-first) are annotated. After the #114 fix lands
 * they all turn green.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '@/test/component-harness';
import FloatingCommandBar from '@/components/cmd/FloatingCommandBar';
import { useCommandBarShortcuts } from '@/hooks/useCommandBarShortcuts';

// ---------------------------------------------------------------------------
// Mocks — only enough to let the real bar + real shortcut hook coexist.
// We purposely do NOT mock cmd-bar-events or subscribeToCmdBarEvents — the
// whole point is to exercise the real bus end to end.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// Flip uiPreview to `quiet-composer` so the shortcut hook is active.
// Provide the minimum settings-store surface the bar reads.
let mockCmdBarPinned = false;
vi.mock('@/stores/settings-store', () => {
  const state = {
    uiPreview: 'quiet-composer' as const,
    get cmdBarPinned() { return mockCmdBarPinned; },
    cmdBarPinnedWidth: 400,
    setCmdBarPinned: vi.fn(),
    setCmdBarPinnedWidth: vi.fn(),
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// Stub heavy children so the test focuses on the bar shell + bus wiring.
vi.mock('@/components/cmd/AttachmentChips', () => ({
  __esModule: true,
  default: () => <div data-testid="chips-stub" />,
}));

vi.mock('@/components/cmd/CommandBarContext', () => ({
  __esModule: true,
  default: () => <div data-testid="context-stub" />,
}));

vi.mock('@/components/cmd/CommandBarStream', () => ({
  __esModule: true,
  default: () => <div data-testid="stream-stub" />,
}));

vi.mock('@/components/cmd/modes/SkillMode', () => ({
  __esModule: true,
  default: () => <div data-testid="skill-mode-stub" />,
}));

vi.mock('@/components/cmd/modes/ReferenceMode', () => ({
  __esModule: true,
  default: () => <div data-testid="reference-mode-stub" />,
}));

vi.mock('@/components/cmd/modes/TagMode', () => ({
  __esModule: true,
  default: () => <div data-testid="tag-mode-stub" />,
}));

vi.mock('@/components/cmd/modes/TaskMode', () => ({
  __esModule: true,
  default: () => <div data-testid="task-mode-stub" />,
}));

vi.mock('@/components/cmd/modes/ResearchMode', () => ({
  __esModule: true,
  default: () => <div data-testid="research-mode-stub" />,
}));

vi.mock('@/components/cmd/modes/PaletteMode', () => ({
  __esModule: true,
  default: () => <div data-testid="palette-mode-stub" />,
}));

// useAIOperations is used by handleSend — we mock to a no-op so rendering
// the bar doesn't require a routing-store / chat-store setup.
vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: () => ({ sendChatMessage: vi.fn() }),
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn(() => []),
  selectMessages: vi.fn(() => []),
}));

// Harness: render the bar AND mount the shortcut hook in one tree so the
// bus connects end-to-end. `data-cmd-bar` is always on a fixed element
// portal-mounted to document.body; tests read from there.
function Harness({ pinned = false }: { pinned?: boolean } = {}) {
  useCommandBarShortcuts();
  return <FloatingCommandBar isPinned={pinned} />;
}

function getBar(): HTMLElement | null {
  return document.querySelector('[data-cmd-bar]') as HTMLElement | null;
}

function dispatchKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

beforeEach(() => {
  mockCmdBarPinned = false;
  // Clean up any portal content from a previous test.
  document.body.innerHTML = '';
});

describe('#114 composition — keyboard → bus → FloatingCommandBar', () => {
  it('⌘K expands the collapsed bar (was: dead — bus had no subscriber)', () => {
    renderWithProviders(<Harness />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    dispatchKey({ key: 'k', metaKey: true });

    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
  });

  it('⌘⇧P expands the bar AND prefills the `>` prefix', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: 'p', metaKey: true, shiftKey: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('palette');
  });

  it('⌘2 expands the bar AND prefills the `@` prefix', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: '2', metaKey: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('reference');
  });

  it('⌘3 expands the bar AND prefills the `#` prefix', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: '3', metaKey: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('tag');
  });

  it('⌘1 expands the bar AND prefills the `!` prefix (tasks)', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: '1', metaKey: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('task');
  });

  it('⌘4 expands the bar AND prefills the `?` prefix (research)', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: '4', metaKey: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('research');
  });

  it('Esc from OUTSIDE the bar collapses it when expanded (was: Esc gated on focus-inside-bar)', () => {
    renderWithProviders(<Harness />);
    // Expand via ⌘K first.
    dispatchKey({ key: 'k', metaKey: true });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');

    // Now Esc from the window — focus is NOT inside the bar — must still
    // collapse. Previously this was a no-op because the hook gated Esc on
    // `target.closest('[data-cmd-bar]') !== null`.
    dispatchKey({ key: 'Escape' });

    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });

  it('Esc when the bar is already collapsed is a no-op (does not preventDefault)', () => {
    renderWithProviders(<Harness />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    // Build an event we can inspect — dispatch directly to check
    // defaultPrevented state post-handlers.
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    // Still collapsed AND the event was not cancelled — editor / popover /
    // focus-mode listeners downstream must still be able to act on Esc.
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
    expect(event.defaultPrevented).toBe(false);
  });
});
