import { useState, useEffect, useMemo, useCallback } from "react";
import {
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type { SymbolSearchConfig, SymbolOccurrence } from "@/lib/command-palette";
import { getSearchPaths } from "@/lib/command-palette";

interface SymbolSearchResultsProps {
  config: SymbolSearchConfig;
  query: string;
  open: boolean;
  drilldownName?: string;
  onSelect: (path: string, name: string, symbol: string, occurrence: number) => void;
}

export function SymbolSearchResults({
  config,
  query,
  open,
  drilldownName,
  onSelect,
}: SymbolSearchResultsProps) {
  const [drilldown, setDrilldown] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<SymbolOccurrence[]>([]);

  // Filter items by query
  const filteredItems = useMemo(() => {
    if (!open || drilldown) return [];
    const q = query.trim().toLowerCase();
    return config.allItems.filter((item) => !q || item.toLowerCase().includes(q));
  }, [open, query, config.allItems, drilldown]);

  // Reset drilldown when palette closes
  useEffect(() => {
    if (!open) {
      setDrilldown(null);
      setOccurrences([]);
    }
  }, [open]);

  // Exit drilldown when user edits the query (query no longer matches drilldown name)
  useEffect(() => {
    if (drilldown && query !== drilldown) {
      setDrilldown(null);
      setOccurrences([]);
    }
  }, [drilldown, query]);

  const handleItemSelect = useCallback(async (name: string) => {
    setDrilldown(name);
    try {
      const paths = getSearchPaths();
      if (paths.length > 0) {
        const results = await config.findOccurrences(name, paths);
        setOccurrences(results);
      }
    } catch (error) {
      console.error(`Failed to find ${config.labelSingular.toLowerCase()} occurrences:`, error);
    }
  }, [config]);

  // Auto-drilldown when opened with a specific name (e.g. from badge click)
  useEffect(() => {
    if (open && drilldownName) {
      handleItemSelect(drilldownName);
    }
  }, [open, drilldownName, handleItemSelect]);

  const Icon = config.icon;

  return (
    <>
      {/* Item list (top level) */}
      {!drilldown && filteredItems.length > 0 && (
        <CommandGroup heading={config.label}>
          {filteredItems.map((item) => {
            const fileCount = config.filesByItem[item]?.length ?? 0;
            return (
              <CommandItem
                key={`${config.prefix}-${item}`}
                value={`${config.prefix} ${item}`}
                onSelect={() => handleItemSelect(item)}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{item}</span>
                <span className="text-xs text-muted-foreground">
                  {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}

      {/* Drilldown: occurrences for a selected item */}
      {drilldown && occurrences.length > 0 && (
        <CommandGroup heading={`${config.prefix}${drilldown}`}>
          {occurrences.map((occ, idx) => (
            <CommandItem
              key={`${config.prefix}-occ-${occ.path}-${occ.line_number}-${idx}`}
              value={`${config.prefix} ${occ.file_name} ${occ.path} ${occ.snippet}`}
              onSelect={() => onSelect(occ.path, occ.file_name, drilldown, occ.occurrence_in_file)}
              className="flex-col items-start gap-0.5"
            >
              <div className="flex items-center gap-2 w-full">
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{occ.file_name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">:{occ.line_number}</span>
              </div>
              <span className="text-xs text-muted-foreground truncate w-full pl-6">{occ.snippet}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
