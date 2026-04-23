// @vitest-environment jsdom

/**
 * Unit tests for `useCopilotChat`.
 *
 * Focused on Track 1 Critical leak #15 (project data isolation):
 *   The Copilot LSP `workingDir` must reflect the chat footer's project
 *   selection (`selectedProjectPaths[0]`), NOT the first workspace folder
 *   (`projects[0].path`). The leak lets an agent scoped to Project B on
 *   the footer silently boot against Project A's workspace folder.
 *
 * These tests were authored alongside the fix (red-team TDD).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore } from '@/stores/chat-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { tauriApi } from '@/lib/tauri';
import type { Connection } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';

// ---------------------------------------------------------------------------
// Logger mock (prevents noise)
// ---------------------------------------------------------------------------
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

function makeCopilotLspConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-copilot-lsp',
    provider: 'github',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Copilot LSP',
    credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
    capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function seedConversation(projectPaths: string[]) {
  const convId = 'conv-copilot-chat-isolation';
  const now = Date.now();
  const conv: Conversation = {
    id: convId,
    title: 'Isolation Test',
    messages: [],
    createdAt: now,
    updatedAt: now,
    projectPaths,
    segments: [{ projectPaths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
  };
  useChatStore.setState({
    conversations: [conv],
    activeConversationId: convId,
  });
  return convId;
}

function resetStores() {
  useWorkspaceStore.setState({ explorerFolders: [], projects: [] });
  useChatStore.setState({ conversations: [], activeConversationId: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCopilotChat — Track 1 leak #15 workingDir isolation', () => {
  let copilotLspStartSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStores();
    // Spy on the tauriApi layer so we can assert the exact argument
    // shape regardless of the invoke transport.
    copilotLspStartSpy = vi.spyOn(tauriApi, 'copilotLspStart').mockResolvedValue(undefined);
    // Default handlers for any other tauri calls.
    setMockInvokeHandler('copilot_lsp_start', () => undefined);
    setMockInvokeHandler('copilot_lsp_stop', () => undefined);
    setMockInvokeHandler('copilot_lsp_conversation_destroy', () => undefined);
  });

  it('starts LSP with selectedProjectPaths[0], NOT projects[0].path', async () => {
    const conn = makeCopilotLspConnection();

    // Workspace has two projects, footer is scoped to the SECOND one.
    useWorkspaceStore.setState({
      projects: [
        { path: '/workspace/project-A', fileTree: [] },
        { path: '/workspace/project-B', fileTree: [] },
      ],
    });
    seedConversation(['/workspace/project-B']);

    renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // INVARIANT: the LSP must come up against the user-selected project,
    // not the first workspace folder.
    expect(copilotLspStartSpy).toHaveBeenCalledWith('/workspace/project-B');
    expect(copilotLspStartSpy).not.toHaveBeenCalledWith('/workspace/project-A');
  });

  it('falls back to projects[0] when no conversation is active', async () => {
    const conn = makeCopilotLspConnection();
    useWorkspaceStore.setState({
      projects: [{ path: '/workspace/project-A', fileTree: [] }],
    });
    // No conversation seeded — selectedProjectPaths is empty.

    renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(copilotLspStartSpy).toHaveBeenCalledWith('/workspace/project-A');
  });

  it('re-invokes copilotLspStart with the new selection when footer selection changes', async () => {
    const conn = makeCopilotLspConnection();
    useWorkspaceStore.setState({
      projects: [
        { path: '/workspace/project-A', fileTree: [] },
        { path: '/workspace/project-B', fileTree: [] },
      ],
    });
    seedConversation(['/workspace/project-A']);

    const { rerender } = renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Initial start: against A.
    expect(copilotLspStartSpy).toHaveBeenCalledWith('/workspace/project-A');

    copilotLspStartSpy.mockClear();

    // Switch the chat footer to Project B.
    act(() => {
      useChatStore.setState((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === 'conv-copilot-chat-isolation'
            ? { ...c, projectPaths: ['/workspace/project-B'] }
            : c,
        ),
      }));
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    // The backend turns a `copilot_lsp_start` call into a
    // `workspace/didChangeWorkspaceFolders` notification when the LSP is
    // already running, so re-invoking with the new path is the expected
    // contract at this layer.
    expect(copilotLspStartSpy).toHaveBeenCalledWith('/workspace/project-B');
  });
});

// ---------------------------------------------------------------------------
// Track 1 Critical leak — Task #16
//
// Regression lock: the LSP's `copilot/context-request` event asks the client
// for the "currently editing" document. If the active tab lies outside the
// chat footer's project scope, returning its content leaks data from an
// unrelated project to GitHub. The handler must return an empty context
// (null) in that case.
//
// The companion positive test confirms that in-scope tabs still flow through.
// Both were authored alongside the fix (red-team TDD).
// ---------------------------------------------------------------------------

describe('useCopilotChat — Track 1 leak #16 context-request scope gate', () => {
  let contextResponseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useWorkspaceStore.setState({ explorerFolders: [], projects: [] });
    useChatStore.setState({ conversations: [], activeConversationId: null });
    useEditorStore.setState({
      openDocuments: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      persistedTabs: [],
      persistedActiveFilePath: null,
    });
    useSettingsStore.setState({ homeDir: '/Users/tester', notesRootPath: '/Users/tester/Notesage' });

    setMockInvokeHandler('copilot_lsp_start', () => undefined);
    setMockInvokeHandler('copilot_lsp_stop', () => undefined);
    setMockInvokeHandler('copilot_lsp_conversation_destroy', () => undefined);
    setMockInvokeHandler('copilot_lsp_conversation_create', () => ({ conversationId: 'conv-1' }));
    setMockInvokeHandler('copilot_lsp_conversation_turn', () => undefined);
    setMockInvokeHandler('copilot_lsp_did_open', () => undefined);

    vi.spyOn(tauriApi, 'copilotLspStart').mockResolvedValue(undefined);
    vi.spyOn(tauriApi, 'copilotLspConversationCreate').mockResolvedValue({ conversationId: 'conv-1', turnId: 'turn-1' });
    vi.spyOn(tauriApi, 'copilotLspConversationDestroy').mockResolvedValue(undefined);
    vi.spyOn(tauriApi, 'copilotLspDidOpen').mockResolvedValue(undefined);
    contextResponseSpy = vi
      .spyOn(tauriApi, 'copilotLspContextResponse')
      .mockResolvedValue(undefined);
  });

  function makeCopilotLspConnectionLocal(): Connection {
    return {
      id: 'conn-copilot-lsp',
      provider: 'github',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Copilot LSP',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
      createdAt: Date.now(),
    };
  }

  function seedConv(projectPaths: string[]) {
    const now = Date.now();
    const conv: Conversation = {
      id: 'conv-ctx',
      title: 'Ctx',
      messages: [],
      createdAt: now,
      updatedAt: now,
      projectPaths,
      segments: [{ projectPaths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
      activeSegmentIndex: 0,
      pendingProjectSwitch: null,
      activeLeafId: null,
    };
    useChatStore.setState({ conversations: [conv], activeConversationId: 'conv-ctx' });
  }

  function setActiveTab(filePath: string, content: string) {
    const tab = {
      id: 'tab-1',
      filePath,
      fileName: filePath.split('/').pop() ?? filePath,
      isDirty: false,
      content,
      frontmatter: null,
      fileType: 'markdown' as const,
      contentLoaded: true,
    };
    useEditorStore.setState({ openDocuments: [tab], activeTabId: 'tab-1' });
  }

  it('returns NULL context when the active tab is outside the project scope', async () => {
    const conn = makeCopilotLspConnectionLocal();
    useWorkspaceStore.setState({
      projects: [
        { path: '/workspace/project-A', fileTree: [] },
        { path: '/workspace/project-B', fileTree: [] },
      ],
    });
    seedConv(['/workspace/project-A']);
    // Leak candidate: user has secrets.md from project-B open while the
    // chat is scoped to project-A.
    setActiveTab('/workspace/project-B/secrets.md', 'TOP SECRET INSIDE');

    const { result } = renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      // Fire the send so the hook registers its event listeners.
      await result.current.copilotSendChatMessage('hello', [], {}).catch(() => {});
    });

    await act(async () => {
      emitMockEvent('copilot-context-request', { requestId: 'req-1', conversationId: 'conv-1' });
      await Promise.resolve();
    });

    // INVARIANT: the out-of-scope tab must NOT be surfaced to the LSP.
    expect(contextResponseSpy).toHaveBeenCalledWith('req-1', null);
    // Belt-and-suspenders: assert we never called it with the secret file.
    for (const call of contextResponseSpy.mock.calls) {
      const payload = call[1] as { uri?: string; content?: string } | null;
      if (payload) {
        expect(payload.uri).not.toContain('project-B');
        expect(payload.content).not.toContain('TOP SECRET');
      }
    }
  });

  it('returns FULL context when the active tab is inside the project scope (positive)', async () => {
    const conn = makeCopilotLspConnectionLocal();
    useWorkspaceStore.setState({
      projects: [{ path: '/workspace/project-A', fileTree: [] }],
    });
    seedConv(['/workspace/project-A']);
    setActiveTab('/workspace/project-A/file.md', 'in-scope body');

    const { result } = renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await result.current.copilotSendChatMessage('hello', [], {}).catch(() => {});
    });

    await act(async () => {
      emitMockEvent('copilot-context-request', { requestId: 'req-2', conversationId: 'conv-1' });
      await Promise.resolve();
    });

    expect(contextResponseSpy).toHaveBeenCalledWith(
      'req-2',
      expect.objectContaining({
        uri: 'file:///workspace/project-A/file.md',
        content: 'in-scope body',
      }),
    );
  });

  it('allows tabs under the notes root even when no project is selected', async () => {
    const conn = makeCopilotLspConnectionLocal();
    useWorkspaceStore.setState({ projects: [] });
    // No conversation seeded — selectedProjectPaths is empty.
    setActiveTab('/Users/tester/Notesage/journal.md', 'my private notes');

    const { result } = renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await result.current.copilotSendChatMessage('hello', [], {}).catch(() => {});
    });

    await act(async () => {
      emitMockEvent('copilot-context-request', { requestId: 'req-3', conversationId: 'conv-1' });
      await Promise.resolve();
    });

    expect(contextResponseSpy).toHaveBeenCalledWith(
      'req-3',
      expect.objectContaining({
        uri: 'file:///Users/tester/Notesage/journal.md',
      }),
    );
  });

  it('skips the eager didOpen push for an out-of-scope active tab', async () => {
    const conn = makeCopilotLspConnectionLocal();
    useWorkspaceStore.setState({
      projects: [
        { path: '/workspace/project-A', fileTree: [] },
        { path: '/workspace/project-B', fileTree: [] },
      ],
    });
    seedConv(['/workspace/project-A']);
    setActiveTab('/workspace/project-B/secrets.md', 'TOP SECRET INSIDE');

    const didOpenSpy = vi.spyOn(tauriApi, 'copilotLspDidOpen').mockResolvedValue(undefined);
    const createSpy = vi
      .spyOn(tauriApi, 'copilotLspConversationCreate')
      .mockResolvedValue({ conversationId: 'conv-1', turnId: 'turn-1' });

    const { result } = renderHook(() =>
      useCopilotChat({
        effectiveConnection: conn,
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );

    await act(async () => {
      await result.current.copilotSendChatMessage('hello', [], {}).catch(() => {});
    });

    // INVARIANT: no didOpen for the out-of-scope tab.
    for (const call of didOpenSpy.mock.calls) {
      expect(call[0]).not.toBe('/workspace/project-B/secrets.md');
    }
    // AND the conversationCreate must not embed the out-of-scope file's
    // uri/lang as doc context either (positional args 3 and 4).
    for (const call of createSpy.mock.calls) {
      const [, , , docUri] = call as unknown as [unknown, unknown, unknown, string | undefined, unknown];
      if (docUri !== undefined) {
        expect(docUri).not.toContain('project-B');
      }
    }
  });
});
