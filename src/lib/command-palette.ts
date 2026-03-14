import type { LucideIcon } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

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

export function getSearchPaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  const paths: string[] = [];
  for (const folder of ws.explorerFolders) paths.push(folder.path);
  for (const project of ws.projects) paths.push(project.path);
  if (settings.notesRootPath) paths.push(settings.notesRootPath);
  return paths;
}
