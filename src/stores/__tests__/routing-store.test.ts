/**
 * Unit tests for routing-store.
 *
 * Tests: initial state, setRouting, autoAssign, clearRoutingForConnection,
 * setUseCaseModel, getConnectionForUseCase, getModelForUseCase,
 * persistence round-trip, and v0→v1 migration.
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

import { useRoutingStore } from '../routing-store';
import { useConnectionsStore } from '../connections-store';
import { EMPTY_ROUTING } from '@/lib/ai/connections';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for Zustand persist to flush writes to storage. */
async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * Simulate an app restart: snapshot localStorage, reset in-memory store,
 * restore the snapshot, then rehydrate.
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
  store.setState(defaults);
  await waitForPersist();
  if (snapshot) localStorageMock.setItem(storageKey, snapshot);
  await store.persist.rehydrate();
  await waitForPersist();
}

const ROUTING_DEFAULTS = {
  routing: { ...EMPTY_ROUTING },
};

const CONNECTIONS_DEFAULTS = { connections: [] };

/** Helper to seed a connection into connections-store. */
function seedConnection(conn: Connection): void {
  useConnectionsStore.setState({
    connections: [...useConnectionsStore.getState().connections, conn],
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const anthropicConn: Connection = {
  id: 'conn-anthropic-1',
  provider: 'anthropic',
  authMethod: 'api_key',
  status: 'connected',
  label: 'Anthropic API',
  credentials: { type: 'api_key', credentialStored: true },
  capabilities: ['interactive', 'agent_tasks'],
  createdAt: 1700000000000,
};

const ollamaConn: Connection = {
  id: 'conn-ollama-1',
  provider: 'ollama',
  authMethod: 'local',
  status: 'connected',
  label: 'Ollama Local',
  credentials: { type: 'local', url: 'http://localhost:11434' },
  capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
  createdAt: 1700000001000,
};

const copilotLspConn: Connection = {
  id: 'conn-copilot-lsp-1',
  provider: 'copilot',
  authMethod: 'agent_managed',
  status: 'connected',
  label: 'Copilot LSP',
  credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
  capabilities: ['inline_completion'],
  createdAt: 1700000002000,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useRoutingStore.setState(ROUTING_DEFAULTS);
  useConnectionsStore.setState(CONNECTIONS_DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// Initial state
// ===========================================================================

describe('routing-store initial state', () => {
  it('starts with all routing slots set to null connectionId', () => {
    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBeNull();
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBeNull();
  });

  it('starts with no model overrides', () => {
    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.model).toBeUndefined();
    expect(routing.agent_tasks.model).toBeUndefined();
    expect(routing.inline_completion.model).toBeUndefined();
  });
});

// ===========================================================================
// setRouting
// ===========================================================================

describe('setRouting', () => {
  it('assigns a connection to a use case slot', () => {
    seedConnection(anthropicConn);
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBe('conn-anthropic-1');
    // Other slots remain unaffected
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBeNull();
  });

  it('clears model override when assigning a new connection', () => {
    seedConnection(anthropicConn);

    // Set a model override first
    useRoutingStore.getState().setUseCaseModel('interactive', 'claude-3-haiku');
    expect(useRoutingStore.getState().routing.interactive.model).toBe('claude-3-haiku');

    // Now set routing — model should be cleared
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');
    expect(useRoutingStore.getState().routing.interactive.model).toBeUndefined();
  });

  it('clears a routing slot when passed null', () => {
    seedConnection(anthropicConn);
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');
    expect(useRoutingStore.getState().routing.interactive.connectionId).toBe('conn-anthropic-1');

    useRoutingStore.getState().setRouting('interactive', null);
    expect(useRoutingStore.getState().routing.interactive.connectionId).toBeNull();
  });
});

// ===========================================================================
// autoAssign
// ===========================================================================

describe('autoAssign', () => {
  it('fills empty slots matching connection capabilities', () => {
    seedConnection(ollamaConn);
    useRoutingStore.getState().autoAssign('conn-ollama-1');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBe('conn-ollama-1');
    expect(routing.agent_tasks.connectionId).toBe('conn-ollama-1');
    expect(routing.inline_completion.connectionId).toBe('conn-ollama-1');
  });

  it('does not override existing assignments', () => {
    seedConnection(anthropicConn);
    seedConnection(ollamaConn);

    // Pre-assign interactive to anthropic
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');

    // Auto-assign ollama — should NOT override interactive
    useRoutingStore.getState().autoAssign('conn-ollama-1');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBe('conn-anthropic-1');
    expect(routing.agent_tasks.connectionId).toBe('conn-ollama-1');
    expect(routing.inline_completion.connectionId).toBe('conn-ollama-1');
  });

  it('respects connection capabilities — only fills matching slots', () => {
    seedConnection(copilotLspConn);
    useRoutingStore.getState().autoAssign('conn-copilot-lsp-1');

    const { routing } = useRoutingStore.getState();
    // Copilot LSP only has inline_completion capability
    expect(routing.interactive.connectionId).toBeNull();
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBe('conn-copilot-lsp-1');
  });

  it('does nothing for a non-existent connection', () => {
    useRoutingStore.getState().autoAssign('conn-nonexistent');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBeNull();
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBeNull();
  });
});

// ===========================================================================
// clearRoutingForConnection
// ===========================================================================

describe('clearRoutingForConnection', () => {
  it('removes all assignments for a given connection', () => {
    seedConnection(ollamaConn);
    useRoutingStore.getState().autoAssign('conn-ollama-1');

    // Verify all three slots are assigned
    expect(useRoutingStore.getState().routing.interactive.connectionId).toBe('conn-ollama-1');

    useRoutingStore.getState().clearRoutingForConnection('conn-ollama-1');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBeNull();
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBeNull();
  });

  it('does not affect slots assigned to other connections', () => {
    seedConnection(anthropicConn);
    seedConnection(copilotLspConn);

    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');
    useRoutingStore.getState().setRouting('agent_tasks', 'conn-anthropic-1');
    useRoutingStore.getState().setRouting('inline_completion', 'conn-copilot-lsp-1');

    useRoutingStore.getState().clearRoutingForConnection('conn-anthropic-1');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBeNull();
    expect(routing.agent_tasks.connectionId).toBeNull();
    expect(routing.inline_completion.connectionId).toBe('conn-copilot-lsp-1');
  });

  it('is a no-op when connection has no assignments', () => {
    seedConnection(anthropicConn);
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');

    useRoutingStore.getState().clearRoutingForConnection('conn-nonexistent');

    expect(useRoutingStore.getState().routing.interactive.connectionId).toBe('conn-anthropic-1');
  });
});

// ===========================================================================
// setUseCaseModel
// ===========================================================================

describe('setUseCaseModel', () => {
  it('sets a model override for a use case', () => {
    useRoutingStore.getState().setUseCaseModel('interactive', 'claude-3-haiku');
    expect(useRoutingStore.getState().routing.interactive.model).toBe('claude-3-haiku');
  });

  it('clears a model override when set to undefined', () => {
    useRoutingStore.getState().setUseCaseModel('interactive', 'claude-3-haiku');
    useRoutingStore.getState().setUseCaseModel('interactive', undefined);
    expect(useRoutingStore.getState().routing.interactive.model).toBeUndefined();
  });

  it('does not affect other slots', () => {
    useRoutingStore.getState().setUseCaseModel('interactive', 'claude-3-haiku');
    useRoutingStore.getState().setUseCaseModel('agent_tasks', 'gpt-4o');

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.model).toBe('claude-3-haiku');
    expect(routing.agent_tasks.model).toBe('gpt-4o');
    expect(routing.inline_completion.model).toBeUndefined();
  });
});

// ===========================================================================
// getConnectionForUseCase
// ===========================================================================

describe('getConnectionForUseCase', () => {
  it('returns the connection object for a routed use case', () => {
    seedConnection(anthropicConn);
    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');

    const conn = useRoutingStore.getState().getConnectionForUseCase('interactive');
    expect(conn).not.toBeNull();
    expect(conn!.id).toBe('conn-anthropic-1');
    expect(conn!.provider).toBe('anthropic');
  });

  it('returns null for an unassigned use case', () => {
    const conn = useRoutingStore.getState().getConnectionForUseCase('interactive');
    expect(conn).toBeNull();
  });

  it('returns null when the assigned connection no longer exists', () => {
    useRoutingStore.setState({
      routing: {
        ...EMPTY_ROUTING,
        interactive: { connectionId: 'conn-deleted' },
      },
    });

    const conn = useRoutingStore.getState().getConnectionForUseCase('interactive');
    expect(conn).toBeNull();
  });
});

// ===========================================================================
// getModelForUseCase
// ===========================================================================

describe('getModelForUseCase', () => {
  it('returns the model override when set', () => {
    useRoutingStore.getState().setUseCaseModel('agent_tasks', 'gpt-4-turbo');
    expect(useRoutingStore.getState().getModelForUseCase('agent_tasks')).toBe('gpt-4-turbo');
  });

  it('returns undefined when no model override is set', () => {
    expect(useRoutingStore.getState().getModelForUseCase('interactive')).toBeUndefined();
  });
});

// ===========================================================================
// Persistence round-trip
// ===========================================================================

describe('routing-store persistence round-trip', () => {
  it('persists and restores routing assignments', async () => {
    seedConnection(anthropicConn);
    seedConnection(copilotLspConn);

    useRoutingStore.getState().setRouting('interactive', 'conn-anthropic-1');
    useRoutingStore.getState().setRouting('agent_tasks', 'conn-anthropic-1');
    useRoutingStore.getState().setRouting('inline_completion', 'conn-copilot-lsp-1');
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-routing');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.routing.interactive.connectionId).toBe('conn-anthropic-1');
    expect(parsed.state.routing.inline_completion.connectionId).toBe('conn-copilot-lsp-1');

    await simulateRestart(useRoutingStore, 'notesage-routing', ROUTING_DEFAULTS);

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.connectionId).toBe('conn-anthropic-1');
    expect(routing.agent_tasks.connectionId).toBe('conn-anthropic-1');
    expect(routing.inline_completion.connectionId).toBe('conn-copilot-lsp-1');
  });

  it('persists and restores model overrides', async () => {
    useRoutingStore.getState().setUseCaseModel('interactive', 'claude-3-opus');
    useRoutingStore.getState().setUseCaseModel('agent_tasks', 'gpt-4o-mini');
    await waitForPersist();

    await simulateRestart(useRoutingStore, 'notesage-routing', ROUTING_DEFAULTS);

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive.model).toBe('claude-3-opus');
    expect(routing.agent_tasks.model).toBe('gpt-4o-mini');
    expect(routing.inline_completion.model).toBeUndefined();
  });
});

// ===========================================================================
// v0 → v1 migration
// ===========================================================================

describe('v0 → v1 migration', () => {
  it('migrates old string-based routing to UseCaseSlot objects', async () => {
    // Seed v0 format directly into localStorage: plain strings instead of UseCaseSlot objects
    const v0State = {
      state: {
        routing: {
          interactive: 'conn-old-1',
          agent_tasks: 'conn-old-2',
          inline_completion: null,
        },
      },
      version: 0,
    };

    // Reset store first, wait for persist to flush defaults, then inject v0 data
    useRoutingStore.setState(ROUTING_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-routing', JSON.stringify(v0State));

    await useRoutingStore.persist.rehydrate();
    await waitForPersist();

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive).toEqual({ connectionId: 'conn-old-1' });
    expect(routing.agent_tasks).toEqual({ connectionId: 'conn-old-2' });
    expect(routing.inline_completion).toEqual({ connectionId: null });
  });

  it('migrates when version is explicitly 0', async () => {
    // Version field set to 0 — triggers v0→v1 migration path
    const v0ExplicitState = {
      state: {
        routing: {
          interactive: 'conn-legacy',
          agent_tasks: null,
          inline_completion: null,
        },
      },
      version: 0,
    };

    useRoutingStore.setState(ROUTING_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-routing', JSON.stringify(v0ExplicitState));

    await useRoutingStore.persist.rehydrate();
    await waitForPersist();

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive).toEqual({ connectionId: 'conn-legacy' });
    expect(routing.agent_tasks).toEqual({ connectionId: null });
    expect(routing.inline_completion).toEqual({ connectionId: null });
  });

  it('preserves v1 format through rehydration (no double-migration)', async () => {
    const v1State = {
      state: {
        routing: {
          interactive: { connectionId: 'conn-v1', model: 'claude-3-opus' },
          agent_tasks: { connectionId: null },
          inline_completion: { connectionId: 'conn-copilot' },
        },
      },
      version: 1,
    };

    useRoutingStore.setState(ROUTING_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-routing', JSON.stringify(v1State));

    await useRoutingStore.persist.rehydrate();
    await waitForPersist();

    const { routing } = useRoutingStore.getState();
    expect(routing.interactive).toEqual({ connectionId: 'conn-v1', model: 'claude-3-opus' });
    expect(routing.agent_tasks).toEqual({ connectionId: null });
    expect(routing.inline_completion).toEqual({ connectionId: 'conn-copilot' });
  });
});
