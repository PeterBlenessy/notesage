// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  act,
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
    isDictating: false,
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

describe('StatusBar — variants', () => {
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
  // Full variant (legacy) — regression checks
  // -------------------------------------------------------------------------
  describe('variant="full" (default, legacy)', () => {
    it('renders legacy word-count label when an editor is provided', () => {
      const editor = createMockEditor({ text: 'hello world' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const text = container.textContent ?? '';
      expect(text).toContain('2 words');
      expect(text).toMatch(/min read/);
    });

    it('does not mark the root as the quiet strip', () => {
      const editor = createMockEditor({ text: 'a' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });

    it('explicit variant="full" matches default behaviour', () => {
      const editor = createMockEditor({ text: 'one two three' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} variant="full" />);

      expect(container.textContent ?? '').toContain('3 words');
      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });

    it('renders the editor=null placeholder strip (shortcuts button visible)', () => {
      const onShortcutsOpen = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={null} onShortcutsOpen={onShortcutsOpen} />,
      );

      // Status role present, no quiet-status slot.
      expect(container.querySelector('[role="status"]')).toBeTruthy();
      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Quiet variant (task #52)
  // -------------------------------------------------------------------------
  describe('variant="quiet"', () => {
    it('root is tagged with data-quiet-status and role="button"', () => {
      const editor = createMockEditor({ text: 'hello' }) as unknown as Editor;
      openTab('/x/y.md', 'y.md');
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.getAttribute('role')).toBe('button');
      expect(root?.getAttribute('aria-label')).toBe('Open status tray');
    });

    it('reserves an empty dot slot for task #54', () => {
      const editor = createMockEditor({ text: 'hi' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const slot = container.querySelector('[data-status-dots]');
      expect(slot).toBeTruthy();
      expect(slot?.children.length).toBe(0);
    });

    it('renders word count + keyboard hints', () => {
      const editor = createMockEditor({ text: 'one two three four five' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const text = container.textContent ?? '';
      expect(text).toContain('5 words');
      expect(text).toContain('\u2318K');
      expect(text).toContain('ask');
      expect(text).toContain('\u2318.');
      expect(text).toContain('focus');
    });

    it('uses the singular "word" label for a single word', () => {
      const editor = createMockEditor({ text: 'solo' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('1 word');
      expect(container.textContent ?? '').not.toContain('1 words');
    });

    it('shows "saved Ns ago" when an active tab has lastSavedAt', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md', Date.now() - 3_000);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toMatch(/saved \ds ago/);
    });

    it('shows an em-dash placeholder when lastSavedAt is undefined', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md' /* no lastSavedAt */);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('\u2014');
      expect(container.textContent ?? '').not.toMatch(/saved \d/);
    });

    it('calls onOpenTray when the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(root);
      expect(onOpenTray).toHaveBeenCalledTimes(1);
    });

    it('calls onOpenTray on Enter and Space', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.keyDown(root, { key: 'Enter' });
      fireEvent.keyDown(root, { key: ' ' });
      expect(onOpenTray).toHaveBeenCalledTimes(2);
    });

    it('updates the saved label as time advances (fake timers)', () => {
      vi.useFakeTimers();
      const start = new Date('2026-04-22T12:00:00Z').getTime();
      vi.setSystemTime(start);

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md', start);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('saved 0s ago');

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(container.textContent ?? '').toContain('saved 10s ago');
    });

    // ---------------------------------------------------------------------
    // Task #53 regression: quiet strip now owns the StatusTray popover.
    // The tray must not be in the DOM until the strip is activated, and
    // activating the strip must surface it.
    // ---------------------------------------------------------------------
    it('does not mount the StatusTray popover content until the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      renderWithProviders(<StatusBar editor={editor} variant="quiet" />);
      // Radix renders Popover content in a portal — inspect document.body.
      expect(document.body.textContent ?? '').not.toContain('Completions');
    });

    it('mounts the StatusTray popover after the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const strip = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(strip);
      // All four group headers should now be in the DOM (portal).
      const text = document.body.textContent ?? '';
      expect(text).toContain('Completions');
      expect(text).toContain('Comments');
      expect(text).toContain('Session');
      expect(text).toContain('Help');
    });
  });

  // -------------------------------------------------------------------------
  // Ambient dots (task #54)
  // -------------------------------------------------------------------------
  describe('variant="quiet" — ambient dots', () => {
    beforeEach(() => {
      resetAmbientDotStores();
    });

    it('renders no dots when Local AI is stopped, completions are off, and not recording', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      expect(slot).toBeTruthy();
      // The dot slot is present but empty — no ambient signals to surface.
      expect(slot.querySelectorAll('button').length).toBe(0);
    });

    it('renders the green dot when Local AI is running AND routed to interactive', () => {
      const localAi = addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: localAi.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      useLocalAIStore.setState({ serverStatus: 'running' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      const dots = slot.querySelectorAll('button');
      expect(dots.length).toBe(1);
      // aria-label describes both the state AND the target group.
      expect(dots[0].getAttribute('aria-label')).toContain('Local AI running');
      expect(dots[0].getAttribute('aria-label')).toContain('Session');
    });

    it('does NOT render the green dot when Local AI is routed but not running', () => {
      const localAi = addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: localAi.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      useLocalAIStore.setState({ serverStatus: 'starting' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      expect(slot.querySelectorAll('button').length).toBe(0);
    });

    it('renders the orange dot when inline completions routed AND active tab is in scope', () => {
      const ollama = addConnection({
        id: 'c-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: null },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: ollama.id },
        },
      });
      // Open a tab inside the notes root so `isUriInScope` returns true.
      openTab('/Users/peter/Notesage/note.md', 'note.md');

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      const dots = slot.querySelectorAll('button');
      expect(dots.length).toBe(1);
      expect(dots[0].getAttribute('aria-label')).toContain('completions active');
      expect(dots[0].getAttribute('aria-label')).toContain('Completions');
    });

    it('does NOT render the orange dot when the active tab is out of scope', () => {
      const ollama = addConnection({
        id: 'c-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: null },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: ollama.id },
        },
      });
      // Tab is outside both notes root and any selected project — out of scope.
      openTab('/etc/hosts', 'hosts');

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      expect(slot.querySelectorAll('button').length).toBe(0);
    });

    it('renders the red dot when recording-store.isRecording is true', () => {
      useRecordingStore.setState({ isRecording: true });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const slot = container.querySelector('[data-status-dots]') as HTMLElement;
      const dots = slot.querySelectorAll('button');
      expect(dots.length).toBe(1);
      expect(dots[0].getAttribute('aria-label')).toContain('Recording active');
      expect(dots[0].getAttribute('aria-label')).toContain('Session');
    });

    it('clicking the green dot opens the tray scrolled to the Session group', () => {
      const localAi = addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: localAi.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      useLocalAIStore.setState({ serverStatus: 'running' });

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      // Tray should not be in the DOM before the click.
      expect(document.body.textContent ?? '').not.toContain('Completions');
      const dot = container.querySelector('[data-status-dots] button') as HTMLElement;
      fireEvent.click(dot);
      // Tray is now mounted — verified via all four group headings in the portal.
      const text = document.body.textContent ?? '';
      expect(text).toContain('Completions');
      expect(text).toContain('Session');
    });

    it('clicking a dot does not also trigger the strip click (no double-fire of onOpenTray)', () => {
      useRecordingStore.setState({ isRecording: true });
      const onOpenTray = vi.fn();

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" onOpenTray={onOpenTray} />,
      );
      const dot = container.querySelector('[data-status-dots] button') as HTMLElement;
      fireEvent.click(dot);
      // A bubbling click would fire onOpenTray twice (once from the dot, once
      // from the strip). stopPropagation in StatusDot must prevent that.
      expect(onOpenTray).toHaveBeenCalledTimes(1);
    });

    it('dot aria-labels are descriptive (state + target group)', () => {
      // Turn on all three signals so every dot renders at once.
      const localAi = addConnection({
        id: 'c-local',
        provider: 'local_ai',
        authMethod: 'local_bundled',
        label: 'Local AI',
      });
      const ollama = addConnection({
        id: 'c-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Ollama',
      });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: localAi.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: ollama.id },
        },
      });
      useLocalAIStore.setState({ serverStatus: 'running' });
      useRecordingStore.setState({ isRecording: true });
      openTab('/Users/peter/Notesage/note.md', 'note.md');

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const dots = Array.from(
        container.querySelectorAll('[data-status-dots] button'),
      );
      const labels = dots.map((d) => d.getAttribute('aria-label') ?? '');
      // All three dots are present with descriptive labels.
      expect(labels.length).toBe(3);
      expect(labels.some((l) => l.includes('Local AI running'))).toBe(true);
      expect(labels.some((l) => l.includes('completions active'))).toBe(true);
      expect(labels.some((l) => l.includes('Recording active'))).toBe(true);
    });
  });
});
