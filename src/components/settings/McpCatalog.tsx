import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Search, Globe, TerminalSquare, ExternalLink, Plus, Boxes, ShieldCheck, KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { McpCatalogItem } from '@/stores/mcp-store';

interface McpCatalogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user picks a server to add. */
  onSelectItem: (item: McpCatalogItem) => void;
}

/**
 * "Browse catalog" picker — a searchable grid of curated MCP servers.
 *
 * The catalog ships EMPTY for now (PRD 2026-06-03): this component renders the
 * empty state until `src-tauri/mcp-catalog.json` is populated. Remote (`http`)
 * entries are shown but not yet addable — the remote transport lands in a later
 * task — so their button is disabled with an explanatory note.
 */
export function McpCatalog({ open, onOpenChange, onSelectItem }: McpCatalogProps) {
  const [items, setItems] = useState<McpCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<McpCatalogItem[]>('mcp_catalog_list')
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset the filter each time the dialog opens.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.name, it.description, it.category ?? '', it.id]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [items, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Browse MCP catalog</DialogTitle>
          <DialogDescription>
            Pick a server to add — its command and required settings are filled in for you.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers…"
            className="pl-8 text-sm"
            disabled={items.length === 0}
          />
        </div>

        <div className="max-h-96 overflow-y-auto -mx-1 px-1">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading catalog…</p>
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-destructive">Couldn’t load the catalog</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center rounded-lg border border-dashed border-border">
              <Boxes
                className="mx-auto h-6 w-6 text-muted-foreground"
                strokeWidth={1.5}
              />
              <p className="text-sm text-muted-foreground mt-2">The catalog is empty</p>
              <p className="text-xs text-muted-foreground mt-1">
                Curated servers will appear here. For now, use “Add” to enter a server manually,
                or “Import” to bring one in from another app.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No servers match “{query}”
            </p>
          ) : (
            <div className="space-y-1.5 py-1">
              {filtered.map((item) => (
                <CatalogCard key={item.id} item={item} onSelect={() => onSelectItem(item)} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CatalogCard({ item, onSelect }: { item: McpCatalogItem; onSelect: () => void }) {
  const isRemote = item.transport === 'http';
  const noKey = item.required_env.length === 0;
  const badgeClass = 'h-4 gap-1 px-1.5 text-xs font-normal';
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium truncate">{item.name}</span>
          {item.official && (
            <Badge variant="secondary" className={badgeClass}>
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={1.5} />
              Official
            </Badge>
          )}
          <Badge variant="secondary" className={badgeClass}>
            {isRemote ? (
              <Globe className="h-2.5 w-2.5" strokeWidth={1.5} />
            ) : (
              <TerminalSquare className="h-2.5 w-2.5" strokeWidth={1.5} />
            )}
            {isRemote ? 'Remote' : 'Local'}
          </Badge>
          {item.category && (
            <Badge variant="outline" className={cn(badgeClass, 'text-muted-foreground')}>
              {item.category}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {noKey ? (
            <Badge variant="outline" className={cn(badgeClass, 'text-muted-foreground')}>
              No API key
            </Badge>
          ) : (
            item.required_env.map((e) => (
              <Badge key={e.key} variant="outline" className={cn(badgeClass, 'text-muted-foreground')}>
                <KeyRound className="h-2.5 w-2.5" strokeWidth={1.5} />
                {e.label || e.key}
              </Badge>
            ))
          )}
        </div>
        {item.homepage && (
          <Button
            variant="link"
            className="mt-1 h-auto gap-1 p-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openUrl(item.homepage!).catch(() => {})}
          >
            <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
            Learn more
          </Button>
        )}
        {isRemote && (
          <p className="text-xs text-muted-foreground mt-1">
            Remote servers need the upcoming remote-transport update.
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0"
        onClick={onSelect}
        disabled={isRemote}
      >
        <Plus className="h-3 w-3 mr-1" strokeWidth={1.5} />
        Add
      </Button>
    </div>
  );
}
