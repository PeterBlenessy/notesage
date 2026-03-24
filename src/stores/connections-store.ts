import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { log } from '@/lib/logger';

import type {
  Connection,
  ConnectionProvider,
  AICapability,
  AuthMethod,
  ConnectionCredentials,
  ConnectionStatus,
} from '@/lib/ai/connections';
import { getCapabilities } from '@/lib/ai/connections';

interface ConnectionsStore {
  connections: Connection[];

  addConnection: (conn: {
    provider: ConnectionProvider;
    authMethod: AuthMethod;
    status: ConnectionStatus;
    label: string;
    credentials: ConnectionCredentials;
  }) => string; // returns ID
  updateConnection: (id: string, updates: Partial<Omit<Connection, 'id' | 'createdAt'>>) => void;
  removeConnection: (id: string) => void;
  getConnection: (id: string) => Connection | undefined;
  getConnectionsByProvider: (provider: ConnectionProvider) => Connection[];
  getConnectionsByCapability: (capability: AICapability) => Connection[];
}

export const useConnectionsStore = create<ConnectionsStore>()(
  persist(
    (set, get) => ({
      connections: [],

      addConnection: (conn) => {
        const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const capabilities = getCapabilities(conn.provider, conn.authMethod);
        const connection: Connection = {
          ...conn,
          id,
          capabilities,
          createdAt: Date.now(),
        };
        set((state) => ({
          connections: [...state.connections, connection],
        }));
        log.info('connections', 'Connection added', { id, provider: conn.provider, authMethod: conn.authMethod, capabilities });
        return id;
      },

      updateConnection: (id, updates) => {
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        }));
        log.debug('connections', 'Connection updated', { id, fields: Object.keys(updates) });
      },

      removeConnection: (id) => {
        const conn = get().connections.find((c) => c.id === id);
        set((state) => ({
          connections: state.connections.filter((c) => c.id !== id),
        }));
        log.info('connections', 'Connection removed', { id, provider: conn?.provider });
      },

      getConnection: (id) =>
        get().connections.find((c) => c.id === id),

      getConnectionsByProvider: (provider) =>
        get().connections.filter((c) => c.provider === provider),

      getConnectionsByCapability: (capability) =>
        get().connections.filter((c) => c.capabilities.includes(capability)),
    }),
    { name: 'notesage-connections' }
  )
);
