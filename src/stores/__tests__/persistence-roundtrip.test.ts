/**
 * Persistence round-trip tests for the 3 most critical Zustand stores.
 *
 * Verifies that persist middleware correctly saves to and restores from
 * storage, and that excluded/transient fields are NOT persisted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
// Sets up an in-memory localStorage polyfill since Node.js v22+ has a native
// localStorage without standard methods (setItem, getItem, clear, etc.).
// ---------------------------------------------------------------------------

const { localStorageMock, storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, value); },
    removeItem: (key: string) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });

  // Zustand persist default storage uses `window.localStorage` (not globalThis).
  // In Node.js there is no `window`, so we must define it.
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }

  return { localStorageMock, storageBacking };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return {
    createTauriStorage: () => createJSONStorage(() => localStorageMock),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { useEditorStore } from '../editor-store';
import { useConnectionsStore } from '../connections-store';
import { useChatStore } from '../chat-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for Zustand persist to flush writes to storage. */
async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * Simulate an app restart: snapshot localStorage, reset in-memory store
 * (which also overwrites localStorage), restore the snapshot, then rehydrate.
 */
async function simulateRestart(
  store: {
    setState: (state: Record<string, unknown>) => void;
    persist: { rehydrate: () => void | Promise<void> };
  },
  storageKey: string,
  defaults: Record<string, unknown>,
): Promise<void> {
  const snapshot = localStorageMock.getItem(storageKey);
  // Reset data fields (merge mode, preserves action functions)
  store.setState(defaults);
  await waitForPersist();
  // Restore the persisted snapshot
  if (snapshot) localStorageMock.setItem(storageKey, snapshot);
  // Rehydrate from storage
  await store.persist.rehydrate();
  await waitForPersist();
}

const EDITOR_DEFAULTS = {
  openDocuments: [], activeTabId: null, recentFiles: [], scrollPositions: {},
  externalChanges: {}, persistedTabs: [], persistedActiveFilePath: null,
};
const CONNECTIONS_DEFAULTS = { connections: [] };
const CHAT_DEFAULTS = {
  conversations: [], activeConversationId: null,
  isLoading: false, error: null, activeTool: null, webSearchEnabled: false,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useEditorStore.setState(EDITOR_DEFAULTS);
  useConnectionsStore.setState(CONNECTIONS_DEFAULTS);
  useChatStore.setState(CHAT_DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// editor-store
// ===========================================================================

describe('editor-store persistence round-trip', () => {
  it('persists and restores persistedTabs and persistedActiveFilePath', async () => {
    useEditorStore.setState({
      persistedTabs: [
        { filePath: '/docs/readme.md', fileName: 'readme.md' },
        { filePath: '/docs/notes.md', fileName: 'notes.md' },
      ],
      persistedActiveFilePath: '/docs/notes.md',
    });
    await waitForPersist();

    // Verify localStorage has the data
    const raw = localStorageMock.getItem('notesage-editor');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.persistedTabs).toHaveLength(2);
    expect(parsed.state.persistedActiveFilePath).toBe('/docs/notes.md');

    // Simulate restart and verify restoration
    await simulateRestart(useEditorStore, 'notesage-editor', EDITOR_DEFAULTS);

    const state = useEditorStore.getState();
    expect(state.persistedTabs).toEqual([
      { filePath: '/docs/readme.md', fileName: 'readme.md' },
      { filePath: '/docs/notes.md', fileName: 'notes.md' },
    ]);
    expect(state.persistedActiveFilePath).toBe('/docs/notes.md');
  });

  it('persists and restores recentFiles', async () => {
    useEditorStore.setState({
      recentFiles: [
        { path: '/a.md', name: 'a.md' },
        { path: '/b.md', name: 'b.md' },
      ],
    });
    await waitForPersist();

    await simulateRestart(useEditorStore, 'notesage-editor', EDITOR_DEFAULTS);

    expect(useEditorStore.getState().recentFiles).toEqual([
      { path: '/a.md', name: 'a.md' },
      { path: '/b.md', name: 'b.md' },
    ]);
  });

  it('persists and restores scrollPositions', async () => {
    useEditorStore.setState({
      scrollPositions: { '/doc1.md': 0.5, '/doc2.md': 0.75 },
    });
    await waitForPersist();

    await simulateRestart(useEditorStore, 'notesage-editor', EDITOR_DEFAULTS);

    expect(useEditorStore.getState().scrollPositions).toEqual({
      '/doc1.md': 0.5,
      '/doc2.md': 0.75,
    });
  });

  it('does NOT persist openDocuments array (full tab objects are ephemeral)', async () => {
    useEditorStore.setState({
      openDocuments: [{
        id: 'tab-1',
        filePath: '/test.md',
        fileName: 'test.md',
        isDirty: true,
        content: '# Hello',
        frontmatter: null,
        fileType: 'markdown',
      }],
      activeTabId: 'tab-1',
    });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.openDocuments).toBeUndefined();
    // Legacy key should also be absent — the field was renamed in v1.
    expect(parsed.state.tabs).toBeUndefined();
    expect(parsed.state.activeTabId).toBeUndefined();
  });

  it('does NOT persist externalChanges (ephemeral runtime state)', async () => {
    useEditorStore.setState({
      externalChanges: { '/test.md': 'new content from disk' },
    });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.externalChanges).toBeUndefined();
  });
});

// ===========================================================================
// connections-store
// ===========================================================================

describe('connections-store persistence round-trip', () => {
  it('persists and restores connections', async () => {
    const testConnection: Connection = {
      id: 'conn-test-1',
      provider: 'ollama',
      authMethod: 'local',
      status: 'connected',
      label: 'Ollama Local',
      credentials: { type: 'local', url: 'http://localhost:11434' },
      capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
      createdAt: 1700000000000,
    };

    useConnectionsStore.setState({ connections: [testConnection] });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-connections');
    expect(raw).toBeTruthy();

    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);

    const state = useConnectionsStore.getState();
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].id).toBe('conn-test-1');
    expect(state.connections[0].provider).toBe('ollama');
    expect(state.connections[0].label).toBe('Ollama Local');
    expect(state.connections[0].capabilities).toEqual(['interactive', 'agent_tasks', 'inline_completion']);
  });

  it('stores API key connections with credentialStored flag (key stripped)', async () => {
    const { invoke } = await import('@tauri-apps/api/core');

    const id = useConnectionsStore.getState().addConnection({
      provider: 'anthropic',
      authMethod: 'api_key',
      status: 'connected',
      label: 'Anthropic API',
      credentials: { type: 'api_key', key: 'sk-secret-key-12345' },
    });
    await waitForPersist();

    // Verify the key was sent to keychain
    expect(invoke).toHaveBeenCalledWith('store_credential', {
      service: `notesage:${id}`,
      key: 'sk-secret-key-12345',
    });

    // Verify persisted state does NOT contain the API key
    const raw = localStorageMock.getItem('notesage-connections');
    const parsed = JSON.parse(raw!);
    const conn = parsed.state.connections.find((c: Connection) => c.id === id);
    expect(conn).toBeTruthy();
    expect(conn.credentials.key).toBeUndefined();
    expect(conn.credentials.credentialStored).toBe(true);

    // Verify round-trip
    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);

    const restored = useConnectionsStore.getState().connections.find((c) => c.id === id);
    expect(restored).toBeTruthy();
    expect(restored!.credentials.type).toBe('api_key');
    expect((restored!.credentials as { key?: string }).key).toBeUndefined();
    expect((restored!.credentials as { credentialStored?: boolean }).credentialStored).toBe(true);
  });

  it('persists connection config (model, baseUrl, etc.)', async () => {
    const testConnection: Connection = {
      id: 'conn-oai-compat',
      provider: 'openai_compatible',
      authMethod: 'api_key',
      status: 'connected',
      label: 'Groq',
      credentials: { type: 'api_key', credentialStored: true },
      capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
      config: {
        model: 'llama-3.3-70b',
        baseUrl: 'https://api.groq.com/openai/v1',
        temperature: 0.7,
      },
      createdAt: 1700000000000,
    };

    useConnectionsStore.setState({ connections: [testConnection] });
    await waitForPersist();

    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);

    const restored = useConnectionsStore.getState().connections[0];
    expect(restored.config).toEqual({
      model: 'llama-3.3-70b',
      baseUrl: 'https://api.groq.com/openai/v1',
      temperature: 0.7,
    });
  });

  it('persists custom_acp connections with binaryPath/binaryArgs/localAgentPreset intact and no secret material', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockClear();

    const id = useConnectionsStore.getState().addConnection({
      provider: 'custom_acp',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'OpenCode (local)',
      credentials: { type: 'agent_managed', agentBinary: '/usr/local/bin/opencode' },
      config: {
        binaryPath: '/usr/local/bin/opencode',
        binaryArgs: ['acp'],
        localAgentPreset: 'opencode',
      },
    });
    await waitForPersist();

    // Persisted shape keeps the non-secret launch config (no partialization strips it)
    const raw = localStorageMock.getItem('notesage-connections');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const conn = parsed.state.connections.find((c: Connection) => c.id === id);
    expect(conn).toBeTruthy();
    expect(conn.config.binaryPath).toBe('/usr/local/bin/opencode');
    expect(conn.config.binaryArgs).toEqual(['acp']);
    expect(conn.config.localAgentPreset).toBe('opencode');

    // Capabilities resolved from the real PROVIDER_CAPABILITIES mapping
    expect(conn.capabilities).toEqual(['interactive', 'agent_tasks']);

    // No secret material in the persisted shape: custom_acp carries no api_key
    // (secrets reuse the keychain-backed credentials.envVars flow), and the
    // agent_managed credentials path must not write anything to the keychain.
    expect(conn.credentials.key).toBeUndefined();
    expect(invoke).not.toHaveBeenCalledWith('store_credential', expect.anything());

    // Round-trip: restart restores the connection with launch config intact
    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);

    const restored = useConnectionsStore.getState().getConnection(id);
    expect(restored).toBeTruthy();
    expect(restored!.provider).toBe('custom_acp');
    expect(restored!.config).toEqual({
      binaryPath: '/usr/local/bin/opencode',
      binaryArgs: ['acp'],
      localAgentPreset: 'opencode',
    });
    // Rehydration migrations (openai_compatible baseUrl check, Copilot LSP
    // capability migration, api_key keychain migration) must not touch it.
    expect(restored!.status).toBe('connected');
    expect(restored!.capabilities).toEqual(['interactive', 'agent_tasks']);
  });

  it('strips agent env-var VALUES from localStorage — only the names persist', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockClear();

    const id = useConnectionsStore.getState().addConnection({
      provider: 'google',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Gemini CLI',
      credentials: {
        type: 'agent_managed',
        agentBinary: 'gemini',
        agentArgs: ['--acp'],
        envVars: { GEMINI_API_KEY: 'sk-gemini-secret' },
      },
    });
    await waitForPersist();

    // The secret value went to the keychain, keyed per-var by connection id
    expect(invoke).toHaveBeenCalledWith('store_credential', {
      service: `notesage:${id}:env:GEMINI_API_KEY`,
      key: 'sk-gemini-secret',
    });

    // The persisted shape carries the var NAME but never the value
    const raw = localStorageMock.getItem('notesage-connections')!;
    expect(raw).not.toContain('sk-gemini-secret');
    const persisted = JSON.parse(raw).state.connections.find((c: Connection) => c.id === id);
    expect(persisted.credentials.envVars).toBeUndefined();
    expect(persisted.credentials.envVarKeys).toEqual(['GEMINI_API_KEY']);

    // After a restart the in-memory session copy is gone too — spawns resolve
    // values from the keychain via connectionId + envVarKeys
    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);
    const restored = useConnectionsStore.getState().getConnection(id)!;
    expect(restored.credentials).toMatchObject({ type: 'agent_managed', envVarKeys: ['GEMINI_API_KEY'] });
    expect((restored.credentials as { envVars?: unknown }).envVars).toBeUndefined();
  });

  it('migrates legacy plaintext env vars from localStorage into the keychain on rehydrate', async () => {
    const { invoke } = await import('@tauri-apps/api/core');

    // Seed storage with a pre-keychain persisted shape (plaintext envVars)
    const legacy = {
      state: {
        connections: [{
          id: 'conn-legacy-gemini',
          provider: 'google',
          authMethod: 'agent_managed',
          status: 'connected',
          label: 'Gemini CLI',
          credentials: {
            type: 'agent_managed',
            agentBinary: 'gemini',
            envVars: { GEMINI_API_KEY: 'sk-legacy-secret' },
          },
          capabilities: ['interactive', 'agent_tasks'],
          createdAt: 1700000000000,
        }],
      },
      version: 0,
    };
    localStorageMock.setItem('notesage-connections', JSON.stringify(legacy));
    vi.mocked(invoke).mockClear();

    await useConnectionsStore.persist.rehydrate();
    await waitForPersist();

    // Migration wrote the secret to the keychain…
    expect(invoke).toHaveBeenCalledWith('store_credential', {
      service: 'notesage:conn-legacy-gemini:env:GEMINI_API_KEY',
      key: 'sk-legacy-secret',
    });
    // …kept the value in memory for this session…
    const conn = useConnectionsStore.getState().getConnection('conn-legacy-gemini')!;
    expect(conn.credentials).toMatchObject({
      envVars: { GEMINI_API_KEY: 'sk-legacy-secret' },
      envVarKeys: ['GEMINI_API_KEY'],
    });
    // …and the re-persisted shape no longer contains the plaintext value
    const raw = localStorageMock.getItem('notesage-connections')!;
    expect(raw).not.toContain('sk-legacy-secret');
  });

  it('persists sandbox and network config', async () => {
    const testConnection: Connection = {
      id: 'conn-sandbox',
      provider: 'anthropic',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Claude Code',
      credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      capabilities: ['interactive', 'agent_tasks'],
      sandboxEnabled: true,
      networkSandboxEnabled: true,
      kernelNetworkDeny: true,
      extraWritablePaths: ['/tmp/agent-work'],
      createdAt: 1700000000000,
    };

    useConnectionsStore.setState({ connections: [testConnection] });
    await waitForPersist();

    await simulateRestart(useConnectionsStore, 'notesage-connections', CONNECTIONS_DEFAULTS);

    const restored = useConnectionsStore.getState().connections[0];
    expect(restored.sandboxEnabled).toBe(true);
    expect(restored.networkSandboxEnabled).toBe(true);
    expect(restored.kernelNetworkDeny).toBe(true);
    expect(restored.extraWritablePaths).toEqual(['/tmp/agent-work']);
  });
});

// ===========================================================================
// chat-store
// ===========================================================================

describe('chat-store persistence round-trip', () => {
  it('persists and restores conversations and activeConversationId', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'conv-1',
        title: 'Test Chat',
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'Hi there!', timestamp: 2000 },
        ],
        createdAt: 1000,
        updatedAt: 2000,
        projectPaths: ['/projects/myproject'],
        segments: [{
          projectPaths: ['/projects/myproject'],
          sessionId: null,
          startMessageIndex: 0,
          historyIncluded: false,
        }],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
        activeLeafId: null,
      }],
      activeConversationId: 'conv-1',
    });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-chat-history');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.conversations).toHaveLength(1);
    expect(parsed.state.activeConversationId).toBe('conv-1');

    await simulateRestart(useChatStore, 'notesage-chat-history', CHAT_DEFAULTS);

    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].id).toBe('conv-1');
    expect(state.conversations[0].title).toBe('Test Chat');
    expect(state.conversations[0].messages).toHaveLength(2);
    expect(state.conversations[0].messages[0].content).toBe('Hello');
    expect(state.conversations[0].messages[1].content).toBe('Hi there!');
    expect(state.activeConversationId).toBe('conv-1');
  });

  it('persists webSearchEnabled preference', async () => {
    useChatStore.setState({ webSearchEnabled: true });
    await waitForPersist();

    await simulateRestart(useChatStore, 'notesage-chat-history', CHAT_DEFAULTS);

    expect(useChatStore.getState().webSearchEnabled).toBe(true);
  });

  it('does NOT persist isLoading (transient UI state)', async () => {
    useChatStore.setState({ isLoading: true });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-chat-history');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.isLoading).toBeUndefined();
  });

  it('does NOT persist error (transient UI state)', async () => {
    useChatStore.setState({ error: 'Something went wrong' });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-chat-history');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.error).toBeUndefined();
  });

  it('does NOT persist activeTool (transient UI state)', async () => {
    useChatStore.setState({ activeTool: 'web_search' });
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-chat-history');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.activeTool).toBeUndefined();
  });

  it('preserves conversation segments and project paths through round-trip', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'conv-segments',
        title: 'Multi-segment chat',
        messages: [
          { role: 'user', content: 'msg1', timestamp: 1000 },
          { role: 'assistant', content: 'reply1', timestamp: 2000 },
          { role: 'user', content: 'msg2', timestamp: 3000 },
        ],
        createdAt: 1000,
        updatedAt: 3000,
        projectPaths: ['/projects/second'],
        segments: [
          {
            projectPaths: ['/projects/first'],
            sessionId: 'sess-1',
            startMessageIndex: 0,
            historyIncluded: false,
          },
          {
            projectPaths: ['/projects/second'],
            sessionId: null,
            startMessageIndex: 2,
            historyIncluded: true,
          },
        ],
        activeSegmentIndex: 1,
        pendingProjectSwitch: null,
        activeLeafId: null,
      }],
      activeConversationId: 'conv-segments',
    });
    await waitForPersist();

    await simulateRestart(useChatStore, 'notesage-chat-history', CHAT_DEFAULTS);

    const conv = useChatStore.getState().conversations[0];
    expect(conv.segments).toHaveLength(2);
    expect(conv.segments[0].sessionId).toBe('sess-1');
    expect(conv.segments[1].startMessageIndex).toBe(2);
    expect(conv.segments[1].historyIncluded).toBe(true);
    expect(conv.activeSegmentIndex).toBe(1);
    expect(conv.projectPaths).toEqual(['/projects/second']);
  });

  it('preserves message metadata (citations, connectionLabel, thinking) through round-trip', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'conv-meta',
        title: 'Chat with metadata',
        messages: [{
          role: 'assistant',
          content: 'Here is a response with citations.',
          timestamp: 5000,
          citations: [
            { url: 'https://example.com', title: 'Example', citedText: 'some text' },
          ],
          connectionId: 'conn-123',
          connectionLabel: 'Claude Code',
          connectionProvider: 'anthropic',
          thinking: 'Let me think about this...',
        }],
        createdAt: 5000,
        updatedAt: 5000,
        projectPaths: [],
        segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
        activeLeafId: null,
      }],
      activeConversationId: 'conv-meta',
    });
    await waitForPersist();

    await simulateRestart(useChatStore, 'notesage-chat-history', CHAT_DEFAULTS);

    const msg = useChatStore.getState().conversations[0].messages[0];
    expect(msg.citations).toHaveLength(1);
    expect(msg.citations![0].url).toBe('https://example.com');
    expect(msg.connectionLabel).toBe('Claude Code');
    expect(msg.connectionProvider).toBe('anthropic');
    expect(msg.thinking).toBe('Let me think about this...');
  });
});
