/**
 * Unit tests for connections-store.
 *
 * Covers: initial state, addConnection (ID generation, capabilities, keychain
 * storage), updateConnection, removeConnection (with keychain cleanup),
 * getConnection, getConnectionsByProvider, getConnectionsByCapability,
 * persistence round-trip.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
// Sets up an in-memory localStorage polyfill since Node.js v22+ has a native
// localStorage without standard methods (setItem, getItem, clear, etc.).
// ---------------------------------------------------------------------------

const { storageBacking } = vi.hoisted(() => {
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

vi.mock('@/lib/ai/connections', () => ({
  getCapabilities: vi.fn().mockReturnValue(['interactive', 'agent_tasks']),
}));

// ---------------------------------------------------------------------------
// Import store + mocked modules after mocks are in place
// ---------------------------------------------------------------------------

import { useConnectionsStore } from '../connections-store';
import { invoke } from '@tauri-apps/api/core';
import { getCapabilities } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('connections-store', () => {
  beforeEach(() => {
    storageBacking.clear();
    vi.clearAllMocks();
    useConnectionsStore.setState({ connections: [] });
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('starts with an empty connections array', () => {
      expect(useConnectionsStore.getState().connections).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // addConnection
  // -----------------------------------------------------------------------

  describe('addConnection', () => {
    it('creates a connection with generated ID, capabilities, and timestamp', () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Local Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      expect(id).toMatch(/^conn-\d+-[a-z0-9]+$/);

      const conn = useConnectionsStore.getState().getConnection(id);
      expect(conn).toBeDefined();
      expect(conn!.provider).toBe('ollama');
      expect(conn!.authMethod).toBe('local');
      expect(conn!.status).toBe('connected');
      expect(conn!.label).toBe('Local Ollama');
      expect(conn!.capabilities).toEqual(['interactive', 'agent_tasks']);
      expect(conn!.createdAt).toBeGreaterThan(0);
      expect(getCapabilities).toHaveBeenCalledWith('ollama', 'local');
    });

    it('stores API key in keychain and strips from persisted state', async () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', key: 'sk-ant-test-key' },
      });

      // Key should be stripped from the stored connection
      const conn = useConnectionsStore.getState().getConnection(id);
      expect(conn!.credentials).toEqual({ type: 'api_key', credentialStored: true });
      expect((conn!.credentials as { key?: string }).key).toBeUndefined();

      // store_credential should have been called
      // Allow microtask to resolve the async invoke call
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('store_credential', {
          service: `notesage:${id}`,
          key: 'sk-ant-test-key',
        });
      });
    });

    it('preserves config when provided', () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'openai',
        authMethod: 'api_key',
        status: 'connected',
        label: 'OpenAI',
        credentials: { type: 'api_key', key: 'sk-openai-test' },
        config: { model: 'gpt-4o', temperature: 0.7 },
      });

      const conn = useConnectionsStore.getState().getConnection(id);
      expect(conn!.config).toEqual({ model: 'gpt-4o', temperature: 0.7 });
    });

    it('does not call store_credential for non-api_key credentials', () => {
      useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      expect(invoke).not.toHaveBeenCalledWith('store_credential', expect.anything());
    });

    it('returns unique IDs for successive connections', () => {
      const id1 = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama 1',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      const id2 = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama 2',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      expect(id1).not.toBe(id2);
      expect(useConnectionsStore.getState().connections).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // updateConnection
  // -----------------------------------------------------------------------

  describe('updateConnection', () => {
    it('updates specific fields on an existing connection', () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', credentialStored: true },
      });

      useConnectionsStore.getState().updateConnection(id, {
        status: 'error',
        label: 'Anthropic (expired)',
      });

      const conn = useConnectionsStore.getState().getConnection(id);
      expect(conn!.status).toBe('error');
      expect(conn!.label).toBe('Anthropic (expired)');
      expect(conn!.provider).toBe('anthropic'); // unchanged
    });

    it('no-ops when ID does not exist', () => {
      useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      const before = useConnectionsStore.getState().connections;
      useConnectionsStore.getState().updateConnection('conn-nonexistent', { label: 'Ghost' });
      const after = useConnectionsStore.getState().connections;

      // The connections array is rebuilt by map so it is a new reference,
      // but the contents should be identical.
      expect(after).toHaveLength(before.length);
      expect(after[0].label).toBe('Ollama');
    });
  });

  // -----------------------------------------------------------------------
  // removeConnection
  // -----------------------------------------------------------------------

  describe('removeConnection', () => {
    it('removes a connection from the list', () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      useConnectionsStore.getState().removeConnection(id);
      expect(useConnectionsStore.getState().connections).toHaveLength(0);
    });

    it('calls delete_credential for keychain cleanup', async () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', credentialStored: true },
      });

      vi.clearAllMocks(); // reset to isolate removeConnection calls
      useConnectionsStore.getState().removeConnection(id);

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('delete_credential', {
          service: `notesage:${id}`,
        });
      });
    });

    it('no-ops gracefully when ID does not exist', () => {
      useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      useConnectionsStore.getState().removeConnection('conn-nonexistent');
      expect(useConnectionsStore.getState().connections).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // getConnection
  // -----------------------------------------------------------------------

  describe('getConnection', () => {
    it('finds a connection by ID', () => {
      const id = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      const conn = useConnectionsStore.getState().getConnection(id);
      expect(conn).toBeDefined();
      expect(conn!.id).toBe(id);
    });

    it('returns undefined for a missing ID', () => {
      expect(useConnectionsStore.getState().getConnection('conn-missing')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getConnectionsByProvider
  // -----------------------------------------------------------------------

  describe('getConnectionsByProvider', () => {
    it('filters connections by provider', () => {
      useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', credentialStored: true },
      });

      useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'agent_managed',
        status: 'connected',
        label: 'Claude Code',
        credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      });

      const anthropic = useConnectionsStore.getState().getConnectionsByProvider('anthropic');
      expect(anthropic).toHaveLength(2);
      expect(anthropic.every((c) => c.provider === 'anthropic')).toBe(true);

      const ollama = useConnectionsStore.getState().getConnectionsByProvider('ollama');
      expect(ollama).toHaveLength(1);

      const google = useConnectionsStore.getState().getConnectionsByProvider('google');
      expect(google).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // getConnectionsByCapability
  // -----------------------------------------------------------------------

  describe('getConnectionsByCapability', () => {
    it('filters connections by capability', () => {
      // The mock returns ['interactive', 'agent_tasks'] for all calls
      useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', credentialStored: true },
      });

      useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      const interactive = useConnectionsStore.getState().getConnectionsByCapability('interactive');
      expect(interactive).toHaveLength(2);

      const agentTasks = useConnectionsStore.getState().getConnectionsByCapability('agent_tasks');
      expect(agentTasks).toHaveLength(2);

      const inline = useConnectionsStore.getState().getConnectionsByCapability('inline_completion');
      expect(inline).toHaveLength(0);
    });

    it('respects different capabilities per connection', () => {
      // Override mock for one call to return inline_completion only
      vi.mocked(getCapabilities)
        .mockReturnValueOnce(['interactive', 'agent_tasks'])
        .mockReturnValueOnce(['inline_completion']);

      useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', credentialStored: true },
      });

      useConnectionsStore.getState().addConnection({
        provider: 'github',
        authMethod: 'agent_managed',
        status: 'connected',
        label: 'Copilot LSP',
        credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      });

      const interactive = useConnectionsStore.getState().getConnectionsByCapability('interactive');
      expect(interactive).toHaveLength(1);
      expect(interactive[0].provider).toBe('anthropic');

      const inline = useConnectionsStore.getState().getConnectionsByCapability('inline_completion');
      expect(inline).toHaveLength(1);
      expect(inline[0].provider).toBe('github');
    });
  });

  // -----------------------------------------------------------------------
  // Persistence round-trip
  // -----------------------------------------------------------------------

  describe('persistence', () => {
    it('connections survive a store rehydration cycle', () => {
      // Add a connection (with non-api_key creds to avoid keychain side effects)
      const id = useConnectionsStore.getState().addConnection({
        provider: 'ollama',
        authMethod: 'local',
        status: 'connected',
        label: 'Ollama',
        credentials: { type: 'local', url: 'http://localhost:11434' },
      });

      // Verify localStorage has the persisted data
      const raw = storageBacking.get('notesage-connections');
      expect(raw).toBeDefined();

      const parsed = JSON.parse(raw!);
      expect(parsed.state.connections).toHaveLength(1);
      expect(parsed.state.connections[0].id).toBe(id);
      expect(parsed.state.connections[0].provider).toBe('ollama');
      expect(parsed.state.connections[0].label).toBe('Ollama');
    });

    it('persisted API key connections have key stripped', () => {
      useConnectionsStore.getState().addConnection({
        provider: 'anthropic',
        authMethod: 'api_key',
        status: 'connected',
        label: 'Anthropic',
        credentials: { type: 'api_key', key: 'sk-secret' },
      });

      const raw = storageBacking.get('notesage-connections');
      const parsed = JSON.parse(raw!);
      const creds = parsed.state.connections[0].credentials;

      // Key must NOT appear in localStorage
      expect(creds.key).toBeUndefined();
      expect(creds.credentialStored).toBe(true);
    });
  });
});
