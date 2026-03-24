import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { log } from '@/lib/logger';

import type { AICapability, Connection, UseCaseSlot, UseCaseRouting } from '@/lib/ai/connections';
import { EMPTY_ROUTING } from '@/lib/ai/connections';
import { useConnectionsStore } from './connections-store';

interface RoutingStore {
  routing: UseCaseRouting;

  setRouting: (useCase: AICapability, connectionId: string | null) => void;
  setUseCaseModel: (useCase: AICapability, model: string | undefined) => void;
  getConnectionForUseCase: (useCase: AICapability) => Connection | null;
  getModelForUseCase: (useCase: AICapability) => string | undefined;
  autoAssign: (connectionId: string) => void;
  clearRoutingForConnection: (connectionId: string) => void;
}

/**
 * Migrate old routing format (string | null per slot) to new UseCaseSlot format.
 * Detects the old format by checking if a slot is a string or null instead of an object.
 */
function migrateRouting(raw: unknown): UseCaseRouting {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ROUTING };

  const obj = raw as Record<string, unknown>;
  const result: UseCaseRouting = { ...EMPTY_ROUTING };

  for (const key of ['interactive', 'agent_tasks', 'inline_completion'] as AICapability[]) {
    const val = obj[key];
    if (val === null || val === undefined) {
      result[key] = { connectionId: null };
    } else if (typeof val === 'string') {
      // Old format: plain connection ID string
      result[key] = { connectionId: val };
    } else if (typeof val === 'object' && val !== null && 'connectionId' in val) {
      // New format: UseCaseSlot object
      result[key] = val as UseCaseSlot;
    } else {
      result[key] = { connectionId: null };
    }
  }

  return result;
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    (set, get) => ({
      routing: { ...EMPTY_ROUTING },

      setRouting: (useCase, connectionId) => {
        set((state) => ({
          routing: {
            ...state.routing,
            [useCase]: { connectionId, model: undefined },
          },
        }));
        const conn = connectionId ? useConnectionsStore.getState().getConnection(connectionId) : null;
        log.debug('routing', `Route assigned: ${useCase} → ${conn?.provider ?? 'none'}`, { connectionId });
      },

      setUseCaseModel: (useCase, model) =>
        set((state) => ({
          routing: {
            ...state.routing,
            [useCase]: { ...state.routing[useCase], model },
          },
        })),

      getConnectionForUseCase: (useCase) => {
        const slot = get().routing[useCase];
        if (!slot?.connectionId) return null;
        return useConnectionsStore.getState().getConnection(slot.connectionId) ?? null;
      },

      getModelForUseCase: (useCase) => {
        return get().routing[useCase]?.model;
      },

      /**
       * Auto-assign a connection to empty routing slots based on its capabilities.
       * Does NOT override existing assignments — only fills null slots.
       */
      autoAssign: (connectionId) => {
        const connection = useConnectionsStore.getState().getConnection(connectionId);
        if (!connection) return;

        const assigned: string[] = [];
        set((state) => {
          const updated = { ...state.routing };
          for (const capability of connection.capabilities) {
            if (!updated[capability]?.connectionId) {
              updated[capability] = { connectionId };
              assigned.push(capability);
            }
          }
          return { routing: updated };
        });
        if (assigned.length > 0) {
          log.info('routing', `Auto-assigned ${connection.provider} to: ${assigned.join(', ')}`, { connectionId });
        }
      },

      /** Clear all routing slots that reference a given connection ID */
      clearRoutingForConnection: (connectionId) =>
        set((state) => {
          const updated = { ...state.routing };
          for (const key of Object.keys(updated) as AICapability[]) {
            if (updated[key]?.connectionId === connectionId) {
              updated[key] = { connectionId: null };
            }
          }
          return { routing: updated };
        }),
    }),
    {
      name: 'notesage-routing',

      version: 1,
      migrate: (persisted, version) => {
        if (version === 0 || version === undefined) {
          // Migrate from v0 (string | null) to v1 (UseCaseSlot)
          const state = persisted as { routing?: unknown };
          return {
            ...state,
            routing: migrateRouting(state?.routing),
          };
        }
        return persisted as RoutingStore;
      },
    }
  )
);
