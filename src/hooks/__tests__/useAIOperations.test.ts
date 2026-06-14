// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { toast } from 'sonner';
import { renderHook, act } from '@testing-library/react';
import { useAIOperations, ProjectLockViolation } from '@/hooks/useAIOperations';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useAIStore } from '@/stores/ai-store';
import { useChatStore } from '@/stores/chat-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mock sub-hooks that useAIOperations delegates to
// ---------------------------------------------------------------------------

const mockDirectGenerateText = vi.fn(async (prompt: string) => `direct-response: ${prompt}`);
const mockDirectSendChatMessage = vi.fn(async () => {});
const mockCancelDirectChat = vi.fn();

vi.mock('@/hooks/useDirectApiChat', () => ({
  useDirectApiChat: vi.fn(() => ({
    generateText: mockDirectGenerateText,
    sendChatMessage: mockDirectSendChatMessage,
    cancelDirectChat: mockCancelDirectChat,
  })),
}));

const mockAcpGenerateText = vi.fn(async (prompt: string) => `acp-response: ${prompt}`);
const mockAcpSendChatMessage = vi.fn(async () => {});
const mockAcpCancelChat = vi.fn();

vi.mock('@/hooks/useAcpLifecycle', () => ({
  useAcpLifecycle: vi.fn(() => ({
    acpGenerateText: mockAcpGenerateText,
    acpSendChatMessage: mockAcpSendChatMessage,
    acpCancelChat: mockAcpCancelChat,
  })),
}));

vi.mock('@/hooks/useAIContext', () => ({
  useAIContext: vi.fn(() => ({
    composedSystemMessage: 'system prompt',
    localSystemMessage: 'local system prompt',
    acpSystemMessage: 'acp system prompt',
    buildComposedSystemMessage: vi.fn(() => 'composed'),
    buildAcpSystemMessage: vi.fn(() => 'acp composed'),
  })),
}));

vi.mock('@/lib/ai/acp-agent-state', () => ({
  stopAcpAgent: vi.fn(),
  acpAgent: null,
  ensureAcpAgent: vi.fn(),
  isLocalAgentPreset: (conn: { provider?: string; config?: { localAgentPreset?: string } } | null) =>
    conn?.provider === 'custom_acp' && conn?.config?.localAgentPreset === 'goose',
}));

vi.mock('@/lib/ai/acp-utils', () => ({
  truncateDetail: vi.fn((s: string) => s),
  formatAcpToolName: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test Anthropic',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeAgentConnection(overrides: Partial<Connection> = {}): Connection {
  return makeConnection({
    id: 'conn-agent',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    ...overrides,
  });
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
  useAIStore.setState({ provider: null, apiKeys: {}, ollamaUrl: 'http://localhost:11434' });
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useProjectMetadataStore.setState({ metadataMap: {} });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAIOperations', () => {
  beforeEach(() => {
    resetStores();
    mockDirectGenerateText.mockClear();
    mockDirectSendChatMessage.mockClear();
    mockCancelDirectChat.mockClear();
    mockAcpGenerateText.mockClear();
    mockAcpSendChatMessage.mockClear();
    mockAcpCancelChat.mockClear();
  });

  // ---- Provider routing ----

  describe('provider routing', () => {
    it('routes generateText to direct API for api_key connections', async () => {
      const conn = makeConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      let response: string | undefined;
      await act(async () => {
        response = await result.current.generateText('Hello');
      });

      expect(mockDirectGenerateText).toHaveBeenCalledWith('Hello');
      expect(response).toBe('direct-response: Hello');
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });

    it('routes generateText to ACP for agent_managed connections', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      let response: string | undefined;
      await act(async () => {
        response = await result.current.generateText('Hello ACP');
      });

      expect(mockAcpGenerateText).toHaveBeenCalledWith('Hello ACP');
      expect(response).toBe('acp-response: Hello ACP');
      expect(mockDirectGenerateText).not.toHaveBeenCalled();
    });

    it('routes sendChatMessage to direct API for api_key connections', async () => {
      const conn = makeConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('Hi', []);
      });

      expect(mockDirectSendChatMessage).toHaveBeenCalled();
      expect(mockAcpSendChatMessage).not.toHaveBeenCalled();
    });

    it('routes sendChatMessage to ACP for agent_managed connections', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('Hi ACP', []);
      });

      expect(mockAcpSendChatMessage).toHaveBeenCalled();
      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });
  });

  // ---- cancelChat ----

  describe('cancelChat', () => {
    it('cancels direct chat when using api_key connection', () => {
      const conn = makeConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      act(() => {
        result.current.cancelChat();
      });

      expect(mockCancelDirectChat).toHaveBeenCalled();
      expect(mockAcpCancelChat).not.toHaveBeenCalled();
    });

    it('cancels both direct and ACP when using agent_managed connection', () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      act(() => {
        result.current.cancelChat();
      });

      expect(mockCancelDirectChat).toHaveBeenCalled();
      expect(mockAcpCancelChat).toHaveBeenCalled();
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('propagates errors from direct API generateText', async () => {
      const conn = makeConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      mockDirectGenerateText.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.generateText('test');
        }),
      ).rejects.toThrow('API rate limit exceeded');
    });

    it('propagates errors from ACP generateText', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      mockAcpGenerateText.mockRejectedValueOnce(new Error('Agent process crashed'));

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.generateText('test');
        }),
      ).rejects.toThrow('Agent process crashed');
    });
  });

  // ---- Project-scoped provider override ----

  describe('project provider override', () => {
    it('uses project-scoped connection when a single project is selected', async () => {
      const globalConn = makeConnection({ id: 'conn-global', label: 'Global' });
      const projectConn = makeConnection({ id: 'conn-project', label: 'Project-specific' });

      useConnectionsStore.setState({ connections: [globalConn, projectConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: globalConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      useChatStore.setState({
        conversations: [{
          id: 'conv-test',
          title: '',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectPaths: ['/my-project'],
          segments: [{ projectPaths: ['/my-project'], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
          activeSegmentIndex: 0,
          pendingProjectSwitch: null,
          activeLeafId: null,
        }],
        activeConversationId: 'conv-test',
      });
      useProjectMetadataStore.setState({
        metadataMap: {
          '/my-project': {
            version: 1,
            name: 'My Project',
            description: '',
            ai: { provider: 'conn-project', agentName: null, projectContext: '' },
          },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('project scoped');
      });

      // Should still call directGenerateText (both are api_key connections)
      expect(mockDirectGenerateText).toHaveBeenCalledWith('project scoped');
    });
  });

  // ---- No provider configured ----

  describe('no provider configured', () => {
    it('routes to direct API which handles the no-provider case', async () => {
      // No connections, no routing — resolved will be null
      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        // This should call directGenerateText (the fallback path)
        // The direct API hook is responsible for throwing if no provider is set
        await result.current.generateText('no provider');
      });

      expect(mockDirectGenerateText).toHaveBeenCalledWith('no provider');
    });
  });

  // ---- aiLock enforcement (red-team TDD) ----
  //
  // Attack scenario per leak #8 / PRD 1.5: the user has locked Project A to
  // Claude Code (`aiLock.connectionId = 'conn-claude'`). The command bar is
  // somehow set to OpenAI. The user presses Send. PRE-FIX the send routed to
  // OpenAI — the lock was advisory. POST-FIX it's refused with a toast and a
  // ProjectLockViolation is thrown, no downstream provider is called.

  describe('aiLock enforcement', () => {
    function seedLockedProject(lockedConnectionId: string, projectPath = '/locked-project'): void {
      useChatStore.setState({
        conversations: [{
          id: 'conv-lock',
          title: '',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectPaths: [projectPath],
          segments: [{ projectPaths: [projectPath], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
          activeSegmentIndex: 0,
          pendingProjectSwitch: null,
          activeLeafId: null,
        }],
        activeConversationId: 'conv-lock',
      });
      const meta: ProjectMetadata = {
        version: 1,
        name: 'Locked Project',
        description: '',
        ai: { provider: null, agentName: null, projectContext: '' },
        aiLock: { connectionId: lockedConnectionId, lockedAt: Date.now() },
      };
      useProjectMetadataStore.setState({ metadataMap: { [projectPath]: meta } });
    }

    beforeEach(() => {
      vi.mocked(toast.error).mockClear();
    });

    it('blocks new message send to a mismatching provider (direct API path)', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude', label: 'Claude' });
      const wrongConn = makeConnection({ id: 'conn-openai', label: 'OpenAI' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: wrongConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      seedLockedProject(lockedConn.id);

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.sendChatMessage('attack', []);
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);

      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
      expect(mockAcpSendChatMessage).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('blocks resend to a mismatching provider', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude' });
      const wrongConn = makeConnection({ id: 'conn-openai' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: wrongConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      seedLockedProject(lockedConn.id);

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.sendChatMessage('resend attack', [
            { role: 'user', content: 'earlier', timestamp: 1 },
          ]);
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);

      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });

    it('blocks inline action via direct API path', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude' });
      const wrongConn = makeConnection({ id: 'conn-openai' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: wrongConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      seedLockedProject(lockedConn.id);

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.generateText('Improve this selection');
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);

      expect(mockDirectGenerateText).not.toHaveBeenCalled();
    });

    it('blocks inline action via ACP path', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude' });
      const wrongAcp = makeAgentConnection({ id: 'conn-copilot' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongAcp] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: wrongAcp.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      seedLockedProject(lockedConn.id);

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.generateText('Improve via ACP');
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);

      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });

    it('allows send when the current provider matches the lock', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude' });
      useConnectionsStore.setState({ connections: [lockedConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: lockedConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
      seedLockedProject(lockedConn.id);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('ok', []);
      });

      expect(mockDirectSendChatMessage).toHaveBeenCalled();
    });

    it('allows send when no projects are locked (regression lock for unlocked path)', async () => {
      const conn = makeConnection();
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('normal', []);
      });

      expect(mockDirectSendChatMessage).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('blocks when any project in multi-select is locked to a different connection', async () => {
      const lockedConn = makeConnection({ id: 'conn-claude' });
      const wrongConn = makeConnection({ id: 'conn-openai' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongConn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: wrongConn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      useChatStore.setState({
        conversations: [{
          id: 'conv-multi',
          title: '',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectPaths: ['/free-project', '/locked-project'],
          segments: [{ projectPaths: ['/free-project', '/locked-project'], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
          activeSegmentIndex: 0,
          pendingProjectSwitch: null,
          activeLeafId: null,
        }],
        activeConversationId: 'conv-multi',
      });
      useProjectMetadataStore.setState({
        metadataMap: {
          '/free-project': {
            version: 1,
            name: 'Free',
            description: '',
            ai: { provider: null, agentName: null, projectContext: '' },
          },
          '/locked-project': {
            version: 1,
            name: 'Locked',
            description: '',
            ai: { provider: null, agentName: null, projectContext: '' },
            aiLock: { connectionId: lockedConn.id, lockedAt: Date.now() },
          },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await expect(
        act(async () => {
          await result.current.sendChatMessage('multi attack', []);
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);

      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });
  });

  // ---- Ollama (local) connection ----

  describe('local Ollama connection', () => {
    it('routes to direct API for local connections', async () => {
      const conn = makeConnection({
        id: 'conn-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Local Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });
      useConnectionsStore.setState({ connections: [conn] });
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: conn.id },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('local test');
      });

      expect(mockDirectGenerateText).toHaveBeenCalledWith('local test');
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });
  });

  // ---- Local Agent preset routing (no silent fallback — user decision) ----

  describe('Local Agent preset routing', () => {
    function makePresetConnection(overrides: Partial<Connection> = {}): Connection {
      return makeConnection({
        id: 'preset',
        provider: 'custom_acp',
        authMethod: 'agent_managed',
        label: 'Local Agent',
        credentials: { type: 'agent_managed', agentBinary: '/opt/goose' },
        config: { binaryPath: '/opt/goose', localAgentPreset: 'goose' },
        ...overrides,
      });
    }
    const localBundled: Connection = {
      id: 'lb',
      provider: 'local_ai',
      authMethod: 'local_bundled',
      status: 'connected',
      label: 'Local (bundled)',
      credentials: { type: 'local_bundled' },
      capabilities: ['interactive'],
      createdAt: Date.now(),
    };

    function routeTo(connId: string) {
      useRoutingStore.setState({
        routing: {
          interactive: { connectionId: connId },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: null },
        },
      });
    }

    it('routes to the agent (ACP) when the preset is selected', async () => {
      useConnectionsStore.setState({ connections: [makePresetConnection(), localBundled] });
      routeTo('preset');
      const { result } = renderHook(() => useAIOperations());
      await act(async () => {
        await result.current.sendChatMessage('hi', []);
      });
      expect(mockAcpSendChatMessage).toHaveBeenCalled();
      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });

    it('surfaces an agent error to the caller instead of silently falling back to direct local chat', async () => {
      // User decision: a broken Local Agent must NOT silently route to Path 4.
      // The error propagates so the chat message shows the real failure.
      useConnectionsStore.setState({ connections: [makePresetConnection(), localBundled] });
      routeTo('preset');
      mockAcpSendChatMessage.mockRejectedValueOnce(new Error('Local AI server is not running'));
      const { result } = renderHook(() => useAIOperations());
      await act(async () => {
        await expect(result.current.sendChatMessage('hi', [])).rejects.toThrow(/not running/);
      });
      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });
  });
});
