// Automation registry — a cache of the on-disk YAML automations (the files are
// authoritative). NOT persisted: the Rust scheduler reads `enabled` straight
// from each file, so per-automation enable/arm state lives in the YAML, not in
// localStorage overrides; `useAutomationDiscovery` repopulates this on startup.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #3)

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { usePermissionStore } from '@/stores/permission-store';
import type { Automation, AutomationRun } from '@/lib/automations/types';

/** Per-automation run-history retention. `RUNS_CAP` is the kept-real-runs limit
 *  — it MUST exceed the largest sane `maxRunsPerDay` so the durable daily cap
 *  (which counts today's non-skipped runs from this history) stays accurate
 *  across restarts (M3). Skipped/blocked entries are capped separately so a
 *  burst of them can never evict the real runs the cap counts. */
const RUNS_CAP = 100;
const SKIPPED_CAP = 15;
const RUNS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A file that failed to parse/validate — surfaced in the Automations panel. */
export interface InvalidAutomation {
  path: string;
  error: string;
}

interface AutomationStoreState {
  /** Valid, parsed automations across all scanned scopes (each carries `scope`). */
  automations: Automation[];
  /** Malformed files (broken YAML / failed validation). */
  invalid: InvalidAutomation[];
  /** The base dirs of the last scan — reused to refresh after save/delete. */
  baseDirs: string[];
  isScanning: boolean;
  lastScanTimestamp: number;
  /** Durable per-automation run history, keyed by `sourcePath` (persisted). */
  runsByAutomation: Record<string, AutomationRun[]>;
}

interface AutomationStoreActions {
  /** Automations visible for the given project selection: `global` always, plus
   *  any whose `scope` is in `selectedProjectPaths` (undefined = no filter). */
  getScopedAutomations: (selectedProjectPaths?: string[]) => Automation[];
  getAutomationByPath: (sourcePath: string) => Automation | undefined;

  /** Discover automations across `baseDirs` (global + per-project dirs). */
  scan: (baseDirs: string[]) => Promise<void>;
  /** Write a YAML definition, then re-scan and reload the schedule. */
  save: (sourcePath: string, yaml: string) => Promise<void>;
  /** Delete a definition, then re-scan and reload the schedule. */
  remove: (sourcePath: string) => Promise<void>;
  /** Toggle a single automation's `enabled` flag in its YAML, then reload.
   *  A targeted line-edit (preserves comments/formatting) rather than a
   *  full re-serialize — the form builder owns full serialization. */
  setEnabled: (sourcePath: string, enabled: boolean) => Promise<void>;

  // --- Runs history (written by the runner, Task #7) ---
  /** Insert a new run (deduped by `runId`), capped + TTL-pruned per automation. */
  recordRun: (run: AutomationRun) => void;
  /** Patch an existing run in place (streaming status / step updates). */
  updateRun: (sourcePath: string, runId: string, patch: Partial<AutomationRun>) => void;
  getRuns: (sourcePath: string) => AutomationRun[];
}

type AutomationStore = AutomationStoreState & AutomationStoreActions;

function inScope(scope: string | undefined, selected?: string[]): boolean {
  if (scope == null || scope === 'global') return true;
  if (!selected) return true; // no selection filter → include everything
  return selected.includes(scope);
}

export const useAutomationStore = create<AutomationStore>()(
  persist(
    (set, get) => ({
  automations: [],
  invalid: [],
  baseDirs: [],
  isScanning: false,
  lastScanTimestamp: 0,
  runsByAutomation: {},

  getScopedAutomations: (selectedProjectPaths) =>
    get().automations.filter((a) => inScope(a.scope, selectedProjectPaths)),

  getAutomationByPath: (sourcePath) =>
    get().automations.find((a) => a.sourcePath === sourcePath),

  scan: async (baseDirs) => {
    set({ isScanning: true, baseDirs });
    try {
      const files = await tauriApi.listAutomations(baseDirs);
      const automations: Automation[] = [];
      const invalid: InvalidAutomation[] = [];
      for (const f of files) {
        if (f.valid && f.automation) {
          automations.push(f.automation);
        } else {
          invalid.push({ path: f.path, error: f.error ?? 'invalid automation' });
        }
      }
      set({ automations, invalid, isScanning: false, lastScanTimestamp: Date.now() });
    } catch (e) {
      log.error('automations', 'scan failed', e);
      set({ isScanning: false });
    }
  },

  save: async (sourcePath, yaml) => {
    await tauriApi.saveAutomation(sourcePath, yaml);
    const { baseDirs } = get();
    await get().scan(baseDirs);
    try {
      await tauriApi.reloadAutomationSchedule(baseDirs);
    } catch (e) {
      log.error('automations', 'reload after save failed', e);
    }
  },

  remove: async (sourcePath) => {
    await tauriApi.deleteAutomation(sourcePath);
    // Clear the arm record so a later automation at the same path can't inherit it.
    usePermissionStore.getState().disarmAutomation(sourcePath);
    const { baseDirs } = get();
    await get().scan(baseDirs);
    try {
      await tauriApi.reloadAutomationSchedule(baseDirs);
    } catch (e) {
      log.error('automations', 'reload after delete failed', e);
    }
  },

  setEnabled: async (sourcePath, enabled) => {
    let raw = '';
    try {
      raw = await tauriApi.readFile(sourcePath);
    } catch (e) {
      log.error('automations', 'read for enable toggle failed', e);
      return;
    }
    const line = `enabled: ${enabled}`;
    const next = /^enabled:[ \t]*.*$/m.test(raw)
      ? raw.replace(/^enabled:[ \t]*.*$/m, line)
      : `${line}\n${raw}`;
    await get().save(sourcePath, next);
  },

  recordRun: (run) =>
    set((state) => {
      const now = Date.now();
      const existing = state.runsByAutomation[run.sourcePath] ?? [];
      const merged = [run, ...existing.filter((r) => r.runId !== run.runId)].filter(
        (r) => now - r.startedAt < RUNS_TTL_MS,
      );
      // Cap real and skipped entries independently (newest-first), then re-merge
      // by recency — so skipped/blocked records never push real runs out of the
      // history the durable daily cap counts from (M3).
      const real = merged.filter((r) => r.status !== 'skipped').slice(0, RUNS_CAP);
      const skipped = merged.filter((r) => r.status === 'skipped').slice(0, SKIPPED_CAP);
      const next = [...real, ...skipped].sort((a, b) => b.startedAt - a.startedAt);
      return {
        runsByAutomation: { ...state.runsByAutomation, [run.sourcePath]: next },
      };
    }),

  updateRun: (sourcePath, runId, patch) =>
    set((state) => {
      const list = state.runsByAutomation[sourcePath];
      if (!list) return {};
      const next = list.map((r) => (r.runId === runId ? { ...r, ...patch } : r));
      return { runsByAutomation: { ...state.runsByAutomation, [sourcePath]: next } };
    }),

  getRuns: (sourcePath) => get().runsByAutomation[sourcePath] ?? [],
    }),
    {
      name: 'notesage-automations',
      storage: createTauriStorage(),
      version: 1,
      // Persist only the durable run history — definitions are re-scanned from disk.
      partialize: (state) => ({ runsByAutomation: state.runsByAutomation }),
    }
  )
);
