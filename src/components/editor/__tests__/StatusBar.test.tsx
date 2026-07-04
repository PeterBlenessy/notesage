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

    it('reserves an empty dot slot for task #54', () => {
      const editor = createMockEditor({ text: 'hi' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );

      const slot = container.querySelector('[data-status-dots]');
      expect(slot).toBeTruthy();
      expect(slot?.children.length).toBe(0);
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
  // Ambient dots (task #54)
  // -------------------------------------------------------------------------
  describe('ambient dots', () => {
    beforeEach(() => {
      resetAmbientDotStores();
    });

    /**
     * Live-test 2026-04-25 — the left dot is now the local-AI status
     * indicator. Tone mirrors `LocalAIIndicator`'s popover exactly:
     *   running  → green
     *   starting → amber (with `animate-pulse`)
     *   error    → red
     *   stopped  → muted
     *
     * The dot only renders when a `local_bundled` connection exists.
     * The previous "inline completions active" orange semantic was
     * dropped — completions surface through the StatusTray popover and
     * `OutOfScopeCompletionsIndicator` instead.
     */
    it('renders no dots when no local_bundled connection AND not recording', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      expect(slot).toBeTruthy();
      expect(slot.querySelectorAll('button').length).toBe(0);
    });

    it('renders a GREEN local-AI dot when local_bundled exists and serverStatus="running"', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const dots = container.querySelectorAll('[data-status-dots] button');
      expect(dots.length).toBe(1);
      expect(dots[0].querySelector('span')?.className).toContain('bg-green-500');
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI running');
      expect(dots[0].getAttribute('aria-label')).toContain('Session');
    });

    it('renders an AMBER (pulsing) local-AI dot when serverStatus="starting"', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'starting' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const dots = container.querySelectorAll('[data-status-dots] button');
      expect(dots.length).toBe(1);
      expect(dots[0].querySelector('span')?.className).toContain('bg-amber-500');
      // Amber tone uses `animate-pulse` to match the popover starting state.
      expect(dots[0].querySelector('span')?.className).toContain('animate-pulse');
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI starting');
    });

    it('renders a RED local-AI dot when serverStatus="error"', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'error' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const dots = container.querySelectorAll('[data-status-dots] button');
      expect(dots.length).toBe(1);
      expect(dots[0].querySelector('span')?.className).toContain('bg-red-500');
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI error');
    });

    it('renders a MUTED local-AI dot when serverStatus is stopped', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      // Default `serverStatus` after `resetAmbientDotStores` is `"stopped"`.

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      const dots = container.querySelectorAll('[data-status-dots] button');
      expect(dots.length).toBe(1);
      expect(dots[0].querySelector('span')?.className).toContain('bg-muted-foreground/30');
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI stopped');
    });

    it('omits the local-AI dot entirely when no local_bundled connection exists', () => {
      // Routing inline completions to a non-local provider — the old
      // orange dot would have shown here. New design: no dot.
      addConnection({
        id: 'c-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
      });
      useLocalAIStore.setState({ serverStatus: 'stopped' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      expect(
        container.querySelectorAll('[data-status-dots] button').length,
      ).toBe(0);
    });

    it('does NOT render a dot for recording alone — the AgentOrb owns that now (#415)', () => {
      useRecordingStore.setState({ isRecording: true });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      // No local AI, no background activity — recording is no longer surfaced
      // on the strip, so the dot slot stays empty.
      expect(
        container.querySelectorAll('[data-status-dots] button').length,
      ).toBe(0);
    });

    it('clicking the local-AI dot opens the tray scrolled to the Session group', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} />,
      );
      expect(document.body.textContent ?? '').not.toContain('Completions');
      const dot = container.querySelector('[data-status-dots] button') as HTMLElement;
      fireEvent.click(dot);
      const text = document.body.textContent ?? '';
      expect(text).toContain('Completions');
      // Live-test 2026-04-25 — the "Session" group was renamed to
      // "Local AI" and now only renders when a `local_bundled`
      // connection exists. This test scenario does add such a
      // connection, so the section header should be present.
      expect(text).toContain('Local AI');
    });

    it('clicking the dot does not also trigger the strip click (no double-fire of onOpenTray)', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });
      const onOpenTray = vi.fn();

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} onOpenTray={onOpenTray} />,
      );
      const dot = container.querySelector('[data-status-dots] button') as HTMLElement;
      fireEvent.click(dot);
      // A bubbling click would fire onOpenTray twice (once from the dot, once
      // from the strip). stopPropagation in StatusDot must prevent that.
      expect(onOpenTray).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Dual-indicator progress ring (#415) — background activity (indexing /
  // model downloads) fills a ring around the SAME status dot.
  // -------------------------------------------------------------------------
  describe('background-activity progress ring', () => {
    beforeEach(() => {
      resetAmbientDotStores();
    });

    it('shows an activity dot with a progress ring when a model is downloading (no local AI)', () => {
      useRecordingStore.setState({ activeDownloads: { base: { progress: 50 } } });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const dot = container.querySelector('[data-status-dots] button') as HTMLElement | null;
      expect(dot).toBeTruthy();
      // Neutral fill (no local AI) + a ring at ~50%.
      expect(dot?.querySelector('span')?.className).toContain('bg-muted-foreground/30');
      expect(dot?.getAttribute('data-progress')).toBe('50');
      expect(dot?.querySelector('svg')).toBeTruthy();
      expect(dot?.getAttribute('aria-label')).toContain('Downloading');
      expect(dot?.getAttribute('aria-label')).toContain('status tray');
    });

    it('wraps the Local AI dot with the ring when both local AI and a download are live', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });
      useRecordingStore.setState({ activeDownloads: { base: { progress: 25 } } });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const dots = container.querySelectorAll('[data-status-dots] button');
      // Still ONE dot — the ring wraps the existing Local AI dot (dual indicator).
      expect(dots.length).toBe(1);
      expect(dots[0].querySelector('span')?.className).toContain('bg-green-500');
      expect(dots[0].getAttribute('data-progress')).toBe('25');
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI running');
      expect(dots[0].getAttribute('aria-label')).toContain('Downloading');
    });

    it('shows no ring when there is no background activity', () => {
      addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useLocalAIStore.setState({ serverStatus: 'running' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const dot = container.querySelector('[data-status-dots] button') as HTMLElement;
      expect(dot.getAttribute('data-progress')).toBeNull();
      expect(dot.querySelector('svg')).toBeNull();
    });
  });
});
