// Per-connection provider usage snapshots (provider-usage-display #6).
//
// DELIBERATELY NOT PERSISTED — usage is live state; a stale persisted quota or
// rate-limit warning is worse than none. The store is written through from the
// ACP `usage_update` listener (source: 'acp', confidence: 'exact') and, later,
// from the local estimation hook (source: 'estimate', confidence: 'estimated').
// It is the single source both UI layers (command-bar popover, Settings
// connection cards) read; the session-info singleton in `acp-agent-state.ts`
// remains the live-session fast path.

import { create } from 'zustand';
import type { ProviderUsageSnapshot, UsageConfidence } from '@/lib/ai/usage';

/**
 * A sparse usage write. `source` and `confidence` are mandatory — provenance is
 * load-bearing UI (the "Reported by agent" / "Estimated locally" footer), so
 * every writer must declare where its numbers came from.
 */
export type UsagePatch = Partial<
  Omit<ProviderUsageSnapshot, 'connectionId' | 'updatedAt' | 'source' | 'confidence'>
> & {
  source: ProviderUsageSnapshot['source'];
  confidence: UsageConfidence;
};

interface UsageStore {
  /** Latest snapshot per connection id. */
  snapshots: Record<string, ProviderUsageSnapshot>;
  /**
   * Merge a sparse patch into the connection's snapshot and stamp `updatedAt`.
   * Keys whose value is `undefined` are dropped from the patch first, so a
   * sparse write (e.g. a rate-limit-only update) never erases prior fields.
   */
  recordUsage: (connectionId: string, patch: UsagePatch) => void;
  /** Drop the snapshot for a connection (e.g. connection removed). */
  clearUsage: (connectionId: string) => void;
  getSnapshot: (connectionId: string) => ProviderUsageSnapshot | undefined;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  snapshots: {},

  recordUsage: (connectionId, patch) => {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as UsagePatch;
    set((state) => {
      const existing = state.snapshots[connectionId];
      // Provenance precedence: a local `estimate` write must never downgrade an
      // exact `acp` snapshot. Today the estimator structurally can't fire for
      // ACP connections (`getContextSize` returns undefined for agents), so this
      // is a guard against a future writer, not a live path — a stale estimate
      // clobbering "Reported by agent" provenance would mislead the UI footer.
      if (existing?.source === 'acp' && defined.source === 'estimate') {
        return state;
      }
      const next: ProviderUsageSnapshot = {
        ...existing,
        ...defined,
        connectionId,
        updatedAt: Date.now(),
      };
      return { snapshots: { ...state.snapshots, [connectionId]: next } };
    });
  },

  clearUsage: (connectionId) => {
    set((state) => {
      if (!(connectionId in state.snapshots)) return state;
      const next = { ...state.snapshots };
      delete next[connectionId];
      return { snapshots: next };
    });
  },

  getSnapshot: (connectionId) => get().snapshots[connectionId],
}));
