/**
 * Unit tests for the refinement provider resolver.
 *
 * Verifies that `resolveRefinementConnection()` consults `routing-store`
 * (the `agent_tasks` slot for v1) rather than hardcoding a provider:
 *   - slot populated → returns the resolved connection
 *   - slot empty → returns null
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — in-memory localStorage polyfill (Node 22+ lacks standard
// localStorage methods). Mirrors src/stores/__tests__/routing-store.test.ts.
// ---------------------------------------------------------------------------

const { localStorageMock, storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageBacking.set(key, value);
    },
    removeItem: (key: string) => {
      storageBacking.delete(key);
    },
    clear: () => {
      storageBacking.clear();
    },
    get length() {
      return storageBacking.size;
    },
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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { resolveRefinementConnection } from '../refinement-routing';
import { useRoutingStore } from '@/stores/routing-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { EMPTY_ROUTING } from '@/lib/ai/connections';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const agentConn: Connection = {
  id: 'conn-agent-1',
  provider: 'anthropic',
  authMethod: 'agent_managed',
  status: 'connected',
  label: 'Claude Code',
  credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
  capabilities: ['interactive', 'agent_tasks'],
  createdAt: 1700000000000,
};

function seedConnection(conn: Connection): void {
  useConnectionsStore.setState({
    connections: [...useConnectionsStore.getState().connections, conn],
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useRoutingStore.setState({ routing: { ...EMPTY_ROUTING } });
  useConnectionsStore.setState({ connections: [] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveRefinementConnection', () => {
  it('returns the connection assigned to the agent_tasks slot', () => {
    seedConnection(agentConn);
    useRoutingStore.getState().setRouting('agent_tasks', agentConn.id);

    const resolved = resolveRefinementConnection();

    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(agentConn.id);
  });

  it('returns null when the agent_tasks slot is empty', () => {
    // No routing assignment made.
    expect(resolveRefinementConnection()).toBeNull();
  });

  it('reads the slot from routing-store, not a hardcoded provider', () => {
    // Proof the resolver consults routing-store: assigning the slot flips the
    // result from null to the connection, and clearing it flips back.
    seedConnection(agentConn);

    expect(resolveRefinementConnection()).toBeNull();

    useRoutingStore.getState().setRouting('agent_tasks', agentConn.id);
    expect(resolveRefinementConnection()?.id).toBe(agentConn.id);

    useRoutingStore.getState().setRouting('agent_tasks', null);
    expect(resolveRefinementConnection()).toBeNull();
  });
});
