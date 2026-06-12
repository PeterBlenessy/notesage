import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { track, providerKind } from '@/lib/telemetry';

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

  addConnection: (
    conn: {
      provider: ConnectionProvider;
      authMethod: AuthMethod;
      status: ConnectionStatus;
      label: string;
      credentials: ConnectionCredentials;
      config?: ConnectionConfig;
    },
    /** `silent: true` suppresses the `connection_added` telemetry event — used
     * by the one-time v1→v2 migration so ported connections aren't counted as
     * new user actions. */
    opts?: { silent?: boolean },
  ) => string; // returns ID
  updateConnection: (id: string, updates: Partial<Omit<Connection, 'id' | 'createdAt'>>) => void;
  removeConnection: (id: string) => void;
  getConnection: (id: string) => Connection | undefined;
  getConnectionsByProvider: (provider: ConnectionProvider) => Connection[];
  getConnectionsByCapability: (capability: AICapability) => Connection[];
}

/** Write each env-var value to the OS keychain (`notesage:<id>:env:<KEY>`) and
 *  record the var names on the credentials. Values are kept in memory for the
 *  session; `partialize` strips them from the persisted shape. */
function storeEnvVarsInKeychain(
  id: string,
  credentials: Extract<ConnectionCredentials, { type: 'agent_managed' }>,
): ConnectionCredentials {
  const envVars = credentials.envVars ?? {};
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;
    invoke('store_credential', { service: `notesage:${id}:env:${key}`, key: value })
      .catch((e) => log.error('connections', 'Failed to store env credential in keychain', { id, key, error: String(e) }));
  }
  return { ...credentials, envVarKeys: Object.keys(envVars) };
}

/** Persisted shape of a connection: secrets never reach localStorage.
 *  Tolerates partial shapes (test fixtures, mid-migration state) — only a
 *  well-formed agent_managed credential block is rewritten. */
function stripSecretsForPersist(c: Connection): Connection {
  if (c.credentials?.type === 'agent_managed' && c.credentials.envVars) {
    const { envVars, ...rest } = c.credentials;
    return { ...c, credentials: { ...rest, envVarKeys: rest.envVarKeys ?? Object.keys(envVars) } };
  }
  return c;
}

export const useConnectionsStore = create<ConnectionsStore>()(
  persist(
    (set, get) => ({
      connections: [],

      addConnection: (conn, opts) => {
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
        // For agent_managed credentials with env vars (ACP EnvVar auth), store each
        // value in the keychain. The values stay on the in-memory connection for the
        // current session (avoids racing the async keychain write at first spawn) but
        // are stripped from the persisted shape by `partialize` — only the var NAMES
        // (`envVarKeys`) reach localStorage. Spawns after a restart resolve values
        // from the keychain via `connection_id` + key name in `acp_agent_spawn`.
        if (credentials.type === 'agent_managed' && credentials.envVars && Object.keys(credentials.envVars).length > 0) {
          credentials = storeEnvVarsInKeychain(id, credentials);
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
        if (!opts?.silent) {
          track('connection_added', { provider_kind: providerKind(conn.provider, conn.authMethod) });
        }
        return id;
      },

      updateConnection: (id, updates) => {
        // Re-auth flows may hand us fresh env-var values — route them through the
        // keychain exactly like addConnection does.
        let patched = updates;
        const creds = updates.credentials;
        if (creds && creds.type === 'agent_managed' && creds.envVars && Object.keys(creds.envVars).length > 0) {
          patched = { ...updates, credentials: storeEnvVarsInKeychain(id, creds) };
        }
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === id ? { ...c, ...patched } : c
          ),
        }));
        log.debug('connections', 'Connection updated', { id, fields: Object.keys(updates) });
      },

      removeConnection: (id) => {
        const conn = get().connections.find((c) => c.id === id);
        set((state) => ({
          connections: state.connections.filter((c) => c.id !== id),
        }));
        // Clean up keychain entries (api_key + any env-var secrets)
        invoke('delete_credential', { service: `notesage:${id}` })
          .catch((e) => log.error('connections', 'Failed to delete credential from keychain', { id, error: String(e) }));
        if (conn?.credentials?.type === 'agent_managed') {
          const keys = conn.credentials.envVarKeys ?? Object.keys(conn.credentials.envVars ?? {});
          for (const key of keys) {
            invoke('delete_credential', { service: `notesage:${id}:env:${key}` })
              .catch((e) => log.error('connections', 'Failed to delete env credential from keychain', { id, key, error: String(e) }));
          }
        }
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
      partialize: (state) => ({
        ...state,
        connections: state.connections.map(stripSecretsForPersist),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Migrate legacy plaintext env vars (persisted before the keychain-backed
        // EnvVar flow) into the OS keychain. The values stay on the in-memory
        // connection for this session; the next persist strips them via partialize.
        const needsEnvMigration = state.connections.some(
          (c) => c.credentials?.type === 'agent_managed' && c.credentials.envVars && Object.keys(c.credentials.envVars).length > 0
        );
        if (needsEnvMigration) {
          const migrated = state.connections.map((c) => {
            if (c.credentials?.type === 'agent_managed' && c.credentials.envVars && Object.keys(c.credentials.envVars).length > 0) {
              return { ...c, credentials: storeEnvVarsInKeychain(c.id, c.credentials) };
            }
            return c;
          });
          useConnectionsStore.setState({ connections: migrated });
          log.info('connections', 'Migrated agent env vars from localStorage to keychain');
        }
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
