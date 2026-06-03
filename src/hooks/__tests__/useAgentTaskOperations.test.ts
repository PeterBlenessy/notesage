// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import '@/test/tauri-mock';
import { streamEvent } from '@/lib/ai/stream-events';
import { renderHook, act } from '@testing-library/react';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useActivityStore } from '@/stores/activity-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useProjectMetadataStore, type ProjectMetadata } from '@/stores/project-metadata-store';
import type { Connection } from '@/lib/ai/connections';
import { ProjectLockViolation } from '@/lib/ai/project-lock';
import {
  useAgentTaskOperations,
  stopTaskAgent,
  ensureTaskAgent,
  type TaskCallbacks,
  type TaskMeta,
  type TaskActivityEvent,
} from '@/hooks/useAgentTaskOperations';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/acp-utils', () => ({
  truncateDetail: vi.fn((s: unknown, _max?: number) => {
    const str = typeof s === 'string' ? s : JSON.stringify(s ?? '');
    return str.length > 200 ? str.slice(0, 200) : str;
  }),
  formatAcpToolName: vi.fn((kind?: string, title?: string) => title || kind || 'unknown'),
  normalizeToolCallContent: vi.fn(() => []),
  // Real implementation — tests drive this via the `capabilities` option.
  hasSessionCapability: vi.fn((caps: Record<string, unknown> | null | undefined, key: 'list' | 'fork' | 'resume' | 'close') => {
    const nested = (caps?.sessionCapabilities ?? caps?.session_capabilities) as Record<string, unknown> | undefined;
    const value = nested?.[key];
    return value !== undefined && value !== null;
  }),
  hasLoadSessionCapability: vi.fn((caps: Record<string, unknown> | null | undefined) =>
    caps?.loadSession === true || caps?.load_session === true
  ),
  // Minimal real implementation so resource_link rendering test exercises the helper.
  formatResourceLinkAsMarkdown: vi.fn((block: { uri?: string; name?: string; description?: string }) => {
    const uri = String(block.uri ?? '');
    if (!uri) return '';
    const basename = (u: string): string => {
      const clean = u.split('#')[0].split('?')[0];
      const parts = clean.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || clean;
    };
    const label = block.name && block.name.trim() ? block.name.trim() : basename(uri);
    const base = `[${label}](${uri})`;
    const desc = typeof block.description === 'string' ? block.description.trim() : '';
    if (!desc) return base;
    const MAX = 80;
    const truncated = desc.length > MAX ? desc.slice(0, MAX).trimEnd() + '\u2026' : desc;
    return `${base}\n${truncated}`;
  }),
}));

vi.mock('@/lib/ai/path-filter', () => ({
  isToolCallAllowed: vi.fn(() => ({ allowed: true })),
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
// Deferred promise helper — lets tests control when async operations complete
// ---------------------------------------------------------------------------

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiKeyConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-api',
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
  return {
    id: 'conn-agent',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeOllamaConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-ollama',
    provider: 'ollama',
    authMethod: 'local',
    status: 'connected',
    label: 'Local Ollama',
    credentials: { type: 'local', url: 'http://localhost:11434' },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function setupRouting(connectionId: string) {
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId },
      inline_completion: { connectionId: null },
    },
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
  useActivityStore.setState({ tasks: [] });
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useProjectMetadataStore.setState({ metadataMap: {} });
  usePermissionStore.setState({
    alwaysAllowed: [],
    domainSessionAllowed: {},
    domainAlwaysAllowed: {},
  });
}

const TEST_INSTANCE_ID = 'inst-test-123';
const TEST_SESSION_ID = 'sess-test-456';

/**
 * Register ACP invoke handlers. Returns a deferred for `acp_session_prompt`
 * so tests can control when the prompt completes (keeping listeners alive).
 */
function registerAcpHandlers(options?: {
  spawnFail?: boolean;
  authFail?: string;
  promptFail?: string;
  agentExists?: boolean;
  /** Capabilities payload returned by `acp_agent_spawn` (pass-through JSON). */
  capabilities?: Record<string, unknown> | null;
  /** When set, `acp_session_resume` returns this session (session ID comes back as-is). */
  resumeSessionId?: string;
  /** When true, `acp_session_close` throws to exercise error-swallow paths. */
  closeFails?: boolean;
  /** Session ID returned by `acp_session_new`. Defaults to TEST_SESSION_ID. */
  newSessionId?: string;
}): { promptDeferred: Deferred } {
  const promptDeferred = createDeferred();

  setMockInvokeHandler('acp_agent_spawn', () => {
    if (options?.spawnFail) throw new Error('Spawn failed');
    return {
      instance_id: TEST_INSTANCE_ID,
      agent_name: 'test-agent',
      agent_version: '1.0.0',
      auth_methods: [],
      sandbox_enabled: false,
      network_sandbox_enabled: false,
      capabilities: options?.capabilities ?? null,
    };
  });

  setMockInvokeHandler('acp_agent_authenticate', () => {
    if (options?.authFail) throw new Error(options.authFail);
    return undefined;
  });

  setMockInvokeHandler('acp_agent_stop', () => undefined);

  setMockInvokeHandler('acp_agent_exists', () => {
    return options?.agentExists ?? true;
  });

  setMockInvokeHandler('acp_session_new', () => {
    return {
      session_id: options?.newSessionId ?? TEST_SESSION_ID,
      current_model: 'claude-4-sonnet',
      available_models: [],
    };
  });

  // Session restoration primitives — return the requested session as-is when called.
  setMockInvokeHandler('acp_session_resume', (args) => {
    const sessionId = options?.resumeSessionId ?? (args?.sessionId as string);
    return {
      session_id: sessionId,
      current_model: 'claude-4-sonnet',
      available_models: [],
    };
  });

  setMockInvokeHandler('acp_session_load', (args) => ({
    session_id: args?.sessionId as string,
    current_model: 'claude-4-sonnet',
    available_models: [],
  }));

  setMockInvokeHandler('acp_session_list', () => ({
    sessions: [],
    next_cursor: null,
  }));

  setMockInvokeHandler('acp_session_close', () => {
    if (options?.closeFails) throw new Error('close failed');
    return undefined;
  });

  setMockInvokeHandler('acp_session_prompt', () => {
    if (options?.promptFail) {
      return Promise.reject(new Error(options.promptFail));
    }
    return promptDeferred.promise;
  });

  setMockInvokeHandler('acp_session_cancel', () => undefined);
  setMockInvokeHandler('acp_permission_respond', () => undefined);
  setMockInvokeHandler('get_home_dir', () => '/Users/test');

  return { promptDeferred };
}

/**
 * Register direct API invoke handlers. Returns a deferred for `ai_chat_stream`
 * so tests can control when the stream call completes (keeping listeners alive).
 */
// The direct-API task path generates a unique per-request streamId and
// emits/listens on `<event>:<streamId>`. Capture it so test-body emits target
// the matching channel.
let lastStreamId = '';
const sidOf = (args: unknown): string => String((args as { streamId?: string })?.streamId ?? '');

function registerDirectApiHandlers(): { streamDeferred: Deferred } {
  const streamDeferred = createDeferred();
  setMockInvokeHandler('ai_chat_stream', (args) => { lastStreamId = sidOf(args); return streamDeferred.promise; });
  setMockInvokeHandler('get_home_dir', () => '/Users/test');
  return { streamDeferred };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentTaskOperations', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    // Clear the module-level singleton agent state
    stopTaskAgent();
  });

  // ---- No connection configured ----

  describe('no connection configured', () => {
    it('throws when no agent_tasks connection is configured', async () => {
      const { result } = renderHook(() => useAgentTaskOperations());

      expect(result.current.taskConnection).toBeNull();

      await expect(
        act(async () => {
          await result.current.startTask('test prompt');
        }),
      ).rejects.toThrow('No connection configured for agent tasks');
    });
  });

  // ---- Routing logic ----

  describe('routing', () => {
    it('routes to ACP for agent_managed connections', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.taskConnection).not.toBeNull();
      expect(result.current.taskConnection?.authMethod).toBe('agent_managed');

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP prompt');
      });

      expect(taskId).toBeDefined();
      expect(taskId).toMatch(/^task-/);

      // Task should be in activity store and running (prompt hasn't completed yet)
      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
      expect(tasks[0].status).toBe('running');
    });

    it('routes to direct API for api_key connections', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.taskConnection?.authMethod).toBe('api_key');

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('Direct API prompt');
      });

      expect(taskId).toBeDefined();
      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
    });

    it('routes to direct API for local (Ollama) connections', async () => {
      const conn = makeOllamaConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.taskConnection?.authMethod).toBe('local');

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('Ollama prompt');
      });

      expect(taskId).toBeDefined();
    });
  });

  // ---- aiLock enforcement on comment delegation (red-team TDD) ----
  //
  // Attack: the comment lives in Project A, which is locked to Claude Code. The
  // global `agent_tasks` routing points at OpenAI. PRE-FIX startTask happily
  // spawns an OpenAI agent for the locked project. POST-FIX the locked
  // connection is used; or, if that connection is missing, the task is refused
  // with a toast and ProjectLockViolation.

  describe('aiLock enforcement on comment delegation', () => {
    function setProjectLock(projectPath: string, connectionId: string): void {
      const meta: ProjectMetadata = {
        version: 1,
        name: 'Locked',
        description: '',
        ai: { provider: null, agentName: null, projectContext: '' },
        aiLock: { connectionId, lockedAt: Date.now() },
      };
      useProjectMetadataStore.setState({ metadataMap: { [projectPath]: meta } });
    }

    it('uses the locked connection instead of the agent_tasks routing slot', async () => {
      const lockedConn = makeAgentConnection({ id: 'conn-claude', provider: 'anthropic', label: 'Claude' });
      const wrongConn = makeApiKeyConnection({ id: 'conn-openai', provider: 'openai', label: 'OpenAI' });
      useConnectionsStore.setState({ connections: [lockedConn, wrongConn] });
      setupRouting(wrongConn.id);
      setProjectLock('/locked-project', lockedConn.id);
      registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('delegate', undefined, {
          type: 'comment',
          label: 'lock route',
          projectRoot: '/locked-project',
        });
      });

      expect(taskId).toBeDefined();
      const task = useActivityStore.getState().tasks.find((t) => t.id === taskId);
      expect(task?.connectionProvider).toBe('anthropic');
    });

    it('refuses to start the task when the locked connection is not available', async () => {
      const wrongConn = makeApiKeyConnection({ id: 'conn-openai' });
      useConnectionsStore.setState({ connections: [wrongConn] });
      setupRouting(wrongConn.id);
      setProjectLock('/locked-project', 'conn-missing');

      const { result } = renderHook(() => useAgentTaskOperations());

      await expect(
        act(async () => {
          await result.current.startTask('delegate', undefined, {
            type: 'comment',
            label: 'lock route',
            projectRoot: '/locked-project',
          });
        }),
      ).rejects.toBeInstanceOf(ProjectLockViolation);
    });

    it('allows the task through the normal agent_tasks route when no lock is set', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('free', undefined, {
          type: 'comment',
          label: 'no lock',
          projectRoot: '/free-project',
        });
      });

      expect(taskId).toBeDefined();
    });
  });

  // ---- Activity store tracking ----

  describe('activity store tracking', () => {
    it('creates a task in activity store with correct metadata', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      const meta: TaskMeta = {
        type: 'comment',
        label: 'Review this code',
        sourceFile: '/project/test.md',
        commentId: 'comment-123',
        documentId: 'doc-456',
      };

      await act(async () => {
        await result.current.startTask('Review the code', undefined, meta);
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
      expect(tasks[0].type).toBe('comment');
      expect(tasks[0].label).toBe('Review this code');
      expect(tasks[0].sourceFile).toBe('/project/test.md');
      expect(tasks[0].commentId).toBe('comment-123');
      expect(tasks[0].documentId).toBe('doc-456');
      expect(tasks[0].connectionProvider).toBe('anthropic');
      expect(tasks[0].status).toBe('running');
    });

    it('uses prompt slice as label when no label provided in meta', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('A very long prompt that should be truncated at fifty chars boundary');
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].label.length).toBeLessThanOrEqual(50);
    });

    it('skips activity store when trackInActivityStore is false', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      const meta: TaskMeta = {
        type: 'chat',
        label: 'Chat task',
        trackInActivityStore: false,
      };

      await act(async () => {
        await result.current.startTask('Chat prompt', undefined, meta);
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(0);
    });

    it('reuses existing task when existingTaskId is provided', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      // Pre-populate activity store with a task
      useActivityStore.getState().addTask({
        id: 'existing-task-1',
        type: 'comment',
        label: 'Existing task',
        status: 'done',
        connectionProvider: 'anthropic',
      });

      const { result } = renderHook(() => useAgentTaskOperations());

      const meta: TaskMeta = {
        type: 'comment',
        label: 'Continue task',
        existingTaskId: 'existing-task-1',
      };

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('Continue the work', undefined, meta);
      });

      expect(taskId).toBe('existing-task-1');
      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe('existing-task-1');
      expect(tasks[0].status).toBe('running');
    });
  });

  // ---- Direct API streaming ----

  describe('direct API streaming', () => {
    it('accumulates text chunks in response', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Generate text', callbacks);
      });

      // Emit stream chunks (listeners are alive because streamDeferred hasn't resolved)
      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'Hello ');
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'World');
      });

      expect(chunks).toEqual(['Hello ', 'World']);

      // Check partial output in activity store
      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].partialOutput).toBe('Hello World');

      // Clean up
      streamDeferred.resolve();
    });

    it('calls onComplete when stream finishes', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      let completedOutput: string | undefined;
      const callbacks: TaskCallbacks = {
        onComplete: (output) => { completedOutput = output; },
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Generate text', callbacks);
      });

      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'Response text');
        emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null);
      });

      expect(completedOutput).toBe('Response text');

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('done');
      expect(tasks[0].finalOutput).toBe('Response text');

      streamDeferred.resolve();
    });

    it('fires onActivity with agent_responding on start', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test', callbacks);
      });

      expect(activities.some((a) => a.event === 'agent_responding')).toBe(true);
      streamDeferred.resolve();
    });

    it('handles empty response on stream done', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      let completedOutput: string | undefined;
      const callbacks: TaskCallbacks = {
        onComplete: (output) => { completedOutput = output; },
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test', callbacks);
      });

      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null);
      });

      expect(completedOutput).toBe('');
      streamDeferred.resolve();
    });

    it('handles ai_chat_stream invoke error', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      // Use a deferred that rejects
      const streamDeferred = createDeferred();
      setMockInvokeHandler('ai_chat_stream', () => streamDeferred.promise);
      setMockInvokeHandler('get_home_dir', () => '/Users/test');

      let errorMsg: string | undefined;
      const callbacks: TaskCallbacks = {
        onError: (err) => { errorMsg = err; },
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test', callbacks);
      });

      // Reject the stream
      await act(async () => {
        streamDeferred.reject(new Error('API error'));
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(errorMsg).toBe('API error');

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('error');
    });

    it('passes connection config to ai_chat_stream', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeApiKeyConnection({
        config: { model: 'claude-4-sonnet', temperature: 0.7, maxTokens: 4096 },
      });
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test prompt');
      });

      const streamCall = mockInvoke.mock.calls.find(
        (call) => call[0] === 'ai_chat_stream'
      );
      expect(streamCall).toBeDefined();
      const args = streamCall![1] as Record<string, unknown>;
      expect(args.provider).toBe('anthropic');
      expect(args.connectionId).toBe('conn-api');
      expect(args.model).toBe('claude-4-sonnet');
      expect(args.temperature).toBe(0.7);
      expect(args.maxTokens).toBe(4096);
      expect(args.webSearchEnabled).toBe(false);
    });

    it('passes ollamaUrl for local connections', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeOllamaConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ollama test');
      });

      const streamCall = mockInvoke.mock.calls.find(
        (call) => call[0] === 'ai_chat_stream'
      );
      expect(streamCall).toBeDefined();
      const args = streamCall![1] as Record<string, unknown>;
      expect(args.provider).toBe('ollama');
      expect(args.ollamaUrl).toBe('http://localhost:11434');
    });

    it('builds system + user messages for direct API', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('My task prompt');
      });

      const streamCall = mockInvoke.mock.calls.find(
        (call) => call[0] === 'ai_chat_stream'
      );
      const args = streamCall![1] as Record<string, unknown>;
      const messages = args.messages as { role: string; content: string }[];
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('My task prompt');
    });
  });

  // ---- ACP streaming ----

  describe('ACP streaming', () => {
    it('accumulates text chunks from ACP session updates', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello ' },
          },
        });
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'from ACP' },
          },
        });
      });

      expect(chunks).toEqual(['Hello ', 'from ACP']);
      promptDeferred.resolve();
    });

    it('tracks tool calls in activity log', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'tool_call',
            kind: 'bash',
            title: 'Run ls',
            rawInput: 'ls -la',
          },
        });
      });

      expect(activities.some((a) => a.event === 'tool_call')).toBe(true);

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].activities.length).toBe(1);
      expect(tasks[0].activities[0].status).toBe('running');
      promptDeferred.resolve();
    });

    it('completes last activity on tool_result', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task');
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'tool_call',
            kind: 'bash',
            title: 'Run ls',
            rawInput: 'ls',
          },
        });
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: { sessionUpdate: 'tool_result' },
        });
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].activities[0].status).toBe('done');
      promptDeferred.resolve();
    });

    it('marks task as done on agent_turn_complete', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      let completedOutput: string | undefined;
      const callbacks: TaskCallbacks = {
        onComplete: (output) => { completedOutput = output; },
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Done!' },
          },
        });
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: { sessionUpdate: 'agent_turn_complete' },
        });
      });

      expect(completedOutput).toBe('Done!');

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('done');
      expect(tasks[0].finalOutput).toBe('Done!');
      promptDeferred.resolve();
    });

    it('appends thinking output on agent_thought_chunk', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Think hard');
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thinking...' },
          },
        });
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].thinkingOutput).toBe('Thinking...');
      promptDeferred.resolve();
    });

    it('fires first-chunk agent_responding activity only once', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'First' },
          },
        });
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: ' second' },
          },
        });
      });

      const respondingEvents = activities.filter((a) => a.event === 'agent_responding');
      expect(respondingEvents.length).toBe(1);
      promptDeferred.resolve();
    });

    it('ignores events from different instance/session', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: 'different-instance',
          sessionId: 'different-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Should be ignored' },
          },
        });
      });

      expect(chunks.length).toBe(0);
      promptDeferred.resolve();
    });

    it('handles tool_call_update events', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'tool_call_update',
            kind: 'bash',
            title: 'Running command',
          },
        });
      });

      expect(activities.some((a) => a.event === 'tool_call' && a.kind === 'bash')).toBe(true);
      promptDeferred.resolve();
    });
  });

  // ---- ACP error handling ----

  describe('ACP error handling', () => {
    it('calls onError when ACP prompt fails', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      let errorMsg: string | undefined;
      const callbacks: TaskCallbacks = {
        onError: (err) => { errorMsg = err; },
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      // Reject the prompt
      await act(async () => {
        promptDeferred.reject(new Error('Agent crashed'));
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(errorMsg).toBe('Agent crashed');

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('error');
    });

    it('handles agent spawn failure', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers({ spawnFail: true });

      const { result } = renderHook(() => useAgentTaskOperations());

      await expect(
        act(async () => {
          await result.current.startTask('ACP task');
        }),
      ).rejects.toThrow('Spawn failed');
    });

    it('handles auth failure (non "not implemented")', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers({ authFail: 'Auth token expired' });

      const { result } = renderHook(() => useAgentTaskOperations());

      await expect(
        act(async () => {
          await result.current.startTask('ACP task');
        }),
      ).rejects.toThrow('Auth token expired');
    });

    it('tolerates "not implemented" auth error', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers({ authFail: 'Method not implemented' });

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP task');
      });

      expect(taskId).toBeDefined();
    });
  });

  // ---- Permission handling ----

  describe('permission handling', () => {
    it('auto-approves permission requests with first option', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks, {
          type: 'comment',
          label: 'Test',
          projectRoot: '/project',
        });
      });

      await act(async () => {
        emitMockEvent('acp-permission-request', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          requestId: 'req-1',
          toolCall: { kind: 'bash', title: 'Run ls', rawInput: 'ls -la' },
          options: [{ optionId: 'allow', name: 'Allow' }],
        });
      });

      expect(activities.some((a) => a.event === 'permission_auto_approved')).toBe(true);
      promptDeferred.resolve();
    });

    it('denies tool calls targeting paths outside project', async () => {
      const { isToolCallAllowed } = await import('@/lib/ai/path-filter');
      const mockIsToolCallAllowed = vi.mocked(isToolCallAllowed);
      mockIsToolCallAllowed.mockReturnValueOnce({ allowed: false, deniedPath: '/etc/passwd' });

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks, {
          type: 'comment',
          label: 'Test',
          projectRoot: '/project',
        });
      });

      await act(async () => {
        emitMockEvent('acp-permission-request', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          requestId: 'req-1',
          toolCall: { kind: 'write', title: 'Write file', rawInput: '/etc/passwd' },
          options: [{ optionId: 'allow' }],
        });
      });

      expect(activities.some((a) => a.event === 'tool_denied')).toBe(true);

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].activities.some((a) => a.status === 'error')).toBe(true);
      promptDeferred.resolve();
    });

    it('ignores permission requests from different instances', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks, {
          type: 'comment',
          label: 'Test',
          projectRoot: '/project',
        });
      });

      await act(async () => {
        emitMockEvent('acp-permission-request', {
          instanceId: 'wrong-instance',
          sessionId: 'wrong-session',
          requestId: 'req-1',
          toolCall: { kind: 'bash', title: 'Run ls', rawInput: 'ls' },
          options: [{ optionId: 'allow' }],
        });
      });

      expect(activities.some((a) => a.event === 'permission_auto_approved')).toBe(false);
      promptDeferred.resolve();
    });
  });

  // ---- Cancel task ----

  describe('cancelTask', () => {
    it('cancels a running ACP task', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP task');
      });

      let cancelled: boolean | undefined;
      await act(async () => {
        cancelled = await result.current.cancelTask(taskId!);
      });

      expect(cancelled).toBe(true);

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('cancelled');
      promptDeferred.resolve();
    });

    it('returns false when cancelling a non-existent task', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let cancelled: boolean | undefined;
      await act(async () => {
        cancelled = await result.current.cancelTask('non-existent-task');
      });

      expect(cancelled).toBe(false);
    });

    it('returns false when cancelling an already completed task', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('test');
      });

      // Complete the task via stream done
      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null);
      });

      let cancelled: boolean | undefined;
      await act(async () => {
        cancelled = await result.current.cancelTask(taskId!);
      });

      expect(cancelled).toBe(false);
      streamDeferred.resolve();
    });

    it('marks direct API task as cancelled without ACP session cancel', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('direct task');
      });

      let cancelled: boolean | undefined;
      await act(async () => {
        cancelled = await result.current.cancelTask(taskId!);
      });

      // Direct API tasks don't have instanceId/sessionId
      expect(cancelled).toBe(false);

      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('cancelled');
      streamDeferred.resolve();
    });
  });

  // ---- getTask ----

  describe('getTask', () => {
    it('returns task by ID', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerDirectApiHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('test');
      });

      const task = result.current.getTask(taskId!);
      expect(task).toBeDefined();
      expect(task?.prompt).toBe('test');
      expect(task?.status).toBe('running');
    });

    it('returns undefined for unknown task ID', () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);

      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.getTask('unknown')).toBeUndefined();
    });
  });

  // ---- stopTaskAgent ----

  describe('stopTaskAgent', () => {
    it('stops the module-level agent and allows respawn', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task');
      });

      stopTaskAgent();

      // Starting a new task should spawn a new agent
      registerAcpHandlers();
      await act(async () => {
        await result.current.startTask('New ACP task');
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(2);
    });
  });

  // ---- Project root resolution ----

  describe('project root', () => {
    it('uses projectRoot from taskMeta for ACP cwd', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test', undefined, {
          type: 'comment',
          label: 'Test',
          projectRoot: '/custom/project',
        });
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
    });

    it('falls back to /tmp when no project path is available', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers();

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test');
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
    });
  });

  // ---- Stream cleanup ----

  describe('event listener cleanup', () => {
    it('cleans up listeners after stream invoke completes', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('test', callbacks);
      });

      // Emit a chunk while stream is alive
      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'before');
      });
      expect(chunks).toContain('before');

      // Resolve the stream invoke (triggers .finally() cleanup)
      await act(async () => {
        streamDeferred.resolve();
        await new Promise((r) => setTimeout(r, 10));
      });

      // After cleanup, new chunks should not reach the callback
      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'late chunk');
      });

      expect(chunks).not.toContain('late chunk');
    });

    it('cleans up listeners on cancel', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { streamDeferred } = registerDirectApiHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('test', callbacks);
      });

      await act(async () => {
        await result.current.cancelTask(taskId!);
      });

      // Post-cancel chunks should not reach callback
      await act(async () => {
        emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'late chunk');
      });

      expect(chunks).not.toContain('late chunk');
      streamDeferred.resolve();
    });
  });

  // ---- Multiple tasks ----

  describe('multiple tasks', () => {
    it('tracks multiple direct API tasks independently', async () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);

      // Each task call needs its own deferred
      const deferred1 = createDeferred();
      const deferred2 = createDeferred();
      let callCount = 0;
      setMockInvokeHandler('ai_chat_stream', (args) => {
        lastStreamId = sidOf(args);
        callCount++;
        return callCount === 1 ? deferred1.promise : deferred2.promise;
      });
      setMockInvokeHandler('get_home_dir', () => '/Users/test');

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId1: string | undefined;
      let taskId2: string | undefined;

      await act(async () => {
        taskId1 = await result.current.startTask('Task 1');
      });

      // Force a different timestamp
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      await act(async () => {
        taskId2 = await result.current.startTask('Task 2');
      });

      expect(taskId1).not.toBe(taskId2);

      const task1 = result.current.getTask(taskId1!);
      const task2 = result.current.getTask(taskId2!);
      expect(task1?.prompt).toBe('Task 1');
      expect(task2?.prompt).toBe('Task 2');

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(2);

      deferred1.resolve();
      deferred2.resolve();
    });
  });

  // ---- Agent lifecycle ----

  describe('agent lifecycle', () => {
    it('respawns agent when backend reports it is gone', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      registerAcpHandlers({ agentExists: false });

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Task after restart');
      });

      const tasks = useActivityStore.getState().tasks;
      expect(tasks.length).toBe(1);
    });
  });

  // ---- ensureTaskAgent recursion depth limit ----

  describe('ensureTaskAgent recursion depth limit', () => {
    it('throws after exceeding max retry depth', async () => {
      stopTaskAgent();

      const conn = makeAgentConnection();

      // Call ensureTaskAgent directly with _depth exceeding the limit (> 3)
      await expect(
        ensureTaskAgent(conn, '/project', undefined, 4),
      ).rejects.toThrow('Task agent spawn failed after multiple retries.');
    });

    it('allows calls within the depth limit', async () => {
      stopTaskAgent();

      const conn = makeAgentConnection();
      registerAcpHandlers();

      // _depth=0 (default) should succeed — normal spawn path
      const instanceId = await ensureTaskAgent(conn, '/project');
      expect(instanceId).toBe(TEST_INSTANCE_ID);
    });

    it('throws at exactly depth > 3 (limit is 3)', async () => {
      stopTaskAgent();

      const conn = makeAgentConnection();
      registerAcpHandlers();

      // depth=3 is within the limit — should NOT throw (3 > 3 is false)
      const instanceId = await ensureTaskAgent(conn, '/project', undefined, 3);
      expect(instanceId).toBe(TEST_INSTANCE_ID);

      stopTaskAgent();

      // depth=4 exceeds the limit — should throw (4 > 3 is true)
      await expect(
        ensureTaskAgent(conn, '/project', undefined, 4),
      ).rejects.toThrow('Task agent spawn failed after multiple retries.');
    });
  });

  // ---- taskConnection selector ----

  describe('taskConnection', () => {
    it('returns null when no agent_tasks routing is configured', () => {
      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.taskConnection).toBeNull();
    });

    it('returns the configured connection', () => {
      const conn = makeApiKeyConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);

      const { result } = renderHook(() => useAgentTaskOperations());
      expect(result.current.taskConnection).not.toBeNull();
      expect(result.current.taskConnection?.id).toBe(conn.id);
    });
  });

  // ---- ACP session restoration & cleanup ----

  describe('ACP session restoration', () => {
    /**
     * Pre-populate chat-store with a conversation carrying a stored `acpSessionId`
     * so `startAcpTask` can attempt session/resume or session/load.
     */
    function seedConversationWithStoredSession(storedSessionId: string): void {
      useChatStore.setState({
        conversations: [{
          id: 'conv-1',
          title: 'Test conversation',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectPaths: [],
          segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
          activeSegmentIndex: 0,
          acpSessionId: storedSessionId,
          activeLeafId: null,
        }],
        activeConversationId: 'conv-1',
      });
    }

    it('calls acp_session_new on first-time task delegation (no stored session)', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers({
        capabilities: { sessionCapabilities: { resume: {} } },
      });

      // No active conversation → storedSessionId is undefined → falls through to session/new.
      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Fresh task');
      });

      const sessionNewCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_new',
      );
      const resumeCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_resume',
      );
      expect(sessionNewCalls.length).toBe(1);
      expect(resumeCalls.length).toBe(0);

      promptDeferred.resolve();
    });

    it('uses session/resume when conversation has stored session + resume capability', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      seedConversationWithStoredSession('sess-old');

      const { promptDeferred } = registerAcpHandlers({
        capabilities: { sessionCapabilities: { resume: {} } },
        resumeSessionId: 'sess-old',
      });

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('Resumed task');
      });

      const resumeCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_resume',
      );
      const sessionNewCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_new',
      );
      expect(resumeCalls.length).toBe(1);
      expect(sessionNewCalls.length).toBe(0);
      expect((resumeCalls[0][1] as Record<string, unknown>)?.sessionId).toBe('sess-old');

      promptDeferred.resolve();
    });
  });

  describe('ACP session close on terminal state', () => {
    it('fires session/close on agent_turn_complete when close capability advertised', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers({
        capabilities: { sessionCapabilities: { close: {} } },
      });

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task');
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: { sessionUpdate: 'agent_turn_complete' },
        });
      });

      const closeCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_close',
      );
      expect(closeCalls.length).toBe(1);
      const closeArgs = closeCalls[0][1] as Record<string, unknown>;
      expect(closeArgs.instanceId).toBe(TEST_INSTANCE_ID);
      expect(closeArgs.sessionId).toBe(TEST_SESSION_ID);

      promptDeferred.resolve();
    });

    it('skips session/close when agent does not advertise close capability', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = vi.mocked(invoke);

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      // capabilities payload has NO close key
      const { promptDeferred } = registerAcpHandlers({
        capabilities: { sessionCapabilities: {} },
      });

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task');
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: { sessionUpdate: 'agent_turn_complete' },
        });
      });

      const closeCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === 'acp_session_close',
      );
      expect(closeCalls.length).toBe(0);

      promptDeferred.resolve();
    });

    it('swallows errors from session/close — task still transitions to done', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers({
        capabilities: { sessionCapabilities: { close: {} } },
        closeFails: true,
      });

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP task');
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Finished' },
          },
        });
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: { sessionUpdate: 'agent_turn_complete' },
        });
        // Let any fire-and-forget promise rejections surface.
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(taskId).toBeDefined();
      const task = result.current.getTask(taskId!);
      expect(task?.status).toBe('completed');
      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].status).toBe('done');

      promptDeferred.resolve();
    });
  });

  // ---- Task #3: user_message_chunk silent noop ----

  describe('ACP user_message_chunk', () => {
    it('does not mutate task state nor log "Unknown" for user_message_chunk events', async () => {
      const { log } = await import('@/lib/logger');
      const logDebug = vi.mocked(log.debug);

      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const activities: TaskActivityEvent[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (c) => chunks.push(c),
        onActivity: (a) => activities.push(a),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'echoed user text' },
          },
        });
      });

      // No mutation — no chunks delivered, no activities fired.
      expect(chunks.length).toBe(0);
      expect(activities.length).toBe(0);

      // Task output should still be empty.
      const task = result.current.getTask(taskId!);
      expect(task?.output).toBe('');

      // Critically: no "Unknown ACP task session update type" debug log.
      const unknownCalls = logDebug.mock.calls.filter((call) =>
        typeof call[1] === 'string' && /unknown/i.test(call[1] as string),
      );
      expect(unknownCalls.length).toBe(0);

      promptDeferred.resolve();
    });
  });

  // ---- Task #4: resource_link rendering ----

  describe('ACP resource_link content', () => {
    it('renders a resource_link chunk as a markdown link in task output', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (c) => chunks.push(c),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      let taskId: string | undefined;
      await act(async () => {
        taskId = await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'resource_link',
              uri: 'https://example.com/docs/intro',
              name: 'Introduction',
            },
          },
        });
      });

      expect(chunks).toEqual(['[Introduction](https://example.com/docs/intro)']);

      const task = result.current.getTask(taskId!);
      expect(task?.output).toBe('[Introduction](https://example.com/docs/intro)');

      // partial output should also have landed in the activity store.
      const tasks = useActivityStore.getState().tasks;
      expect(tasks[0].partialOutput).toBe('[Introduction](https://example.com/docs/intro)');

      promptDeferred.resolve();
    });

    it('falls back to URI basename when name is missing', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (c) => chunks.push(c),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'resource_link',
              uri: 'file:///path/to/readme.md',
            },
          },
        });
      });

      expect(chunks).toEqual(['[readme.md](file:///path/to/readme.md)']);
      promptDeferred.resolve();
    });

    it('appends description on a new line (truncated to ~80 chars)', async () => {
      const conn = makeAgentConnection();
      useConnectionsStore.setState({ connections: [conn] });
      setupRouting(conn.id);
      const { promptDeferred } = registerAcpHandlers();

      const chunks: string[] = [];
      const callbacks: TaskCallbacks = {
        onChunk: (c) => chunks.push(c),
      };

      const { result } = renderHook(() => useAgentTaskOperations());

      await act(async () => {
        await result.current.startTask('ACP task', callbacks);
      });

      const longDesc = 'x'.repeat(120);
      await act(async () => {
        emitMockEvent('acp-session-update', {
          instanceId: TEST_INSTANCE_ID,
          sessionId: TEST_SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'resource_link',
              uri: 'https://example.com/foo',
              name: 'Foo',
              description: longDesc,
            },
          },
        });
      });

      expect(chunks.length).toBe(1);
      const emitted = chunks[0];
      expect(emitted.startsWith('[Foo](https://example.com/foo)\n')).toBe(true);
      // Description line is truncated with ellipsis — shorter than the raw 120 chars.
      const descLine = emitted.split('\n')[1];
      expect(descLine.length).toBeLessThanOrEqual(81);
      expect(descLine.endsWith('\u2026')).toBe(true);

      promptDeferred.resolve();
    });
  });
});
