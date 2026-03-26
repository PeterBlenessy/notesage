// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useAIOperations } from '@/hooks/useAIOperations';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useAIStore } from '@/stores/ai-store';
import { useChatStore } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
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
  useChatStore.setState({ selectedProjectPaths: [], messages: [] });
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
      useChatStore.setState({ selectedProjectPaths: ['/my-project'] });
      useProjectMetadataStore.setState({
        metadataMap: {
          '/my-project': {
            name: 'My Project',
            ai: { provider: 'conn-project' },
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
});
