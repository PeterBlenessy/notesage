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
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore } from '@/stores/chat-store';
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
