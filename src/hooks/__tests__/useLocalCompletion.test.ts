// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';
import { useLocalCompletion } from '@/hooks/useLocalCompletion';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

const mockSetGhostText = vi.fn();
const mockClearGhostText = vi.fn();
let mockHasActiveGhostText = false;
let mockHasActiveInlineDiff = false;

vi.mock('@/components/editor/extensions', () => ({
  setGhostText: (...args: unknown[]) => mockSetGhostText(...args),
  clearGhostText: (...args: unknown[]) => mockClearGhostText(...args),
  hasActiveGhostText: () => mockHasActiveGhostText,
  hasActiveInlineDiff: () => mockHasActiveInlineDiff,
}));

const mockOllamaFim = vi.fn();
const mockLocalBundledFim = vi.fn();
const mockOpenaiCompatibleFim = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    ollamaFimCompletion: (...args: unknown[]) => mockOllamaFim(...args),
    localBundledFimCompletion: (...args: unknown[]) => mockLocalBundledFim(...args),
    openaiCompatibleFimCompletion: (...args: unknown[]) => mockOpenaiCompatibleFim(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-ollama',
    provider: 'ollama',
    authMethod: 'local',
    status: 'connected',
    label: 'Test Ollama',
    credentials: { type: 'local', url: 'http://localhost:11434' },
    capabilities: ['inline_completion'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeLocalBundledConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-local-bundled',
    provider: 'local',
    authMethod: 'local_bundled',
    status: 'connected',
    label: 'Local AI',
    credentials: { type: 'local_bundled' },
    capabilities: ['inline_completion'],
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

function makeOpenaiCompatibleConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-oai-compat',
    provider: 'openai_compatible',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Groq',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['inline_completion'],
    config: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3-70b' },
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

/** Create a minimal mock editor with a text document. */
function makeMockEditor(text = 'Hello world', cursorPos?: number) {
  const pos = cursorPos ?? text.length;
  const docSize = text.length;
  return {
    isDestroyed: false,
    isFocused: true,
    state: {
      doc: {
        content: { size: docSize },
        textBetween: (from: number, to: number, _sep?: string) => text.slice(from, to),
      },
      selection: {
        empty: true,
        $from: { pos },
      },
    },
    on: vi.fn(),
    off: vi.fn(),
  };
}

/** Set up routing store with a given connection for inline_completion. */
function setupRouting(connection: Connection | null, model?: string) {
  // Set the connection in connections store so getConnectionForUseCase can resolve it
  if (connection) {
    useConnectionsStore.setState({
      connections: [connection],
    });
  } else {
    useConnectionsStore.setState({
      connections: [],
    });
  }
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: {
        connectionId: connection?.id ?? null,
        model,
      },
    },
  });
}

function setupEditorStore(filePath = '/test/file.md', tabId = 'tab-1') {
  useEditorStore.setState({
    tabs: [{
      id: tabId,
      filePath,
      fileName: 'file.md',
      isDirty: false,
      content: 'Hello world',
      frontmatter: null,
      fileType: 'markdown' as const,
    }],
    activeTabId: tabId,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useLocalCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSetGhostText.mockClear();
    mockClearGhostText.mockClear();
    mockOllamaFim.mockClear();
    mockLocalBundledFim.mockClear();
    mockOpenaiCompatibleFim.mockClear();
    mockHasActiveGhostText = false;
    mockHasActiveInlineDiff = false;

    // Reset stores
    useSettingsStore.setState({
      inlineCompletionsDisabled: false,
      fimContextChars: 500,
    });
    setupEditorStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Activation conditions
  // -------------------------------------------------------------------------

  describe('activation conditions', () => {
    it('activates for local (Ollama) connection', () => {
      const conn = makeConnection();
      setupRouting(conn);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));
      unmount();
    });

    it('activates for local_bundled connection', () => {
      const conn = makeLocalBundledConnection();
      setupRouting(conn);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));
      unmount();
    });

    it('activates for openai_compatible connection', () => {
      const conn = makeOpenaiCompatibleConnection();
      setupRouting(conn);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));
      unmount();
    });

    it('does NOT activate for api_key anthropic connection', () => {
      const conn = makeConnection({
        id: 'conn-anthropic',
        provider: 'anthropic',
        authMethod: 'api_key',
        credentials: { type: 'api_key', credentialStored: true },
      });
      setupRouting(conn);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).not.toHaveBeenCalled();
      unmount();
    });

    it('does NOT activate for agent_managed connection', () => {
      const conn = makeConnection({
        id: 'conn-acp',
        provider: 'anthropic',
        authMethod: 'agent_managed',
        credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      } as Partial<Connection>);
      setupRouting(conn);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).not.toHaveBeenCalled();
      unmount();
    });

    it('does NOT activate when no connection is routed', () => {
      setupRouting(null);
      const editor = makeMockEditor();

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      expect(editor.on).not.toHaveBeenCalled();
      unmount();
    });

    it('does NOT activate when editor is null', () => {
      const conn = makeConnection();
      setupRouting(conn);

      const { unmount } = renderHook(() => useLocalCompletion(null));
      // No crash, no editor.on call
      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Debounce behavior
  // -------------------------------------------------------------------------

  describe('debounce', () => {
    it('debounces completion requests by 300ms', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion text');
      const editor = makeMockEditor('Hello ');

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));

      // Get the update handler that was registered
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;
      expect(updateHandler).toBeDefined();

      // Trigger an update
      updateHandler();

      // Not called yet — waiting for debounce
      expect(mockOllamaFim).not.toHaveBeenCalled();

      // Advance 200ms — still not called
      await vi.advanceTimersByTimeAsync(200);
      expect(mockOllamaFim).not.toHaveBeenCalled();

      // Advance to 300ms — now it should fire
      await vi.advanceTimersByTimeAsync(100);
      expect(mockOllamaFim).toHaveBeenCalledTimes(1);

      unmount();
    });

    it('resets debounce timer on rapid updates', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');
      const editor = makeMockEditor('Hello ');

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // Fire multiple rapid updates
      updateHandler();
      await vi.advanceTimersByTimeAsync(100);
      updateHandler();
      await vi.advanceTimersByTimeAsync(100);
      updateHandler();

      // Only 200ms since last update — should not have fired yet
      await vi.advanceTimersByTimeAsync(200);
      expect(mockOllamaFim).not.toHaveBeenCalled();

      // 300ms since last update — now fires
      await vi.advanceTimersByTimeAsync(100);
      expect(mockOllamaFim).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Prefix/suffix context extraction
  // -------------------------------------------------------------------------

  describe('prefix/suffix context extraction', () => {
    it('extracts prefix and suffix around cursor position', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('world');
      const text = 'Hello ';
      const editor = makeMockEditor(text, 6); // cursor after "Hello "

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      expect(mockOllamaFim).toHaveBeenCalledWith(
        'Hello ', // prefix
        '',       // suffix (cursor at end)
        'codellama',
        'http://localhost:11434',
      );

      unmount();
    });

    it('truncates prefix/suffix to fimContextChars', async () => {
      useSettingsStore.setState({ fimContextChars: 10 });
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');

      const longText = 'A'.repeat(50);
      const cursorPos = 25;
      const editor = makeMockEditor(longText, cursorPos);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      // prefix should be last 10 chars of the 25-char prefix
      expect(mockOllamaFim).toHaveBeenCalledWith(
        'A'.repeat(10), // truncated prefix (last 10 chars)
        'A'.repeat(10), // truncated suffix (first 10 chars)
        'codellama',
        'http://localhost:11434',
      );

      unmount();
    });

    it('calls localBundledFimCompletion for local_bundled', async () => {
      const conn = makeLocalBundledConnection();
      setupRouting(conn, 'qwen2.5-coder');
      mockLocalBundledFim.mockResolvedValue('bundled completion');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      expect(mockLocalBundledFim).toHaveBeenCalledWith('Hello ', '', 'qwen2.5-coder');
      expect(mockOllamaFim).not.toHaveBeenCalled();

      unmount();
    });

    it('calls openaiCompatibleFimCompletion for openai_compatible', async () => {
      const conn = makeOpenaiCompatibleConnection();
      setupRouting(conn, 'llama-3-70b');
      mockOpenaiCompatibleFim.mockResolvedValue('compatible completion');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      expect(mockOpenaiCompatibleFim).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1',
        'conn-oai-compat',
        'llama-3-70b',
        'Hello ',
        '',
      );

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Ghost text dispatch on success
  // -------------------------------------------------------------------------

  describe('ghost text dispatch', () => {
    it('calls setGhostText with completion text on success', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('world');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      // Wait for the promise to resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: 'world',
        from: 6,
        to: 6,
      });

      unmount();
    });

    it('clears ghost text when completion is empty', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('   ');
      mockHasActiveGhostText = true;
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);
      expect(mockSetGhostText).not.toHaveBeenCalled();

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Skip conditions
  // -------------------------------------------------------------------------

  describe('skip conditions', () => {
    it('skips when inlineCompletionsDisabled is true', async () => {
      useSettingsStore.setState({ inlineCompletionsDisabled: true });
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      const editor = makeMockEditor('Hello ');

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      // With completions disabled, the update handler may still register
      // but should not fire the completion request
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as (() => void) | undefined;

      if (updateHandler) {
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
      }

      expect(mockOllamaFim).not.toHaveBeenCalled();

      unmount();
    });

    it('skips when selection is not empty (text is selected)', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      const editor = makeMockEditor('Hello world');
      // Non-empty selection
      editor.state.selection.empty = false;

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      expect(mockOllamaFim).not.toHaveBeenCalled();

      unmount();
    });

    it('skips when inline diff is active', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockHasActiveInlineDiff = true;
      const editor = makeMockEditor('Hello world');

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      expect(mockOllamaFim).not.toHaveBeenCalled();

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Error backoff
  // -------------------------------------------------------------------------

  describe('error backoff', () => {
    it('stops requesting after 5 consecutive failures', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockRejectedValue(new Error('server error'));
      const editor = makeMockEditor('Hello ');

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // Make 5 failing requests — need to change position each time to avoid dedup
      for (let i = 0; i < 5; i++) {
        const pos = 6 + i;
        editor.state.selection.$from.pos = pos;
        editor.state.doc.content.size = 20;
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
        // Let the promise reject
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(mockOllamaFim).toHaveBeenCalledTimes(5);
      mockOllamaFim.mockClear();

      // 6th request should be skipped due to backoff
      editor.state.selection.$from.pos = 15;
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockOllamaFim).not.toHaveBeenCalled();

      unmount();
    });

    it('resets error count on successful completion', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      const editor = makeMockEditor('Hello ', 6);
      editor.state.doc.content.size = 20;

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // Make 3 failures
      mockOllamaFim.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        editor.state.selection.$from.pos = 6 + i;
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(mockOllamaFim).toHaveBeenCalledTimes(3);

      // Now succeed — should reset counter
      mockOllamaFim.mockResolvedValue('completion');
      editor.state.selection.$from.pos = 12;
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockOllamaFim).toHaveBeenCalledTimes(4);

      // Should be able to make more requests (counter was reset)
      mockOllamaFim.mockRejectedValue(new Error('fail again'));
      for (let i = 0; i < 4; i++) {
        editor.state.selection.$from.pos = 13 + i;
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);
      }

      // Should have made all 4 requests (counter was reset to 0 on success)
      expect(mockOllamaFim).toHaveBeenCalledTimes(8);

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Backoff reset on tab/connection change
  // -------------------------------------------------------------------------

  describe('backoff reset on tab/connection change', () => {
    it('resets error counter on tab switch', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockRejectedValue(new Error('fail'));
      const editor = makeMockEditor('Hello ', 6);
      editor.state.doc.content.size = 30;

      const { rerender, unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));

      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // 5 failures to hit backoff
      for (let i = 0; i < 5; i++) {
        editor.state.selection.$from.pos = 6 + i;
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(mockOllamaFim).toHaveBeenCalledTimes(5);
      mockOllamaFim.mockClear();

      // Switch tab — should reset error counter
      useEditorStore.setState({
        activeTabId: 'tab-2',
        tabs: [
          ...useEditorStore.getState().tabs,
          {
            id: 'tab-2',
            filePath: '/test/file2.md',
            fileName: 'file2.md',
            isDirty: false,
            content: 'New file',
            frontmatter: null,
            fileType: 'markdown' as const,
          },
        ],
      });
      rerender();

      // Get new update handler after rerender
      const newUpdateHandler = editor.on.mock.calls
        .filter((call: unknown[]) => call[0] === 'update')
        .pop()?.[1] as (() => void) | undefined;

      if (newUpdateHandler) {
        mockOllamaFim.mockResolvedValue('works now');
        editor.state.selection.$from.pos = 3;
        newUpdateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);

        // Should have made the request (counter was reset by tab switch effect)
        expect(mockOllamaFim).toHaveBeenCalled();
      }

      unmount();
    });

    it('resets error counter on connection change', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockRejectedValue(new Error('fail'));
      const editor = makeMockEditor('Hello ', 6);
      editor.state.doc.content.size = 30;

      const { rerender, unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));

      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // 5 failures
      for (let i = 0; i < 5; i++) {
        editor.state.selection.$from.pos = 6 + i;
        updateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(mockOllamaFim).toHaveBeenCalledTimes(5);
      mockOllamaFim.mockClear();

      // Change connection — triggers the useEffect that resets consecutiveErrors
      const newConn = makeConnection({ id: 'conn-ollama-2' });
      setupRouting(newConn, 'codellama');
      rerender();

      // The useEffect [connection?.id, model] should reset consecutiveErrors.current to 0
      // After rerender with new connection, requests should work again
      const newUpdateHandler = editor.on.mock.calls
        .filter((call: unknown[]) => call[0] === 'update')
        .pop()?.[1] as (() => void) | undefined;

      if (newUpdateHandler) {
        mockOllamaFim.mockResolvedValue('works');
        editor.state.selection.$from.pos = 3;
        newUpdateHandler();
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);

        expect(mockOllamaFim).toHaveBeenCalled();
      }

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Tab switch cleanup
  // -------------------------------------------------------------------------

  describe('tab switch cleanup', () => {
    it('clears ghost text on tab switch', () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockHasActiveGhostText = true;
      const editor = makeMockEditor('Hello ');

      const { rerender, unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));

      // Switch active tab
      useEditorStore.setState({
        activeTabId: 'tab-2',
        tabs: [
          ...useEditorStore.getState().tabs,
          {
            id: 'tab-2',
            filePath: '/test/file2.md',
            fileName: 'file2.md',
            isDirty: false,
            content: '',
            frontmatter: null,
            fileType: 'markdown' as const,
          },
        ],
      });
      rerender();

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);

      unmount();
    });

    it('cleans up timeout and aborts in-flight request on unmount', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockImplementation(() => new Promise(() => {})); // never resolves
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // Trigger an update, then unmount before it resolves
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);

      // editor.off should be called on unmount
      unmount();
      expect(editor.off).toHaveBeenCalledWith('update', expect.any(Function));
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('does not re-request at the same position with same content', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // First request
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOllamaFim).toHaveBeenCalledTimes(1);

      // Same position, same content — should be deduped
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOllamaFim).toHaveBeenCalledTimes(1);

      unmount();
    });

    it('makes new request when position changes', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');
      const editor = makeMockEditor('Hello world', 6);
      editor.state.doc.content.size = 11;

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      // First request at pos 6
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOllamaFim).toHaveBeenCalledTimes(1);

      // Move cursor to pos 11
      editor.state.selection.$from.pos = 11;
      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOllamaFim).toHaveBeenCalledTimes(2);

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Space prepending logic
  // -------------------------------------------------------------------------

  describe('space prepending logic', () => {
    it('prepends space when char before cursor is non-space and completion does not start with space/punctuation', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('world');
      // Cursor at pos 5, right after 'Hello' (no trailing space)
      const editor = makeMockEditor('Hello', 5);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: ' world', // space prepended
        from: 5,
        to: 5,
      });

      unmount();
    });

    it('does NOT prepend space when completion starts with punctuation', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('.done()');
      const editor = makeMockEditor('Hello', 5);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: '.done()', // no space prepended
        from: 5,
        to: 5,
      });

      unmount();
    });

    it('does NOT prepend space when char before cursor is already a space', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('world');
      // "Hello " with cursor at 6 (after the space)
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: 'world', // no space prepended — char before is already a space
        from: 6,
        to: 6,
      });

      unmount();
    });

    it('does NOT prepend space when cursor is at position 0', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('Hello');
      const editor = makeMockEditor('', 0);
      editor.state.doc.content.size = 0;

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: 'Hello', // no space — at start of document
        from: 0,
        to: 0,
      });

      unmount();
    });

    it('does NOT prepend space when completion starts with a space', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue(' world');
      const editor = makeMockEditor('Hello', 5);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).toHaveBeenCalledWith(editor, {
        text: ' world', // already starts with space — no double space
        from: 5,
        to: 5,
      });

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Stale response handling
  // -------------------------------------------------------------------------

  describe('stale response handling', () => {
    it('discards completion if editor is destroyed', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      // Mark editor as destroyed before the timer fires
      editor.isDestroyed = true;
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).not.toHaveBeenCalled();

      unmount();
    });

    it('discards completion if editor loses focus', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockResolvedValue('completion');
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      editor.isFocused = false;
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).not.toHaveBeenCalled();

      unmount();
    });

    it('discards completion if active tab changed during request', async () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockOllamaFim.mockImplementation(async () => {
        // Simulate tab switch during the async request
        useEditorStore.setState({ activeTabId: 'tab-other' });
        return 'completion';
      });
      const editor = makeMockEditor('Hello ', 6);

      const { unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));
      const updateHandler = editor.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'update',
      )?.[1] as () => void;

      updateHandler();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSetGhostText).not.toHaveBeenCalled();

      unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Clears ghost text when completions disabled
  // -------------------------------------------------------------------------

  describe('clears ghost text when disabled', () => {
    it('clears existing ghost text when inlineCompletionsDisabled becomes true', () => {
      const conn = makeConnection();
      setupRouting(conn, 'codellama');
      mockHasActiveGhostText = true;
      const editor = makeMockEditor('Hello ');

      const { rerender, unmount } = renderHook(() => useLocalCompletion(editor as unknown as import('@tiptap/core').Editor));

      // Now disable completions
      useSettingsStore.setState({ inlineCompletionsDisabled: true });
      rerender();

      expect(mockClearGhostText).toHaveBeenCalledWith(editor);

      unmount();
    });
  });
});
