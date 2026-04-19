import type { LucideIcon } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";

// ---------------------------------------------------------------------------
// Palette mode type & prefix map
// ---------------------------------------------------------------------------

export type PaletteMode = "default" | "files" | "tags" | "mentions" | "commands" | "research";

export const PREFIX_MAP: Record<string, PaletteMode> = {
  "#": "tags",
  "@": "mentions",
  ">": "commands",
  "?": "research",
};

const MODE_TO_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(PREFIX_MAP).map(([k, v]) => [v, k])
);

/**
 * Derive the palette mode from the current input text.
 * `externalMode` overrides for modes not triggered by prefix (e.g. `files`).
 */
export function deriveMode(input: string, externalMode?: PaletteMode): PaletteMode {
  if (externalMode === "files") return "files";
  for (const [prefix, mode] of Object.entries(PREFIX_MAP)) {
    if (input.startsWith(prefix)) return mode;
  }
  return "default";
}

/**
 * Strip the mode prefix from the input to get the search query.
 */
export function getQuery(input: string, mode: PaletteMode): string {
  const prefix = MODE_TO_PREFIX[mode];
  return prefix && input.startsWith(prefix) ? input.slice(prefix.length) : input;
}

/**
 * Get the prefix character for a mode (undefined for default/files).
 */
export function getPrefixForMode(mode: PaletteMode): string | undefined {
  return MODE_TO_PREFIX[mode];
}

// ---------------------------------------------------------------------------
// Placeholder map
// ---------------------------------------------------------------------------

export function getPlaceholder(mode: PaletteMode, fileCount: number, drilldownName?: string): string {
  switch (mode) {
    case "default":
      return fileCount > 0
        ? `Type a command or search ${fileCount.toLocaleString()} files...`
        : "Type a command or file name...";
    case "files":
      return `Search ${fileCount.toLocaleString()} files by name or content...`;
    case "tags":
      return drilldownName
        ? `Filter #${drilldownName} occurrences...`
        : "Search tags...";
    case "mentions":
      return drilldownName
        ? `Filter @${drilldownName} occurrences...`
        : "Search mentions...";
    case "commands":
      return "Search commands...";
    case "research":
      return "Search research...";
  }
}

// ---------------------------------------------------------------------------
// Unified symbol occurrence type
// ---------------------------------------------------------------------------

export interface SymbolOccurrence {
  path: string;
  file_name: string;
  context_before: string;
  context_after: string;
}

export interface SymbolSearchConfig {
  prefix: string;
  label: string;
  labelSingular: string;
  icon: LucideIcon;
  /** Fetch items matching query (async, hits index DB). */
  fetchItems: (query: string, paths: string[]) => Promise<{ name: string; fileCount: number }[]>;
  /** Fetch occurrences for a specific item (async, hits index DB). */
  findOccurrences: (name: string, paths: string[]) => Promise<SymbolOccurrence[]>;
}

// ---------------------------------------------------------------------------
// Shared search path helper
// ---------------------------------------------------------------------------

/**
 * All indexed workspace paths (explorer folders, projects, notes root).
 * This is the "universe" the palette and suggestion plugins can search over.
 */
export function getAllSearchPaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  const paths: string[] = [];
  for (const folder of ws.explorerFolders) paths.push(folder.path);
  for (const project of ws.projects) paths.push(project.path);
  if (settings.notesRootPath) paths.push(settings.notesRootPath);
  return paths;
}

/**
 * Scope describing which project roots a palette search covers.
 * - `'all'` — search every indexed workspace path.
 * - `string[]` — search only the given paths; empty array falls back to `'all'`.
 */
export type PaletteSearchScope = "all" | string[];

/**
 * Resolve a scope to a concrete list of paths.
 *
 * - `'all'` → all indexed workspace paths.
 * - `string[]` → intersects the requested paths with indexed paths so callers
 *   cannot leak outside known workspace folders. An empty intersection falls
 *   back to all indexed paths (prevents "no selection = no results" surprise).
 */
export function resolveSearchPaths(scope: PaletteSearchScope): string[] {
  const all = getAllSearchPaths();
  if (scope === "all") return all;
  if (!Array.isArray(scope) || scope.length === 0) return all;
  const allSet = new Set(all);
  const scoped = scope.filter((p) => allSet.has(p));
  return scoped.length > 0 ? scoped : all;
}

/**
 * Default scope for the command palette: the active chat conversation's
 * selected project paths, or `'all'` if none are selected.
 */
export function getDefaultPaletteScope(): PaletteSearchScope {
  const selected = selectProjectPaths(useChatStore.getState());
  return selected.length > 0 ? selected : "all";
}

/**
 * Convenience for callers that don't track a scope themselves.
 * Callers that track a scope (e.g. the palette's "Search all projects"
 * toggle) should call `resolveSearchPaths(scope)` directly.
 */
export function getSearchPaths(scope?: PaletteSearchScope): string[] {
  return resolveSearchPaths(scope ?? getDefaultPaletteScope());
}
