// @vitest-environment jsdom

/**
 * Composition tests for #121 — ⌘⇧A routes to AgentOrb.
 *
 * AgentOrb is the only agent panel surface (Classic ActivityStrip was
 * removed in #325). ⌘⇧A emits `{ type: 'toggle' }` on the
 * agent-orb-events bus; AgentOrb subscribes and flips its popover `open`
 * state.
 *
 * Radix popovers are tricky to introspect in jsdom (portals, pointer APIs).
 * The production component exposes `data-orb-open` on the trigger button
 * specifically so these tests can assert toggle behaviour without peeking
 * into Radix internals.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import {
  renderWithProviders,
  screen,
} from '@/test/component-harness';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

// ---------------------------------------------------------------------------
// Radix polyfills for jsdom (copied from AgentOrb.test.tsx — same reason).
// ---------------------------------------------------------------------------

if (!('hasPointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn<() => boolean>(() => false),
  });
}
if (!('releasePointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}
if (!('setPointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}
if (!('scrollIntoView' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (
    window as unknown as { ResizeObserver: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

let mockCmdBarPinned = false;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() {
      return mockCmdBarPinned;
    },
    sidebarPinned: false,
    theme: 'light' as const,
    setCmdBarPinned: vi.fn(),
    setSidebarPinned: vi.fn(),
    setTheme: vi.fn(),
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel?: (s: typeof state) => unknown) =>
        typeof sel === 'function' ? sel(state) : state,
      ),
      { getState: () => state },
    ),
  };
});

const mockEditorState = {
  openDocuments: [] as Array<{ id: string; isDirty: boolean }>,
  activeTabId: null as string | null,
  closeTab: vi.fn(),
  setPendingCloseTabId: vi.fn(),
};
vi.mock('@/stores/editor-store', () => ({
  useEditorStore: Object.assign(
    vi.fn((sel?: (s: typeof mockEditorState) => unknown) =>
      typeof sel === 'function' ? sel(mockEditorState) : mockEditorState,
    ),
    { getState: () => mockEditorState },
  ),
}));

vi.mock('@/stores/activity-store', () => {
  const state = {
    tasks: [] as Array<{ id: string; status: string; label: string }>,
    removeTask: vi.fn(),
  };
  return {
    useActivityStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// AgentPanel pulls in a lot of task-rendering code; stub it.
vi.mock('../AgentPanel', () => ({
  AgentPanel: () => <div data-testid="agent-panel-stub" />,
}));

// ---------------------------------------------------------------------------
// Lazy import after mocks
// ---------------------------------------------------------------------------

import { AgentOrb } from '../AgentOrb';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCallbacks() {
  return {
    onFindOpen: vi.fn(),
    onFindReplaceOpen: vi.fn(),
    onOutlineOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    onExportOpen: vi.fn(),
    onNewProject: vi.fn(),
    onNewNote: vi.fn(),
    onOpenFolder: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onToggleRecording: vi.fn(),
  };
}

function Harness({ callbacks }: { callbacks: ReturnType<typeof makeCallbacks> }) {
  useKeyboardShortcuts(callbacks);
  return <AgentOrb />;
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
  mockEditorState.openDocuments = [];
  mockEditorState.activeTabId = null;
  document.body.innerHTML = '';
});

describe('#121 ⌘⇧A under Quiet Composer', () => {
  it('opens then closes the AgentOrb popover', () => {
    const callbacks = makeCallbacks();
    renderWithProviders(<Harness callbacks={callbacks} />);

    const orb = screen.getByTestId('agent-orb');
    expect(orb.getAttribute('data-orb-open')).toBe('false');

    // First press — open.
    dispatchKey({ key: 'a', metaKey: true, shiftKey: true });
    expect(orb.getAttribute('data-orb-open')).toBe('true');

    // Second press — close.
    dispatchKey({ key: 'a', metaKey: true, shiftKey: true });
    expect(orb.getAttribute('data-orb-open')).toBe('false');
  });
});

