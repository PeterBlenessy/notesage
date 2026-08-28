// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Radix Popover positioning (used by the StatusTray that the quiet variant
// mounts) calls ResizeObserver in a layout effect — provide a no-op shim so
// jsdom doesn't crash when popover content mounts.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}
import {
  renderWithProviders,
  registerDefaultHandlers,
  fireEvent,
  act,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import type { Editor } from '@tiptap/core';
import { StatusBar } from '@/components/editor/StatusBar';
import { useEditorStore } from '@/stores/editor-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useChatStore } from '@/stores/chat-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Store reset + helpers
// ---------------------------------------------------------------------------

function resetEditorStore() {
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    pendingCloseTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
}

/**
 * Reset every store read by the ambient dots (task #54) so each test has
 * a deterministic starting state. Mirrors the reset helpers in
 * `StatusTray.test.tsx` but also resets the chat-store to "no projects
 * selected" and the settings-store to "no completionsOnOutOfScope" etc.
 */
function resetAmbientDotStores() {
  useLocalAIStore.setState({
    serverStatus: 'stopped',
    activeModelId: null,
    models: [],
  });
  useConnectionsStore.setState({ connections: [] });
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
  });
  useRecordingStore.setState({
    isRecording: false,
    activeDownloads: {},
  });
  useSettingsStore.setState({
    inlineCompletionsDisabled: false,
    completionsOnOutOfScope: false,
    notesRootPath: '/Users/peter/Notesage',
    homeDir: '/Users/peter',
  });
  // Clear any active conversation so `selectProjectPaths` returns `[]`.
  useChatStore.setState({ conversations: [], activeConversationId: null });
}

function addConnection(
  partial: Partial<Connection> & Pick<Connection, 'id' | 'provider' | 'authMethod' | 'label'>,
) {
  const conn: Connection = {
    status: 'connected',
    credentials: { type: 'local_bundled' } as Connection['credentials'],
    capabilities: ['inline_completion'],
    createdAt: Date.now(),
    ...partial,
  } as Connection;
  useConnectionsStore.setState((s) => ({ connections: [...s.connections, conn] }));
  return conn;
}

function openTab(path: string, fileName: string, lastSavedAt?: number) {
  const id = 'tab-' + path;
  useEditorStore.setState((s) => ({
    openDocuments: [
      ...s.openDocuments,
      {
        id,
        filePath: path,
        fileName,
        isDirty: false,
        content: '',
        contentLoaded: true,
        frontmatter: null,
        fileType: 'markdown',
        lastSavedAt,
      },
    ],
    activeTabId: id,
  }));
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Task #52 adds a `variant?: "full" | "quiet"` prop. `"full"` is the default
// and must stay byte-identical to today's rich status strip. `"quiet"` renders
// the simplified `<words> · saved Ns ago · ⌘K ask · ⌘. focus` strip used by
// the quiet-composer layout; clicking or pressing Enter/Space calls
// `onOpenTray` (the tray popover itself lands in task #53).

describe('StatusBar', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetEditorStore();
    // jsdom doesn't implement scrollIntoView; Radix's focus-scope may
    // trigger it when the tray opens. Stub to avoid uncaught errors in
    // tests that exercise the StatusTray integration.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // The status strip (Quiet Composer is the only shell — #415 removed the
  // legacy "full" variant; StatusBar is always the quiet strip now)
  // -------------------------------------------------------------------------
  describe('status strip', () => {
    it('root is tagged with data-quiet-status and role="button"', () => {
      const editor = createMockEditor({ text: 'hello' }) as unknown as Editor;
      openTab('/x/y.md', 'y.md');
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.getAttribute('role')).toBe('button');
      expect(root?.getAttribute('aria-label')).toBe('Open status tray');
    });

    it('renders no dot slot at all — the ambient dot is gone', () => {
      // Was "reserves an empty dot slot for task #54". The slot existed to
      // hold the Local AI / background-activity dot; with that removed there
      // is nothing to reserve space for, and an empty div beside the Settings
      // gear is width the narrow sidebar footer cannot spare.
      const editor = createMockEditor({ text: 'hi' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      expect(container.querySelector('[data-status-dots]')).toBeNull();
    });

    it('renders word count + \u2318. focus hint (no \u2318K)', () => {
      // Live-test 2026-04-25 \u2014 \u2318K hint was removed.
      // Live-test 2026-04-26 \u2014 saved-ago was relocated FROM the
      // TitleBar back INTO the QuietStatusBar (next to the word count)
      // so document-state info lives in one place. The label only
      // renders when an active tab exists; in this test no tab is
      // open, so the label is absent.
      const editor = createMockEditor({ text: 'one two three four five' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      const text = container.textContent ?? '';
      expect(text).toContain('5 words');
      expect(text).toContain('\u2318.');
      expect(text).toContain('focus');
      // Trimmed in #157 follow-up:
      expect(text).not.toContain('\u2318K');
      expect(text).not.toContain('ask');
    });

    it('uses the singular "word" label for a single word', () => {
      const editor = createMockEditor({ text: 'solo' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      expect(container.textContent ?? '').toContain('1 word');
      expect(container.textContent ?? '').not.toContain('1 words');
    });

    it('does NOT render a "saved Xs ago" label, even for a clean saved tab (removed 2026-07-01)', () => {
      // Saved-ago was dropped when the strip moved into the narrow sidebar
      // footer — redundant with auto-save and no room beside the Settings
      // button. Even a clean tab with a known lastSavedAt shows no label.
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md', Date.now() - 3_000);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      expect(container.textContent ?? '').not.toMatch(/saved \d+s ago/);
    });

    it('omits the saved-ago label entirely when no tab is active', () => {
      // No tab open \u2014 no saved-ago label and no stale dash for
      // "no document".
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      expect(container.textContent ?? '').not.toMatch(/saved \d+s ago/);
      // The em-dash placeholder is also suppressed when no tab is active.
      expect(container.querySelector('[aria-label="Not yet saved this session"]')).toBeNull();
    });

    it('calls onOpenTray when the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(root);
      expect(onOpenTray).toHaveBeenCalledTimes(1);
    });

    it('calls onOpenTray on Enter and Space', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.keyDown(root, { key: 'Enter' });
      fireEvent.keyDown(root, { key: ' ' });
      expect(onOpenTray).toHaveBeenCalledTimes(2);
    });

    // The "updates the saved label as time advances" test was deleted
    // along with the quiet saved-ago label component (live-test 2026-04-25).

    // ---------------------------------------------------------------------
    // Task #53 regression: quiet strip now owns the StatusTray popover.
    // The tray must not be in the DOM until the strip is activated, and
    // activating the strip must surface it.
    // ---------------------------------------------------------------------
    it('does not mount the StatusTray popover content until the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      renderWithProviders(<StatusBar editor={editor} />);
      // Radix renders Popover content in a portal — inspect document.body.
      expect(document.body.textContent ?? '').not.toContain('Completions');
    });

    it('mounts the StatusTray popover after the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const strip = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(strip);
      // The always-visible group headers — Completions, Comments, Help —
      // should now be in the DOM (portal). The Local AI group is
      // conditional on a `local_bundled` connection (not present here).
      const text = document.body.textContent ?? '';
      expect(text).toContain('Completions');
      expect(text).toContain('Comments');
      expect(text).toContain('Help');
    });
  });

  // -------------------------------------------------------------------------
  // Word-count debounce (deep-review batch 2, item #11) — the recompute runs
  // `editor.getText()` over the whole document, so the transaction tick is
  // debounced (250 ms trailing) instead of firing per keystroke.
  // -------------------------------------------------------------------------
  describe('word count debounce', () => {
    /** Grab the `transaction` handler StatusBar registered on the mock editor. */
    function getTransactionHandler(editor: Editor): () => void {
      const call = (editor.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'transaction',
      );
      expect(call).toBeTruthy();
      return call![1] as () => void;
    }

    it('recomputes the word count only after the 250ms trailing window, resetting on new transactions', () => {
      vi.useFakeTimers();
      const editor = createMockEditor({ text: 'one two' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);
      expect(container.textContent ?? '').toContain('2 words');

      // Simulate typing: the document text grows and a transaction fires.
      (editor.getText as unknown as ReturnType<typeof vi.fn>).mockReturnValue('one two three');
      const onTransaction = getTransactionHandler(editor);

      act(() => {
        onTransaction();
      });
      // No per-keystroke recompute — still the stale count.
      expect(container.textContent ?? '').toContain('2 words');

      // Another transaction inside the window resets the trailing timer.
      act(() => {
        vi.advanceTimersByTime(200);
        onTransaction();
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(container.textContent ?? '').toContain('2 words');

      // 250ms after the LAST transaction the count lands.
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(container.textContent ?? '').toContain('3 words');
    });

    it('clears the pending debounce timer on unmount', () => {
      vi.useFakeTimers();
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { unmount } = renderWithProviders(<StatusBar editor={editor} />);
      const onTransaction = getTransactionHandler(editor);

      act(() => {
        onTransaction();
      });
      unmount();
      // The trailing tick must not fire (setState) after unmount.
      expect(() => {
        vi.runAllTimers();
      }).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // The ambient status dot was REMOVED (Peter, 2026-08-27)
  // -------------------------------------------------------------------------
  //
  // It was a DUAL indicator: fill = Local AI server status (amber while
  // starting, then green), ring = background activity. The status half told
  // the user nothing they could act on, and the strip is portaled into the
  // sidebar footer beside the Settings gear — with the sidebar resizable down
  // to 200px, the strip could reach across the gear.
  //
  // Local AI status still lives in the StatusTray's Session group, one click
  // away, via the same `localAiDotClass` helper. Background-activity progress
  // lost its only ambient surface; recorded in the PR rather than dropped
  // quietly.
  //
  // These two guards replace eleven tests that asserted the dot's colours and
  // ring. Both invariants are things a future change could plausibly undo.
  describe('status strip has no ambient dot', () => {
    beforeEach(() => {
      resetAmbientDotStores();
    });

    it('renders no status dot even with a local AI connection running', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });
      const editor = createMockEditor({ text: 'hi there' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const strip = container.querySelector('[data-quiet-status]')!;
      expect(strip.querySelector('[data-status-dots]')).toBeNull();
      // The word count is the part that stays.
      expect(strip.textContent ?? '').toMatch(/word/i);
    });

    it('clips its content so it cannot paint over the Settings gear', () => {
      // The gear shares the sidebar footer row with this strip and is
      // `shrink-0`; `min-w-0` lets the slot shrink but does not stop content
      // painting outside the box. Without the clip the strip overlaps the one
      // control that opens Settings.
      const editor = createMockEditor({ text: 'hi' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const strip = container.querySelector('[data-quiet-status]') as HTMLElement;
      expect(strip.className).toContain('overflow-hidden');
      expect(strip.className).toContain('min-w-0');
    });
  });
});
