import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';

import type {
  Connection,
  ConnectionProvider,
  AICapability,
  AuthMethod,
  ConnectionCredentials,
  ConnectionConfig,
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
    config?: ConnectionConfig;
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

        // For api_key credentials, store the key in the OS keychain and strip from persisted state
        let credentials = conn.credentials;
        if (credentials.type === 'api_key' && credentials.key) {
          const key = credentials.key;
          credentials = { type: 'api_key', credentialStored: true };
          invoke('store_credential', { service: `notesage:${id}`, key })
            .catch((e) => log.error('connections', 'Failed to store credential in keychain', { id, error: String(e) }));
        }

        const connection: Connection = {
          ...conn,
          credentials,
          id,
          capabilities,
          createdAt: Date.now(),
          ...(conn.config ? { config: conn.config } : {}),
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
        // Clean up keychain entry
        invoke('delete_credential', { service: `notesage:${id}` })
          .catch((e) => log.error('connections', 'Failed to delete credential from keychain', { id, error: String(e) }));
        log.info('connections', 'Connection removed', { id, provider: conn?.provider });
      },

      getConnection: (id) =>
        get().connections.find((c) => c.id === id),

      getConnectionsByProvider: (provider) =>
        get().connections.filter((c) => c.provider === provider),

      getConnectionsByCapability: (capability) =>
        get().connections.filter((c) => c.capabilities.includes(capability)),
    }),
    {
      name: 'notesage-connections',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Validate openai_compatible connections have required config.baseUrl
        let changed = false;
        const validated = state.connections.map((c) => {
          if (c.provider === 'openai_compatible' && !c.config?.baseUrl && c.status !== 'error') {
            changed = true;
            log.warn('connections', 'OpenAI-compatible connection missing baseUrl, marking as error', { id: c.id, label: c.label });
            return { ...c, status: 'error' as const };
          }
          return c;
        });
        if (changed) {
          state.connections = validated;
        }

        // Migrate Copilot LSP connections from inline_completion-only to full capabilities.
        // Previously, ConnectionsSettings forced capabilities to ['inline_completion'] on creation.
        // Now the LSP supports conversation/* methods for chat and agent tasks.
        let capMigrated = false;
        state.connections = state.connections.map((c) => {
          if (
            c.credentials.type === 'agent_managed' &&
            'agentBinary' in c.credentials &&
            c.credentials.agentBinary === 'copilot-language-server' &&
            c.capabilities.length === 1 &&
            c.capabilities[0] === 'inline_completion'
          ) {
            capMigrated = true;
            return { ...c, capabilities: ['interactive', 'inline_completion', 'agent_tasks'] as AICapability[] };
          }
          return c;
        });
        if (capMigrated) {
          log.info('connections', 'Migrated Copilot LSP connections to full capabilities');
        }

        // Migrate plaintext API keys from localStorage to OS keychain (one-time)
        const needsMigration = state.connections.some(
          (c) => c.credentials.type === 'api_key' && c.credentials.key && !c.credentials.credentialStored
        );
        if (needsMigration) {
          const raw = localStorage.getItem('notesage-connections');
          if (raw) {
            invoke('migrate_credentials', { connectionsJson: raw })
              .then((count) => {
                log.info('connections', `Migrated ${count} credential(s) to keychain`);
                // Strip keys from persisted state
                const store = useConnectionsStore.getState();
                const migrated = store.connections.map((c) => {
                  if (c.credentials.type === 'api_key' && c.credentials.key) {
                    return { ...c, credentials: { type: 'api_key' as const, credentialStored: true } };
                  }
                  return c;
                });
                useConnectionsStore.setState({ connections: migrated });
              })
              .catch((e) => {
                log.error('connections', 'Credential migration failed — keys remain in localStorage', { error: String(e) });
              });
          }
        }

        // Migrate hardcoded reasoningEffort to acpDefaults.thinkingEffort (one-time)
        const needsEffortMigration = state.connections.some(
          (c) => c.config?.reasoningEffort && !c.acpDefaults?.thinkingEffort
        );
        if (needsEffortMigration) {
          const migrated = state.connections.map((c) => {
            if (c.config?.reasoningEffort && !c.acpDefaults?.thinkingEffort) {
              const { reasoningEffort, ...restConfig } = c.config;
              return {
                ...c,
                config: Object.keys(restConfig).length > 0 ? restConfig : undefined,
                acpDefaults: { ...c.acpDefaults, thinkingEffort: reasoningEffort },
              };
            }
            return c;
          });
          useConnectionsStore.setState({ connections: migrated });
          log.info('connections', 'Migrated reasoningEffort to acpDefaults.thinkingEffort');
        }
      },
    }
  )
);
