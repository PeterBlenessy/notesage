// @vitest-environment jsdom

/**
 * Composition tests for #121 — ⌘⇧C under Quiet Composer.
 *
 * Decision table (per PRD intent — the command bar IS the chat):
 *
 *   collapsed        → emit `focus` on cmd-bar bus (expand)
 *   expanded+float   → no-op (Esc is the documented dismiss path)
 *   expanded+pinned  → emit `toggle-pin` (unpin; same chord twice unpins)
 *
 * Legacy mode must keep calling `setChatPanelOpen` via the callback bag so the
 * classic right-sidebar `ChatPanel` continues to toggle.
 *
 * These are OUTCOME-SHAPED tests: they render a real `<FloatingCommandBar />`
 * and mount `useKeyboardShortcuts()` so the bus connects end-to-end. They
 * dispatch real ⌘⇧C keyboard events and observe the DOM / setter mocks.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '@/test/component-harness';
import FloatingCommandBar from '@/components/cmd/FloatingCommandBar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// Settings-store is shared between useKeyboardShortcuts, useCommandBarShortcuts,
// and FloatingCommandBar. We need getters/setters so the bar reads the mock
// and setCmdBarPinned can be spied on.
let mockCmdBarPinned = false;
const mockSetCmdBarPinned = vi.fn<(next: boolean) => void>((next) => {
  mockCmdBarPinned = next;
});

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() {
      return mockCmdBarPinned;
    },
    cmdBarPinnedWidth: 400,
    sidebarPinned: false,
    theme: 'light' as const,
    setCmdBarPinned: (next: boolean) => mockSetCmdBarPinned(next),
    setCmdBarPinnedWidth: vi.fn(),
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

// Editor-store — minimal shape so useKeyboardShortcuts can destructure.
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

// Stub heavy children so the bar mounts without a full AI stack.
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
vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: () => ({ sendChatMessage: vi.fn() }),
}));
vi.mock('@/stores/chat-store', () => ({
  useChatStore: Object.assign(
    vi.fn(() => []),
    { getState: () => ({ setActiveConversation: vi.fn() }) },
  ),
  selectMessages: vi.fn(() => []),
  selectProjectPaths: vi.fn(() => []),
  selectPendingProjectSwitch: vi.fn(() => null),
  selectPendingAgentSwitch: vi.fn(() => null),
}));

vi.mock('@/hooks/useChatSwitchPrompts', () => ({
  useChatSwitchPrompts: () => undefined,
}));

vi.mock('@/components/chat/ChatHistoryView', () => ({
  ChatHistoryView: () => <div data-testid="chat-history-stub" />,
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCallbacks() {
  return {
    onPaletteOpen: vi.fn(),
    onFindOpen: vi.fn(),
    onFindReplaceOpen: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onExitFocusMode: vi.fn(),
    onOutlineOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    onExportOpen: vi.fn(),
    onNewProject: vi.fn(),
    onNewNote: vi.fn(),
    onOpenFolder: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onToggleActivityStrip: vi.fn(),
    onToggleRecording: vi.fn(),
    onOpenActions: vi.fn(),
    focusMode: false,
  };
}

function Harness({
  isPinned = false,
  callbacks,
}: {
  isPinned?: boolean;
  callbacks: ReturnType<typeof makeCallbacks>;
}) {
  useKeyboardShortcuts(callbacks);
  return <FloatingCommandBar isPinned={isPinned} />;
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
  mockSetCmdBarPinned.mockClear();
  mockEditorState.openDocuments = [];
  mockEditorState.activeTabId = null;
  document.body.innerHTML = '';
});

describe('#121 ⌘⇧C under Quiet Composer', () => {
  it('expands the bar when collapsed', () => {
    const callbacks = makeCallbacks();
    renderWithProviders(<Harness callbacks={callbacks} />);
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');

    dispatchKey({ key: 'c', metaKey: true, shiftKey: true });

    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
  });

  it('unpins the bar when expanded AND pinned', () => {
    mockCmdBarPinned = true;
    const callbacks = makeCallbacks();
    renderWithProviders(
      <Harness isPinned={true} callbacks={callbacks} />,
    );
    // When `isPinned` is true the bar renders expanded inline — assert.
    expect(getBar()?.getAttribute('data-cmd-bar-pinned')).toBe('true');
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');

    dispatchKey({ key: 'c', metaKey: true, shiftKey: true });

    // setCmdBarPinned(false) should be called once — the bar's subscriber
    // receives the `toggle-pin` event and flips the setting.
    expect(mockSetCmdBarPinned).toHaveBeenCalledTimes(1);
    expect(mockSetCmdBarPinned).toHaveBeenCalledWith(false);
    // The bar is still rendered (we flipped pin, not expanded).
    expect(getBar()).not.toBeNull();
  });
});

