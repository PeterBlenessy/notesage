/**
 * The one-time migration of plaintext API keys from localStorage to the OS
 * keychain, as run by connections-store on rehydration (audit 2026-11-22 §8).
 *
 * Two outcomes matter and neither was tested:
 * - success: the keys are stripped from state and from localStorage;
 * - failure: the keys STAY, because stripping keys the keychain never
 *   received would sign the user out of every provider.
 *
 * The Rust half (`migrate_credentials`) is tested in `credentials.rs`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory localStorage, installed before the store module loads (same
// polyfill as connections-store.test.ts).
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
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  return { storageBacking };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/ai/connections', () => ({
  getCapabilities: vi.fn().mockReturnValue(['interactive', 'agent_tasks']),
}));

import { useConnectionsStore } from '../connections-store';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';

const STORAGE_KEY = 'notesage-connections';

/** A persisted blob from before the keychain: the key is in plaintext. */
function legacyBlob(): string {
  return JSON.stringify({
    state: {
      connections: [
        {
          id: 'conn-legacy',
          provider: 'anthropic',
          authMethod: 'api_key',
          status: 'connected',
          label: 'Anthropic',
          credentials: { type: 'api_key', key: 'sk-plaintext' },
          capabilities: ['interactive', 'agent_tasks'],
          createdAt: 1,
        },
        {
          id: 'conn-ollama',
          provider: 'ollama',
          authMethod: 'local',
          status: 'connected',
          label: 'Ollama',
          credentials: { type: 'local', url: 'http://localhost:11434' },
          capabilities: ['interactive'],
          createdAt: 2,
        },
      ],
    },
    version: 0,
  });
}

function mockMigrate(impl: (args: unknown) => Promise<unknown>) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command === 'migrate_credentials') return impl(args);
    return null;
  });
}

/** Let the migration's promise chain (invoke → then/catch) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function persisted(): { state: { connections: Array<{ id: string; credentials: Record<string, unknown> }> } } {
  return JSON.parse(storageBacking.get(STORAGE_KEY) ?? '{}');
}

describe('connections-store: plaintext key → keychain migration', () => {
  beforeEach(() => {
    storageBacking.clear();
    vi.clearAllMocks();
    useConnectionsStore.setState({ connections: [] });
  });

  it('sends the raw persisted blob to migrate_credentials', async () => {
    const raw = legacyBlob();
    storageBacking.set(STORAGE_KEY, raw);
    mockMigrate(async () => 1);

    await useConnectionsStore.persist.rehydrate();
    await settle();

    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'migrate_credentials');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ connectionsJson: raw });
  });

  it('on success strips the key from state and from localStorage', async () => {
    storageBacking.set(STORAGE_KEY, legacyBlob());
    mockMigrate(async () => 1);

    await useConnectionsStore.persist.rehydrate();
    await settle();

    const conn = useConnectionsStore.getState().getConnection('conn-legacy');
    expect(conn?.credentials).toEqual({ type: 'api_key', credentialStored: true });

    const stored = persisted().state.connections.find((c) => c.id === 'conn-legacy');
    expect(stored?.credentials).toEqual({ type: 'api_key', credentialStored: true });
    expect(storageBacking.get(STORAGE_KEY)).not.toContain('sk-plaintext');

    // Connections with nothing to migrate are left exactly as they were.
    expect(useConnectionsStore.getState().getConnection('conn-ollama')?.credentials).toEqual({
      type: 'local',
      url: 'http://localhost:11434',
    });
  });

  it('on failure keeps the key, so the connection still works', async () => {
    storageBacking.set(STORAGE_KEY, legacyBlob());
    mockMigrate(async () => { throw new Error('Keychain error: locked'); });

    await useConnectionsStore.persist.rehydrate();
    await settle();

    const conn = useConnectionsStore.getState().getConnection('conn-legacy');
    expect(conn?.credentials).toEqual({ type: 'api_key', key: 'sk-plaintext' });
    expect(conn?.credentials).not.toHaveProperty('credentialStored');
    expect(vi.mocked(log.error)).toHaveBeenCalledWith(
      'connections',
      expect.stringContaining('Credential migration failed'),
      expect.anything(),
    );
  });

  it('does not run when every key is already in the keychain', async () => {
    const blob = JSON.parse(legacyBlob());
    blob.state.connections[0].credentials = { type: 'api_key', credentialStored: true };
    storageBacking.set(STORAGE_KEY, JSON.stringify(blob));
    mockMigrate(async () => 0);

    await useConnectionsStore.persist.rehydrate();
    await settle();

    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'migrate_credentials')).toBe(false);
  });

  it('a retry after a failed migration picks the key up again', async () => {
    storageBacking.set(STORAGE_KEY, legacyBlob());
    mockMigrate(async () => { throw new Error('Keychain error: locked'); });
    await useConnectionsStore.persist.rehydrate();
    await settle();
    // The plaintext key must still be what is persisted, or the next launch
    // has nothing to migrate and nothing to authenticate with.
    expect(storageBacking.get(STORAGE_KEY)).toContain('sk-plaintext');

    mockMigrate(async () => 1);
    await useConnectionsStore.persist.rehydrate();
    await settle();
    expect(useConnectionsStore.getState().getConnection('conn-legacy')?.credentials).toEqual({
      type: 'api_key',
      credentialStored: true,
    });
    expect(storageBacking.get(STORAGE_KEY)).not.toContain('sk-plaintext');
  });
});
