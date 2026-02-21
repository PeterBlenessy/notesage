import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICapability, Connection, UseCaseRouting } from '@/lib/ai/connections';
import { EMPTY_ROUTING } from '@/lib/ai/connections';
import { useConnectionsStore } from './connections-store';

interface RoutingStore {
  routing: UseCaseRouting;

  setRouting: (useCase: AICapability, connectionId: string | null) => void;
  getConnectionForUseCase: (useCase: AICapability) => Connection | null;
  autoAssign: (connectionId: string) => void;
  clearRoutingForConnection: (connectionId: string) => void;
}

export const useRoutingStore = create<RoutingStore>()(
  persist(
    (set, get) => ({
      routing: { ...EMPTY_ROUTING },

      setRouting: (useCase, connectionId) =>
        set((state) => ({
          routing: { ...state.routing, [useCase]: connectionId },
        })),

      getConnectionForUseCase: (useCase) => {
        const connectionId = get().routing[useCase];
        if (!connectionId) return null;
        return useConnectionsStore.getState().getConnection(connectionId) ?? null;
      },

      /**
       * Auto-assign a connection to empty routing slots based on its capabilities.
       * Does NOT override existing assignments — only fills null slots.
       */
      autoAssign: (connectionId) => {
        const connection = useConnectionsStore.getState().getConnection(connectionId);
        if (!connection) return;

        set((state) => {
          const updated = { ...state.routing };
          for (const capability of connection.capabilities) {
            if (updated[capability] === null) {
              updated[capability] = connectionId;
            }
          }
          return { routing: updated };
        });
      },

      /** Clear all routing slots that reference a given connection ID */
      clearRoutingForConnection: (connectionId) =>
        set((state) => {
          const updated = { ...state.routing };
          for (const key of Object.keys(updated) as AICapability[]) {
            if (updated[key] === connectionId) {
              updated[key] = null;
            }
          }
          return { routing: updated };
        }),
    }),
    { name: 'notesage-routing' }
  )
);
