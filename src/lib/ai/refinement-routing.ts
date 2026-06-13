import { useRoutingStore } from '@/stores/routing-store';
import type { AICapability, Connection } from '@/lib/ai/connections';

/**
 * Refinement provider resolver.
 *
 * The ambient-action refinement engine is agent-agnostic: it reads the
 * connection assigned to a use-case slot rather than hardcoding a provider.
 *
 * For v1 there is NO dedicated `refinement` slot in `routing-store` — adding one
 * would require an `AICapability` migration (PRD `2026-06-13-ambient-action-refinement.md`,
 * Open Q#2). The refinement engine therefore REUSES the `agent_tasks` slot, the
 * semantically closest existing slot (delegated background analysis).
 *
 * The slot source is kept behind this single constant so a future dedicated
 * `refinement` slot is a one-line change here — every consumer (the engine, the
 * watcher, the Settings display hook) reads through the helpers below.
 */
const REFINEMENT_SLOT: AICapability = 'agent_tasks';

/**
 * Resolve the connection the refinement engine should use, non-reactively.
 *
 * Safe to call from outside React (the engine / watcher) — reads the routing
 * store imperatively via `getState()`. Returns `null` when the slot is empty or
 * references a connection that no longer exists.
 */
export function resolveRefinementConnection(): Connection | null {
  return useRoutingStore.getState().getConnectionForUseCase(REFINEMENT_SLOT);
}

/**
 * Reactive variant for UI (e.g. a Settings display in a later task). Subscribes
 * to the same slot's connection so the component re-renders when the routing
 * assignment changes.
 */
export function useRefinementConnection(): Connection | null {
  return useRoutingStore((s) => {
    const slot = s.routing[REFINEMENT_SLOT];
    if (!slot?.connectionId) return null;
    return s.getConnectionForUseCase(REFINEMENT_SLOT);
  });
}
