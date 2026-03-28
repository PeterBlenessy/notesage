import { useState, useEffect, useCallback, useRef } from "react";
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
  onSelect: (path: string, name: string, symbol: string, occurrenceInFile: number) => void;
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
  const [items, setItems] = useState<{ name: string; fileCount: number }[]>([]);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch items from index when query changes (debounced)
  useEffect(() => {
    if (!open || drilldown) {
      setItems([]);
      return;
    }

    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    const fetchStartTotal = performance.now();
    fetchTimerRef.current = setTimeout(async () => {
      try {
        const paths = getSearchPaths();
        const q = query.trim();
        const modeName = config.label.toLowerCase() as 'tags' | 'mentions';
        const ipcStart = performance.now();
        const results = await config.fetchItems(q || "", paths);
        console.log('[perf:palette] ipc', { mode: modeName, ms: Math.round(performance.now() - ipcStart) });
        setItems(results);
        console.log('[perf:palette]', { mode: modeName, query: q, resultCount: results.length, ms: Math.round(performance.now() - fetchStartTotal) });
      } catch (error) {
        console.error(`Failed to fetch ${config.label.toLowerCase()}:`, error);
        setItems([]);
      }
    }, 100);

    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
  }, [open, query, config, drilldown]);

  // Reset when palette closes
  useEffect(() => {
    if (!open) {
      setDrilldown(null);
      setOccurrences([]);
      setItems([]);
    }
  }, [open]);

  const handleItemSelect = useCallback(async (name: string) => {
    setDrilldown(name);
    try {
      const paths = getSearchPaths();
      if (paths.length > 0) {
        const modeName = config.label.toLowerCase() as 'tags' | 'mentions';
        const ipcStart = performance.now();
        const results = await config.findOccurrences(name, paths);
        console.log('[perf:palette] ipc', { mode: modeName, ms: Math.round(performance.now() - ipcStart) });
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

  // Drilldown exits only when:
  // - The palette closes (handled by the open effect above)
  // - Auto-drilldown from badge click re-opens with a new name
  // Do NOT exit drilldown based on query text — the query is always empty
  // in prefix modes (#, @) since the prefix is stripped.

  const Icon = config.icon;

  return (
    <>
      {/* Item list (top level) */}
      {!drilldown && items.length > 0 && (
        <CommandGroup heading={config.label}>
          {items.map((item) => (
            <CommandItem
              key={`${config.prefix}-${item.name}`}
              value={`${config.prefix} ${item.name}`}
              onSelect={() => handleItemSelect(item.name)}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 truncate">{item.name}</span>
              <span className="text-xs text-muted-foreground">
                {item.fileCount} {item.fileCount === 1 ? "file" : "files"}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {/* Drilldown: occurrences for a selected item */}
      {drilldown && occurrences.length > 0 && (
        <CommandGroup heading={`${config.prefix}${drilldown}`}>
          {occurrences.map((occ, idx) => (
            <CommandItem
              key={`${config.prefix}-occ-${occ.path}-${idx}`}
              value={`${config.prefix} ${occ.file_name} ${occ.path} ${occ.context_before}`}
              onSelect={() => {
                // Count how many occurrences of this symbol in the same file appear before this one
                const occurrenceInFile = occurrences.slice(0, idx).filter(o => o.path === occ.path).length;
                onSelect(occ.path, occ.file_name, `${config.prefix}${drilldown}`, occurrenceInFile);
              }}
              className="flex-col items-start gap-0.5"
            >
              <div className="flex items-center gap-2 w-full">
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{occ.file_name}</span>
              </div>
              {occ.context_before && (
                <span className="text-xs text-muted-foreground truncate w-full pl-6">
                  ...{occ.context_before}<strong>{config.prefix}{drilldown}</strong>{occ.context_after}...
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
