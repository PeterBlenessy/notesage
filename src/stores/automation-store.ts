// Automation registry — a cache of the on-disk YAML automations (the files are
// authoritative). NOT persisted: the Rust scheduler reads `enabled` straight
// from each file, so per-automation enable/arm state lives in the YAML, not in
// localStorage overrides; `useAutomationDiscovery` repopulates this on startup.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #3)

import { create } from 'zustand';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import type { Automation } from '@/lib/automations/types';

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
}

type AutomationStore = AutomationStoreState & AutomationStoreActions;

function inScope(scope: string | undefined, selected?: string[]): boolean {
  if (scope == null || scope === 'global') return true;
  if (!selected) return true; // no selection filter → include everything
  return selected.includes(scope);
}

export const useAutomationStore = create<AutomationStore>()((set, get) => ({
  automations: [],
  invalid: [],
  baseDirs: [],
  isScanning: false,
  lastScanTimestamp: 0,

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
    const { baseDirs } = get();
    await get().scan(baseDirs);
    try {
      await tauriApi.reloadAutomationSchedule(baseDirs);
    } catch (e) {
      log.error('automations', 'reload after delete failed', e);
    }
  },
}));
