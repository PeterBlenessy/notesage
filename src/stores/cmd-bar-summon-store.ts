/**
 * cmd-bar-summon-store — durable "open the command bar" intent.
 *
 * Why a store and not the `cmd-bar-events` bus: the bus is fire-and-forget and
 * its only subscriber lives inside `FloatingCommandBar`. If the bar's
 * ErrorBoundary trips and it unmounts, a summon emitted on the bus is lost —
 * leaving every summon chord (⌘K, ⌘⇧F, ⌘1-4, ⌘⇧P, double-⌘) dead exactly when
 * the user most needs to reopen the bar.
 *
 * The App-root dispatcher (`useGlobalShortcuts`, always mounted) writes the
 * intent here instead. `FloatingCommandBar` subscribes on `nonce`, applies its
 * expand/prefix/drilldown logic, and calls `consume()`. Because the intent
 * lives in durable state, a bar that unmounts and remounts reads the live
 * `pending` summon and applies it — the summon survives the crash.
 *
 * Only the *summon* path moves here. Transient, bar-mounted-only intents
 * (dismiss / toggle-pin / toggle-history / close) stay on `cmd-bar-events`.
 */
import { create } from "zustand";

import type { CmdBarEvent } from "@/lib/cmd-bar-events";

/** A summon mirrors the `focus` variant of CmdBarEvent. */
export interface CmdBarSummon {
  prefix?: string;
  drilldown?: Extract<CmdBarEvent, { type: "focus" }>["drilldown"];
  /** Monotonic counter so repeated identical summons still trigger the
   *  subscriber's effect (changing reference + value). */
  nonce: number;
}

interface CmdBarSummonState {
  pending: CmdBarSummon | null;
  /** Request the command bar to open (optionally seeded with a prefix /
   *  drilldown). Bumps the nonce so identical back-to-back summons re-fire. */
  summon: (intent?: Omit<CmdBarSummon, "nonce">) => void;
  /** Called by FloatingCommandBar once it has applied the pending summon. */
  consume: () => void;
}

export const useCmdBarSummonStore = create<CmdBarSummonState>((set, get) => ({
  pending: null,
  summon: (intent) =>
    set({ pending: { ...intent, nonce: (get().pending?.nonce ?? 0) + 1 } }),
  consume: () => set({ pending: null }),
}));
