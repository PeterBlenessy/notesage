import { create } from "zustand";
import { persist } from "zustand/middleware";
import { flagIds, isKnownFlag, type FlagId } from "@/lib/flags";

/**
 * Which Labs flags the user has switched on.
 *
 * Deliberately its own store rather than a slice of `settings-store` (PRD
 * open question, resolved): a corrupted or hand-edited settings blob must not
 * be able to enable unfinished behaviour, and flag ids come and go on a
 * different clock from settings keys, so they need their own migration story.
 *
 * Persisted state is filtered through the registry on rehydrate — a flag that
 * has since graduated or been removed cannot resurrect from an old blob.
 */
/**
 * Reports a flag change for the graduation signal.
 *
 * Injected rather than imported, because this store is reachable from the iOS
 * shell and `lib/telemetry` must NOT be — the mobile app is telemetry-free by
 * construction and its App Store "Data Not Collected" answer rests on that,
 * locked by `telemetry-unreachable.test.ts` (which scans dynamic imports too,
 * so a lazy import would not have helped). The desktop root registers the
 * real reporter; mobile registers nothing and therefore emits nothing.
 */
type FlagReporter = (flag: string, enabled: boolean) => void;

let reporter: FlagReporter | null = null;

/** Desktop-only. Called once at startup. */
export function setFlagReporter(fn: FlagReporter | null): void {
  reporter = fn;
}

interface FlagStore {
  /** Only ENABLED flags are stored. Absence means off, which keeps the
   *  persisted shape honest as ids are added and removed. */
  enabled: FlagId[];

  isEnabled: (id: FlagId) => boolean;
  setEnabled: (id: FlagId, on: boolean) => void;
  /** Any flag on at all — the condition the telemetry default follows. */
  anyEnabled: () => boolean;
  /** One obvious way back for a user who has broken something. */
  resetAll: () => void;
}

export const useFlagStore = create<FlagStore>()(
  persist(
    (set, get) => ({
      enabled: [],

      isEnabled: (id) => get().enabled.includes(id),

      setEnabled: (id, on) => {
        if (get().isEnabled(id) === on) return;
        set((s) => ({
          enabled: on ? [...s.enabled, id] : s.enabled.filter((f) => f !== id),
        }));
        // Reported from the STORE so every route into a flag is covered, not
        // just the Labs switch. The reporter is a no-op while telemetry is
        // off, and turning the first flag ON is itself what flips the
        // default — so this is the first event a new Labs user sends.
        reporter?.(id, on);
      },

      anyEnabled: () => get().enabled.length > 0,

      resetAll: () => {
        // Report each one: a bulk reset is a strong signal about the
        // features that were on, and collapsing it to a single event would
        // lose exactly the information graduation needs.
        for (const id of get().enabled) reporter?.(id, false);
        set({ enabled: [] });
      },
    }),
    {
      name: "notesage-flags",
      partialize: (s) => ({ enabled: s.enabled }),
      merge: (persisted, current) => {
        const raw = (persisted as { enabled?: unknown })?.enabled;
        const known = new Set<string>(flagIds());
        return {
          ...current,
          enabled: Array.isArray(raw)
            ? (raw.filter((id): id is FlagId => typeof id === "string" && isKnownFlag(id) && known.has(id)))
            : [],
        };
      },
    },
  ),
);

/** Non-React reader, for stores and lib code that cannot use a hook. */
export function isFlagEnabled(id: FlagId): boolean {
  return useFlagStore.getState().isEnabled(id);
}

/** React reader. Subscribes to just this flag. */
export function useFlag(id: FlagId): boolean {
  return useFlagStore((s) => s.enabled.includes(id));
}
