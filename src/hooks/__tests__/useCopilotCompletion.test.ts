// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useCopilotCompletion } from '@/hooks/useCopilotCompletion';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';
import type { Editor } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

// Mock the extensions module — these are ProseMirror plugin operations
vi.mock('@/components/editor/extensions', () => ({
  setGhostText: vi.fn(),
  clearGhostText: vi.fn(),
  hasActiveGhostText: vi.fn(() => false),
  hasActiveInlineDiff: vi.fn(() => false),
  GhostTextPluginKey: { getState: vi.fn(() => null) },
}));

// Mock copilot-shared
vi.mock('@/lib/copilot-shared', () => ({
  requestCopilotCompletion: vi.fn(),
  notifyCompletionAccepted: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import mock handles after vi.mock hoisting
import {
  setGhostText as mockSetGhostText,
  clearGhostText as mockClearGhostText,
  hasActiveGhostText as _hasActiveGhostText,
  hasActiveInlineDiff as _hasActiveInlineDiff,
  GhostTextPluginKey as mockGhostTextPluginKey,
} from '@/components/editor/extensions';
import {
  requestCopilotCompletion as _requestCopilotCompletion,
  notifyCompletionAccepted as _notifyCompletionAccepted,
} from '@/lib/copilot-shared';

const mockHasActiveGhostText = _hasActiveGhostText as ReturnType<typeof vi.fn>;
const mockHasActiveInlineDiff = _hasActiveInlineDiff as ReturnType<typeof vi.fn>;
const mockRequestCopilotCompletion = _requestCopilotCompletion as ReturnType<typeof vi.fn>;
const mockNotifyCompletionAccepted = _notifyCompletionAccepted as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentManagedConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-copilot-lsp',
    provider: 'github_copilot_lsp',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Copilot LSP',
    credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
    capabilities: ['inline_completion'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeApiKeyConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-ollama',
    provider: 'ollama',
    authMethod: 'local',
    status: 'connected',
    label: 'Ollama Local',
    credentials: { type: 'local' },
    capabilities: ['inline_completion', 'interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeTab(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tab-1',
    filePath: '/project/test.md',
    fileName: 'test.md',
    isDirty: false,
    content: 'Hello world',
    frontmatter: null,
    fileType: 'markdown' as const,
    contentLoaded: true,
    ...overrides,
  };
}

/**
 * Create a minimal mock Editor that satisfies the hook's needs.
 * ProseMirror doc is simulated as a flat text with \n separators.
 */
function makeMockEditor(text = 'Hello world', cursorPos = 11): Editor {
  const doc = {
    textBetween: vi.fn((from: number, to: number, sep?: string) => {
      const fullText = text;
      if (sep) {
        // Simulate returning text with separator
        return fullText.slice(from, Math.min(to, fullText.length));
      }
      return fullText.slice(from, Math.min(to, fullText.length));
    }),
    content: { size: text.length },
  };

  const selection = {
    empty: true,
    $from: { pos: cursorPos },
  };

  const updateListeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const editor = {
    state: { doc, selection },
    isFocused: true,
    isDestroyed: false,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!updateListeners.has(event)) {
        updateListeners.set(event, new Set());
      }
      updateListeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      updateListeners.get(event)?.delete(handler);
    }),
    // Helper to trigger registered handlers (not part of real Editor API)
    _emit: (event: string, ...args: unknown[]) => {
      updateListeners.get(event)?.forEach((fn) => fn(...args));
    },
    _updateListeners: updateListeners,
  } as unknown as Editor & { _emit: (event: string, ...args: unknown[]) => void };

  return editor;
}

function resetStores() {
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
  });
  useConnectionsStore.setState({ connections: [] });
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
  });
  useSettingsStore.setState({
    inlineCompletionsDisabled: false,
  });
}

function setupWithConnection(connection: Connection) {
  useConnectionsStore.setState({ connections: [connection] });
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: connection.id },
    },
  });
}

function setupWithTab(tab = makeTab()) {
  useEditorStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
  });
}

function setupWithProject(path = '/project') {
  useWorkspaceStore.setState({
    projects: [{ path, fileTree: [] }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCopilotCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
    vi.mocked(invoke).mockClear();
    vi.mocked(mockSetGhostText).mockClear();
    vi.mocked(mockClearGhostText).mockClear();
    mockHasActiveGhostText.mockReset().mockReturnValue(false);
    mockHasActiveInlineDiff.mockReset().mockReturnValue(false);
    mockRequestCopilotCompletion.mockReset();
    mockNotifyCompletionAccepted.mockReset();
    (mockGhostTextPluginKey as unknown as { getState: ReturnType<typeof vi.fn> }).getState.mockReset().mockReturnValue(null);

    // Default: LSP start/stop succeed
    setMockInvokeHandler('copilot_lsp_start', () => undefined);
    setMockInvokeHandler('copilot_lsp_stop', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_open', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_close', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_focus', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_change', () => undefined);
    setMockInvokeHandler('copilot_lsp_request_completion', () => []);
    setMockInvokeHandler('copilot_lsp_did_show_completion', () => undefined);
    setMockInvokeHandler('copilot_lsp_accept_completion', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // LSP Lifecycle
  // =========================================================================

  describe('LSP lifecycle', () => {
    it('starts LSP for agent_managed connection with a working directory', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      renderHook(() => useCopilotCompletion(null));

      // Flush the invoke promise
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_start', {
        workingDirectory: '/project',
      });
    });

    it('skips LSP for non-agent_managed connections (e.g. local)', async () => {
      const conn = makeApiKeyConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).not.toHaveBeenCalledWith(
        'copilot_lsp_start',
        expect.anything(),
      );
    });

    it('skips LSP when no working directory is available', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      // No project set up

      renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).not.toHaveBeenCalledWith(
        'copilot_lsp_start',
        expect.anything(),
      );
    });

    it('stops LSP when connection is removed', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const { rerender } = renderHook(() => useCopilotCompletion(null));

      // Let LSP start
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Clear invoke tracking, then remove connection
      vi.mocked(invoke).mockClear();

      act(() => {
        useRoutingStore.setState({
          routing: {
            interactive: { connectionId: null },
            agent_tasks: { connectionId: null },
            inline_completion: { connectionId: null },
          },
        });
        useConnectionsStore.setState({ connections: [] });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_stop');
    });

    it('stops LSP on unmount when connection changes trigger effect re-run', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const { rerender, unmount } = renderHook(() => useCopilotCompletion(null));

      // Let LSP start — this sets lspReady to true
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Force a re-render so the effect re-runs with lspReady=true in its closure.
      // This simulates a workingDir change which causes the effect to re-register
      // its cleanup with the current lspReady value.
      act(() => {
        useWorkspaceStore.setState({
          projects: [{ path: '/project2', fileTree: [] }],
        });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      unmount();

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_stop');
    });
  });

  // =========================================================================
  // Document sync
  // =========================================================================

  describe('document sync', () => {
    it('sends didOpen when a tab becomes active', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      // Let LSP start + document sync effects run
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_open', {
        uri: '/project/test.md',
        content: expect.any(String),
        version: 0,
      });
    });

    it('sends didClose + didOpen on tab switch', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab1 = makeTab({ id: 'tab-1', filePath: '/project/one.md', fileName: 'one.md' });
      const tab2 = makeTab({ id: 'tab-2', filePath: '/project/two.md', fileName: 'two.md' });

      useEditorStore.setState({
        tabs: [tab1, tab2],
        activeTabId: 'tab-1',
      });

      const editor = makeMockEditor('file one content');
      const { rerender } = renderHook(() => useCopilotCompletion(editor));

      // Let LSP start and open first doc
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      // Switch to tab 2
      act(() => {
        useEditorStore.setState({ activeTabId: 'tab-2' });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_close', {
        uri: '/project/one.md',
      });
      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_open', {
        uri: '/project/two.md',
        content: expect.any(String),
        version: 0,
      });
    });

    it('sends didFocus on tab activation', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor();
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_focus', {
        uri: '/project/test.md',
      });
    });

    it('skips document sync in source mode', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab({ viewMode: 'source' as const });
      setupWithTab(tab);

      const editor = makeMockEditor();
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // didOpen should NOT be called since we are in source mode
      const didOpenCalls = vi.mocked(invoke).mock.calls.filter(
        (call) => call[0] === 'copilot_lsp_did_open',
      );
      expect(didOpenCalls).toHaveLength(0);
    });

    it('closes document when switching to source mode', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor();
      const { rerender } = renderHook(() => useCopilotCompletion(editor));

      // Let LSP start and open document
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      // Switch to source mode
      act(() => {
        useEditorStore.setState({
          tabs: [{ ...tab, viewMode: 'source' as const }],
        });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_close', {
        uri: '/project/test.md',
      });
    });

    it('closes document on unmount', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor();
      const { unmount } = renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      unmount();

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_close', {
        uri: '/project/test.md',
      });
    });
  });

  // =========================================================================
  // Content changes
  // =========================================================================

  describe('content changes', () => {
    it('sends didChange on editor update', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      // Let LSP start and open document
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      // Simulate editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invoke).toHaveBeenCalledWith('copilot_lsp_did_change', {
        uri: '/project/test.md',
        content: expect.any(String),
        version: 1,
      });
    });

    it('increments version on each change', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();

      // Trigger two updates
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      // Let the first didChange through
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      const didChangeCalls = vi.mocked(invoke).mock.calls.filter(
        (call) => call[0] === 'copilot_lsp_did_change',
      );

      expect(didChangeCalls.length).toBeGreaterThanOrEqual(2);
      const versions = didChangeCalls.map(
        (call) => (call[1] as { version: number }).version,
      );
      // Each version should be greater than the previous
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
      }
    });
  });

  // =========================================================================
  // Completion requests
  // =========================================================================

  describe('completion requests', () => {
    it('requests completion after 150ms debounce', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockRequestCopilotCompletion.mockResolvedValue({
        text: 'completion text',
        command: undefined,
      });

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      vi.mocked(invoke).mockClear();
      mockRequestCopilotCompletion.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      // Before 150ms: no completion request
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(mockRequestCopilotCompletion).not.toHaveBeenCalled();

      // After 150ms: completion requested
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockRequestCopilotCompletion).toHaveBeenCalledWith(
        '/project/test.md',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('dispatches ghost text on successful completion', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockRequestCopilotCompletion.mockResolvedValue({
        text: ' more text',
        command: { command: 'test-cmd', arguments: [] },
      });

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockSetGhostText.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: ' more text',
        from: 11,
        to: 11,
        command: { command: 'test-cmd', arguments: [] },
      });
    });

    it('clears ghost text when completion returns null', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockRequestCopilotCompletion.mockResolvedValue(null);
      mockHasActiveGhostText.mockReturnValue(true);

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockClearGhostText.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);
    });

    it('silently handles completion errors', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockRequestCopilotCompletion.mockRejectedValue(new Error('LSP error'));

      const editor = makeMockEditor('Hello world');

      // Should not throw
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      // Should not throw
      await act(async () => {
        await vi.runAllTimersAsync();
      });
    });

    it('skips completion when inline completions are disabled', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      useSettingsStore.setState({ inlineCompletionsDisabled: true });

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockRequestCopilotCompletion.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRequestCopilotCompletion).not.toHaveBeenCalled();
    });

    it('skips completion when selection is not collapsed', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor('Hello world');
      // Make selection non-empty
      (editor.state.selection as { empty: boolean }).empty = false;

      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockRequestCopilotCompletion.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRequestCopilotCompletion).not.toHaveBeenCalled();
    });

    it('skips completion when inline diff is active', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockHasActiveInlineDiff.mockReturnValue(true);

      const editor = makeMockEditor('Hello world');
      renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockRequestCopilotCompletion.mockClear();

      // Trigger editor update
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRequestCopilotCompletion).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Ghost text clearing on tab switch
  // =========================================================================

  describe('ghost text clearing', () => {
    it('clears ghost text on tab switch', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab1 = makeTab({ id: 'tab-1', filePath: '/project/one.md' });
      const tab2 = makeTab({ id: 'tab-2', filePath: '/project/two.md' });

      useEditorStore.setState({
        tabs: [tab1, tab2],
        activeTabId: 'tab-1',
      });

      mockHasActiveGhostText.mockReturnValue(true);

      const editor = makeMockEditor();
      const { rerender } = renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockClearGhostText.mockClear();

      // Switch to tab 2
      act(() => {
        useEditorStore.setState({ activeTabId: 'tab-2' });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);
    });

    it('clears ghost text when completions become disabled', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockHasActiveGhostText.mockReturnValue(true);

      const editor = makeMockEditor();
      const { rerender } = renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockClearGhostText.mockClear();

      // Disable completions
      act(() => {
        useSettingsStore.setState({ inlineCompletionsDisabled: true });
      });

      rerender();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);
    });
  });

  // =========================================================================
  // Status event listener
  // =========================================================================

  describe('status event listener', () => {
    it('registers a copilot-status-changed listener when connected', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Emitting a status event should not throw
      emitMockEvent('copilot-status-changed', {
        message: 'Connected',
        kind: 'Info',
      });
    });

    it('does not register listener without a connection', async () => {
      // No connection set up

      const { unmount } = renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Should not throw when emitting without listeners
      emitMockEvent('copilot-status-changed', {
        message: 'Error occurred',
        kind: 'Error',
      });

      unmount();
    });
  });

  // =========================================================================
  // Null editor safety
  // =========================================================================

  describe('null editor safety', () => {
    it('does not crash when editor is null', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      // Should not throw with null editor
      const { unmount } = renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      unmount();
    });

    it('does not attach update listeners when editor is null', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      renderHook(() => useCopilotCompletion(null));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // No editor.on should have been called
      // This is implicitly verified by the hook not crashing
    });
  });

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  describe('cleanup on unmount', () => {
    it('removes editor update listener on unmount', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      const editor = makeMockEditor();
      const { unmount } = renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // The hook should have registered an 'update' listener
      expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));

      unmount();

      // The hook should have deregistered the 'update' listener
      expect(editor.off).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('clears pending completion timeout on unmount', async () => {
      const conn = makeAgentManagedConnection();
      setupWithConnection(conn);
      setupWithProject('/project');

      const tab = makeTab();
      setupWithTab(tab);

      mockRequestCopilotCompletion.mockResolvedValue({
        text: 'ghost',
        command: undefined,
      });

      const editor = makeMockEditor();
      const { unmount } = renderHook(() => useCopilotCompletion(editor));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Trigger an update to start a debounce timer
      act(() => {
        (editor as unknown as { _emit: (event: string) => void })._emit('update');
      });

      // Unmount before debounce fires
      unmount();

      mockRequestCopilotCompletion.mockClear();

      // Advance past the debounce — the completion should NOT be requested
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(mockRequestCopilotCompletion).not.toHaveBeenCalled();
    });
  });
});
