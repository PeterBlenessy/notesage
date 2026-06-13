// @vitest-environment jsdom

/**
 * Unit tests for Copilot LSP routing in useAIOperations.
 *
 * Verifies that the routing discriminant in generateText and sendChatMessage
 * correctly dispatches to the Copilot LSP path, ACP path, or direct API path
 * based on the connection's credentials and authMethod.
 */

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

const mockCopilotGenerateText = vi.fn(async (prompt: string) => `copilot-response: ${prompt}`);
const mockCopilotSendChatMessage = vi.fn(async () => {});
const mockCancelCopilotChat = vi.fn();

vi.mock('@/hooks/useCopilotChat', () => ({
  useCopilotChat: vi.fn(() => ({
    copilotGenerateText: mockCopilotGenerateText,
    copilotSendChatMessage: mockCopilotSendChatMessage,
    cancelCopilotChat: mockCancelCopilotChat,
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

function makeCopilotLspConnection(overrides: Partial<Connection> = {}): Connection {
  return makeConnection({
    id: 'conn-copilot-lsp',
    provider: 'github',
    authMethod: 'agent_managed',
    label: 'Copilot LSP',
    credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
    capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    ...overrides,
  });
}

function makeAcpConnection(overrides: Partial<Connection> = {}): Connection {
  return makeConnection({
    id: 'conn-acp',
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

function setupRouting(conn: Connection) {
  useConnectionsStore.setState({ connections: [conn] });
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: conn.id },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAIOperations — Copilot LSP routing', () => {
  beforeEach(() => {
    resetStores();
    mockDirectGenerateText.mockClear();
    mockDirectSendChatMessage.mockClear();
    mockCancelDirectChat.mockClear();
    mockAcpGenerateText.mockClear();
    mockAcpSendChatMessage.mockClear();
    mockAcpCancelChat.mockClear();
    mockCopilotGenerateText.mockClear();
    mockCopilotSendChatMessage.mockClear();
    mockCancelCopilotChat.mockClear();
  });

  // ---- generateText routing ----

  describe('generateText routing', () => {
    it('routes to Copilot LSP for copilot-language-server connections', async () => {
      const conn = makeCopilotLspConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      let response: string | undefined;
      await act(async () => {
        response = await result.current.generateText('Hello Copilot');
      });

      expect(mockCopilotGenerateText).toHaveBeenCalledWith('Hello Copilot');
      expect(response).toBe('copilot-response: Hello Copilot');
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
      expect(mockDirectGenerateText).not.toHaveBeenCalled();
    });

    it('routes to ACP for non-Copilot agent_managed connections', async () => {
      const conn = makeAcpConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      let response: string | undefined;
      await act(async () => {
        response = await result.current.generateText('Hello ACP');
      });

      expect(mockAcpGenerateText).toHaveBeenCalledWith('Hello ACP');
      expect(response).toBe('acp-response: Hello ACP');
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
      expect(mockDirectGenerateText).not.toHaveBeenCalled();
    });

    it('routes to direct API for api_key connections', async () => {
      const conn = makeConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      let response: string | undefined;
      await act(async () => {
        response = await result.current.generateText('Hello Direct');
      });

      expect(mockDirectGenerateText).toHaveBeenCalledWith('Hello Direct');
      expect(response).toBe('direct-response: Hello Direct');
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });

    it('routes to direct API when no connection is configured', async () => {
      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('no provider');
      });

      expect(mockDirectGenerateText).toHaveBeenCalledWith('no provider');
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });
  });

  // ---- sendChatMessage routing ----

  describe('sendChatMessage routing', () => {
    it('routes to Copilot LSP for copilot-language-server connections', async () => {
      const conn = makeCopilotLspConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('Chat via Copilot', []);
      });

      expect(mockCopilotSendChatMessage).toHaveBeenCalled();
      expect(mockAcpSendChatMessage).not.toHaveBeenCalled();
      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });

    it('routes to ACP for non-Copilot agent_managed connections', async () => {
      const conn = makeAcpConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('Chat via ACP', []);
      });

      expect(mockAcpSendChatMessage).toHaveBeenCalled();
      expect(mockCopilotSendChatMessage).not.toHaveBeenCalled();
      expect(mockDirectSendChatMessage).not.toHaveBeenCalled();
    });

    it('routes to direct API for api_key connections', async () => {
      const conn = makeConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.sendChatMessage('Chat via Direct', []);
      });

      expect(mockDirectSendChatMessage).toHaveBeenCalled();
      expect(mockCopilotSendChatMessage).not.toHaveBeenCalled();
      expect(mockAcpSendChatMessage).not.toHaveBeenCalled();
    });
  });

  // ---- cancelChat routing ----

  describe('cancelChat routing', () => {
    it('cancels Copilot and direct for Copilot LSP connections', () => {
      const conn = makeCopilotLspConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      act(() => {
        result.current.cancelChat();
      });

      expect(mockCancelDirectChat).toHaveBeenCalled();
      expect(mockCancelCopilotChat).toHaveBeenCalled();
      // Copilot LSP is agent_managed but has no ACP session — skip acpCancelChat
      expect(mockAcpCancelChat).not.toHaveBeenCalled();
    });

    it('cancels ACP and direct for ACP connections', () => {
      const conn = makeAcpConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      act(() => {
        result.current.cancelChat();
      });

      expect(mockCancelDirectChat).toHaveBeenCalled();
      expect(mockCancelCopilotChat).toHaveBeenCalled();
      expect(mockAcpCancelChat).toHaveBeenCalled();
    });

    it('cancels only direct and copilot for api_key connections', () => {
      const conn = makeConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      act(() => {
        result.current.cancelChat();
      });

      expect(mockCancelDirectChat).toHaveBeenCalled();
      expect(mockCancelCopilotChat).toHaveBeenCalled();
      expect(mockAcpCancelChat).not.toHaveBeenCalled();
    });
  });

  // ---- Copilot LSP routing discriminant ----

  describe('routing discriminant logic', () => {
    it('Copilot LSP takes priority over generic agent_managed check', async () => {
      // A connection that is agent_managed AND has copilot-language-server binary
      // should route to copilot-lsp, not ACP
      const conn = makeCopilotLspConnection();
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('priority check');
      });

      // Copilot wins over ACP because the binary check comes first
      expect(mockCopilotGenerateText).toHaveBeenCalled();
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });

    it('Codex ACP connection routes to ACP, not Copilot LSP', async () => {
      const conn = makeConnection({
        id: 'conn-codex',
        provider: 'openai',
        authMethod: 'agent_managed',
        label: 'Codex',
        credentials: { type: 'agent_managed', agentBinary: 'codex-acp' },
      });
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('codex test');
      });

      expect(mockAcpGenerateText).toHaveBeenCalled();
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
    });

    it('Copilot ACP connection (not LSP) routes to ACP', async () => {
      const conn = makeConnection({
        id: 'conn-copilot-acp',
        provider: 'github',
        authMethod: 'agent_managed',
        label: 'Copilot CLI',
        credentials: { type: 'agent_managed', agentBinary: 'copilot' },
      });
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('copilot acp test');
      });

      expect(mockAcpGenerateText).toHaveBeenCalled();
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
    });

    it('local Ollama connection routes to direct API', async () => {
      const conn = makeConnection({
        id: 'conn-ollama',
        provider: 'ollama',
        authMethod: 'local',
        label: 'Local Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });
      setupRouting(conn);

      const { result } = renderHook(() => useAIOperations());

      await act(async () => {
        await result.current.generateText('ollama test');
      });

      expect(mockDirectGenerateText).toHaveBeenCalled();
      expect(mockCopilotGenerateText).not.toHaveBeenCalled();
      expect(mockAcpGenerateText).not.toHaveBeenCalled();
    });
  });
});
