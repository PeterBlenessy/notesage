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
import { renderWithProviders, fireEvent } from '@/test/component-harness';
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

// CommandBarStream stub exposes the `onEdit` callback as a button so tests
// can simulate clicking Edit on a chat message without rendering the real
// ChatMessageList. Pressing the button invokes onEdit with a synthetic
// message — that drives FloatingCommandBar's `handleStreamEdit` which sets
// `editContext` (the state under test for #149).
vi.mock('@/components/cmd/CommandBarStream', () => ({
  __esModule: true,
  default: ({ onEdit }: { onEdit?: (msg: { id: string; role: string; content: string; parentId?: string | null; connectionId?: string }) => void }) => (
    <div data-testid="stream-stub">
      <button
        data-testid="stream-stub-edit"
        type="button"
        onClick={() =>
          onEdit?.({
            id: 'fake-msg-1',
            role: 'user',
            content: 'original text',
            parentId: null,
            connectionId: 'conn-x',
          })
        }
      >
        Edit
      </button>
    </div>
  ),
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
    { getState: () => ({ setActiveConversation: vi.fn() }) },
  ),
  selectMessages: vi.fn(() => []),
  selectProjectPaths: vi.fn(() => []),
}));

vi.mock('@/components/chat/ChatHistoryView', () => ({
  ChatHistoryView: () => <div data-testid="chat-history-stub" />,
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

  // -------------------------------------------------------------------
  // 2026-04-24 live-test regression locks (#114 iteration 2)
  // -------------------------------------------------------------------

  it('⌘1 prefills EXACTLY "!" — no trailing space (2026-04-24 regression)', () => {
    renderWithProviders(<Harness />);

    dispatchKey({ key: '1', metaKey: true });

    // The bar's input should contain exactly the prefix character. An
    // earlier version added a trailing space which (a) showed a visible
    // cursor-offset the user had to delete and (b) polluted the picker's
    // post-prefix filter state.
    const input = document.querySelector(
      '[data-cmd-bar] textarea',
    ) as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('!');
  });

  it('⌘⇧P with contenteditable (editor) focused STILL fires (2026-04-24 regression)', () => {
    renderWithProviders(<Harness />);

    // Simulate the editor's contenteditable surface taking focus, which
    // is the default state when the user reaches for a keyboard shortcut
    // in the Tiptap editor. An earlier gate (`isOutsideCmdBarTextEntry`)
    // short-circuited ⌘⇧P / ⌘1–4 here — a silent P0 that live-testing
    // caught. ⌘-chords are NOT raw typing and must fire regardless.
    const fakeEditor = document.createElement('div');
    fakeEditor.setAttribute('contenteditable', 'true');
    // jsdom doesn't set `isContentEditable` from the attribute alone, so
    // we stub the getter — isOutsideCmdBarTextEntry checks that exact
    // property.
    Object.defineProperty(fakeEditor, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    document.body.appendChild(fakeEditor);
    fakeEditor.focus();

    dispatchKey({ key: 'p', metaKey: true, shiftKey: true, bubbles: true });

    const bar = getBar();
    expect(bar?.getAttribute('data-expanded')).toBe('true');
    expect(bar?.getAttribute('data-prefix-mode')).toBe('palette');

    fakeEditor.remove();
  });

  it('⌘1 with a non-cmd-bar input focused STILL fires (2026-04-24 regression)', () => {
    renderWithProviders(<Harness />);

    // Same class as the ⌘⇧P case: focus is in a regular <input> (e.g. a
    // settings field). The Cmd modifier marks the chord as an app-level
    // shortcut — no mid-typing hijack risk to avoid. Bar must expand.
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    dispatchKey({ key: '1', metaKey: true });

    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('task');

    input.remove();
  });

  // -------------------------------------------------------------------
  // 2026-04-24 Esc two-stage behaviour — typed vs chord prefix.
  //
  // Typed prefix: the user typed `#`, `@`, `!`, `?`, `>` into the input.
  //   First Esc clears the prefix only (bar stays expanded — user keeps
  //   composing). Second Esc collapses.
  // Chord-seeded prefix: ⌘1/2/3/4 / ⌘⇧P / ⌘⇧F put the prefix there.
  //   First Esc collapses immediately — the chord was the only reason
  //   the user landed here.
  // -------------------------------------------------------------------

  it('Esc after a chord-seeded prefix (⌘3 → #) collapses in ONE stage', () => {
    renderWithProviders(<Harness />);

    // Chord seeds the `#` prefix. `source: 'chord'` is set on the active
    // prefix record so Esc can distinguish from a typed `#`.
    dispatchKey({ key: '3', metaKey: true });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('tag');

    // A single Esc should collapse the bar outright — no two-stage
    // clearing step. The chord is the only reason we got here; Esc
    // undoes it in full.
    dispatchKey({ key: 'Escape' });

    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });

  it('Esc after a typed prefix (# typed into input) is TWO-STAGE (clear, then collapse)', () => {
    renderWithProviders(<Harness />);

    // Expand the bar (no prefix yet) and type `#` into the input. The
    // input's onChange recomputes active prefix from (value, cursor);
    // source defaults to `'typed'`.
    dispatchKey({ key: 'k', metaKey: true });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');

    const input = document.querySelector(
      '[data-cmd-bar] textarea',
    ) as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();

    // Simulate typing `#` — fireEvent.change goes through React's synthetic
    // event system so the controlled input's onChange handler actually runs
    // (a raw `dispatchEvent('input')` doesn't trigger React's listener in
    // jsdom and leaves state stale).
    if (!input) throw new Error('input missing');
    fireEvent.change(input, { target: { value: '#' } });

    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('tag');

    // First Esc: clears the prefix only. Bar stays expanded so the user
    // can keep composing; the picker closes.
    dispatchKey({ key: 'Escape' });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('');

    // Second Esc: no prefix active → collapse the bar.
    dispatchKey({ key: 'Escape' });
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });

  // -------------------------------------------------------------------------
  // #138 regression — typing `/de` then Esc dismisses the skill picker. Two
  // subsequent Backspaces (which leave the input as `/d` then `/`) must
  // NOT re-open the picker — `dismissedPrefixRef` suppresses re-detection
  // of the same prefix character at the same index until the user breaks
  // the pattern (deletes the prefix entirely or moves it).
  // -------------------------------------------------------------------------

  it('typing /de + Esc + Backspace twice keeps the skill picker dismissed', () => {
    renderWithProviders(<Harness />);

    // Open the bar and type `/de` (skill prefix).
    dispatchKey({ key: 'k', metaKey: true });
    const input = document.querySelector(
      '[data-cmd-bar] textarea',
    ) as HTMLTextAreaElement | null;
    if (!input) throw new Error('input missing');

    fireEvent.change(input, { target: { value: '/de' } });
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('skill');

    // Esc dismisses the picker (typed source → first Esc clears prefix,
    // bar stays expanded). dismissedPrefixRef now remembers `/` at index 0.
    dispatchKey({ key: 'Escape' });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('');

    // Backspace 1 → input becomes `/d`. The picker MUST stay dismissed
    // (the `/` at index 0 still matches the dismissed token).
    fireEvent.change(input, { target: { value: '/d' } });
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('');

    // Backspace 2 → input becomes `/`. Still suppressed.
    fireEvent.change(input, { target: { value: '/' } });
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('');

    // Once the user actually deletes the `/` (or types a new one), the
    // suppression releases. Verify by deleting then re-typing:
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '/' } });
    expect(getBar()?.getAttribute('data-prefix-mode')).toBe('skill');
  });

  // -------------------------------------------------------------------------
  // #149 regression — Esc in edit mode cancels the edit; the bar stays
  // expanded so the user can keep composing. The bus dismiss handler walks
  // a three-stage chain (typed prefix → edit mode → collapse); this test
  // pins the edit-mode branch.
  // -------------------------------------------------------------------------

  it('Esc while in edit mode cancels the edit (input clears, bar stays expanded) without collapsing (#149)', () => {
    renderWithProviders(<Harness />);

    // Open the bar via ⌘K.
    dispatchKey({ key: 'k', metaKey: true });
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');

    // Click the stream-stub's Edit button to trigger the FloatingCommandBar's
    // `handleStreamEdit` callback. This sets editContext + prefills the
    // input with the message content + ensures expanded=true. The
    // `useEffect` that mirrors editContext to editContextRef runs in the
    // commit that follows.
    const editButton = document.querySelector(
      '[data-testid="stream-stub-edit"]',
    ) as HTMLButtonElement;
    expect(editButton).not.toBeNull();
    act(() => {
      editButton.click();
    });

    // The composer input should now hold the prefilled content.
    const input = document.querySelector(
      '[data-cmd-bar] textarea',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe('original text');
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');

    // Press Esc. The bus dismiss handler must check editContextRef and
    // cancel the edit (clear input, clear chips, leave bar expanded)
    // BEFORE falling through to collapse.
    dispatchKey({ key: 'Escape' });

    // Bar stays expanded — user keeps composing.
    expect(getBar()?.getAttribute('data-expanded')).toBe('true');
    // Input cleared (the prefilled content is gone).
    expect(input.value).toBe('');

    // A subsequent Esc with no edit context and no prefix collapses the bar.
    dispatchKey({ key: 'Escape' });
    expect(getBar()?.getAttribute('data-expanded')).toBe('false');
  });
});
