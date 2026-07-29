// @vitest-environment jsdom

/**
 * Composition tests for #115 — mount useDoubleTapCmd and prove the bus path
 * end-to-end.
 *
 * These are OUTCOME-SHAPED tests: they render a real `<FloatingCommandBar />`
 * AND mount `useDoubleTapCmd()` (the hook normally composed into
 * useKeyboardShortcuts). Two consecutive Meta keydowns within the 300 ms
 * window must result in `data-expanded="true"` on the bar — exercising
 * useDoubleTapCmd → emitCmdBarEvent({ type: "focus" }) → subscribeToCmdBarEvents
 * → bar state → DOM.
 *
 * Why this test exists: useDoubleTapCmd's own unit test verifies the bus
 * emission; FloatingCommandBar's subscriber was wired by #114. But #115 is
 * the mounting step — a hook that's never called is indistinguishable from
 * one that exists only in the repo. Mounting + a composition test is the
 * only way to lock the double-tap path from regression.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '@/test/component-harness';
import FloatingCommandBar from '@/components/cmd/FloatingCommandBar';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import type { ShortcutCallbacks } from '@/hooks/shortcuts/shortcutActions';

const STUB_CALLBACKS: ShortcutCallbacks = {
  onFindOpen: () => {},
  onFindReplaceOpen: () => {},
  onOutlineOpen: () => {},
  onSettingsOpen: () => {},
  onExportOpen: () => {},
  onNewProject: () => {},
  onNewNote: () => {},
  onOpenFolder: () => {},
  onShortcutsOpen: () => {},
};

// ---------------------------------------------------------------------------
// Mocks — only enough to let the real bar + real double-tap hook coexist.
// We purposely do NOT mock cmd-bar-events or subscribeToCmdBarEvents — the
// whole point is to exercise the real bus end to end.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// Flip uiPreview to `quiet-composer` so the double-tap hook is active.
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
  useChatStore: Object.assign(
    vi.fn(() => []),
    {
      getState: () => ({ activeConversationId: null, setActiveConversation: vi.fn() }),
      // useMessageQueueDrain subscribes at mount — no-op unsubscribe here.
      subscribe: () => () => {},
    },
  ),
  selectMessages: vi.fn(() => []),
  selectProjectPaths: vi.fn(() => []),
  selectPendingProjectSwitch: vi.fn(() => null),
  selectPendingAgentSwitch: vi.fn(() => null),
}));

vi.mock('@/components/chat/ChatHistoryView', () => ({
  ChatHistoryView: () => <div data-testid="chat-history-stub" />,
}));

vi.mock('@/hooks/useChatSwitchPrompts', () => ({
  useChatSwitchPrompts: () => undefined,
}));

// Harness: render the bar AND mount the double-tap hook in one tree so the
// bus connects end-to-end. `data-cmd-bar` is always on a fixed element
// portal-mounted to document.body; tests read from there.
function Harness({ pinned = false }: { pinned?: boolean } = {}) {
  useGlobalShortcuts(STUB_CALLBACKS);
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

// Controllable performance.now — the hook reads it via performance.now()
// to measure the gap between two Meta taps. vi.useFakeTimers does NOT
// advance the high-resolution clock, so we monkey-patch it directly.
let nowValue = 0;
const realPerformanceNow = performance.now.bind(performance);

function advance(ms: number) {
  nowValue += ms;
}

beforeEach(() => {
  mockCmdBarPinned = false;
  document.body.innerHTML = '';
  nowValue = 1000; // start at a non-zero baseline
  performance.now = () => nowValue;
});

afterEach(() => {
  performance.now = realPerformanceNow;
});

describe('#115 composition — double-tap ⌘ → bus → FloatingCommandBar', () => {
  it('two Meta keydowns within 300 ms expand the collapsed bar', () => {
    renderWithProviders(<Harness />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    dispatchKey({ key: 'Meta' });
    advance(150);
    dispatchKey({ key: 'Meta' });

    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
  });

  it('two Meta keydowns > 300 ms apart do NOT expand the bar', () => {
    renderWithProviders(<Harness />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    dispatchKey({ key: 'Meta' });
    advance(400);
    dispatchKey({ key: 'Meta' });

    // Gap exceeds the double-tap window — tracker arms on the second press
    // but no pair fires. Bar stays collapsed.
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });

  it('Meta → K → Meta does NOT expand the bar (intermediate key resets)', () => {
    renderWithProviders(<Harness />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    dispatchKey({ key: 'Meta' });
    advance(50);
    // Any non-Meta key clears the armed Meta tap — a stray Meta while
    // composing ⌘K must not arm a later Meta tap into a double-tap.
    dispatchKey({ key: 'k' });
    advance(50);
    dispatchKey({ key: 'Meta' });

    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });
});
