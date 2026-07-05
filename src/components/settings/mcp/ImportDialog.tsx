import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useMcpStore,
  type McpServerEntry,
} from '@/stores/mcp-store';
import { filterValidMcpConfigs, extractMcpServersRecord } from '@/lib/mcp/config-guards';
import { cn } from '@/lib/utils';

interface ImportSource {
  id: string;
  label: string;
  icon: string;
}

const IMPORT_SOURCES: ImportSource[] = [
  { id: 'claude-desktop', label: 'Claude Desktop', icon: 'C' },
  { id: 'cursor', label: 'Cursor', icon: 'Cu' },
  { id: 'vscode', label: 'VS Code', icon: 'VS' },
];

// Exported for tests (malformed-import validation coverage).
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [discoveredServers, setDiscoveredServers] = useState<McpServerEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const { requestRescan } = useMcpStore();

  // Check which sources are available on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    invoke<string[]>('mcp_check_import_sources')
      .then((sources) => setAvailableSources(sources ?? []))
      .catch(() => {});
  }, []);

  const handleSelectSource = async (sourceId: string) => {
    setSelectedSource(sourceId);
    setLoading(true);
    setDiscoveredServers([]);
    setSelectedIds(new Set());

    try {
      // Configs were parsed by Rust from OTHER TOOLS' config files (Claude
      // Desktop / Cursor / VS Code) — validate each entry at runtime instead
      // of asserting the shape with an `invoke<...>` type parameter.
      const raw = await invoke<unknown>('mcp_import_configs', { source: sourceId });
      const { configs, skipped } = filterValidMcpConfigs(raw, `mcp_import_configs (${sourceId})`);
      if (skipped > 0) {
        toast.warning(
          `Skipped ${skipped} malformed server entr${skipped === 1 ? 'y' : 'ies'} from ${sourceId}`,
        );
      }

      const entries: McpServerEntry[] = configs.map((c) => ({
        id: c.id,
        name: c.name,
        command: c.command,
        args: c.args,
        env: c.env,
        source: (sourceId === 'claude-desktop' ? 'claude-desktop' : sourceId) as McpServerEntry['source'],
        enabled: c.enabled,
        status: 'stopped' as const,
        tools: [],
      }));

      setDiscoveredServers(entries);
      setSelectedIds(new Set(entries.map((e) => e.id)));
    } catch (err) {
      toast.error(`Failed to scan ${sourceId}: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const selected = discoveredServers.filter((s) => selectedIds.has(s.id));

      // Build config entries for saving
      const configs: Record<string, { command: string; args: string[]; env: Record<string, unknown> }> = {};
      for (const server of selected) {
        configs[server.name] = {
          command: server.command,
          args: server.args,
          env: server.env,
        };
      }

      // Read existing global config
      const home = await invoke<string>('get_home_dir');
      const configPath = `${home}/.notesage/mcp.json`;
      let existing: Record<string, unknown> = {};
      try {
        const content = await invoke<string>('read_file', { path: configPath });
        // The file is user-editable — a half-written or hand-edited envelope
        // must degrade to an empty record, not crash the import.
        const parsed: unknown = JSON.parse(content);
        existing = extractMcpServersRecord(parsed);
      } catch {
        // File doesn't exist or contains invalid JSON
      }

      // Merge
      const merged = { ...existing, ...configs };
      await invoke('mcp_save_config', { path: configPath, configs: merged });

      toast.success(`Imported ${selected.length} server${selected.length !== 1 ? 's' : ''}`);
      requestRescan();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to import: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import MCP Servers</DialogTitle>
          <DialogDescription>Import MCP server configurations from other tools.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!selectedSource && (
            <div className="space-y-2">
              <div className="grid gap-2">
                {IMPORT_SOURCES.map((source) => {
                  const available = availableSources.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      onClick={() => available && handleSelectSource(source.id)}
                      disabled={!available}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        available
                          ? 'hover:border-muted-foreground cursor-pointer'
                          : 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                        {source.icon}
                      </div>
                      <div>
                        <span className="text-sm font-medium">{source.label}</span>
                        {!available && (
                          <p className="text-xs text-muted-foreground">Not installed</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedSource && loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm text-muted-foreground ml-2">Scanning...</span>
            </div>
          )}

          {selectedSource && !loading && discoveredServers.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No MCP servers found</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setSelectedSource(null)}
              >
                Try another source
              </Button>
            </div>
          )}

          {selectedSource && !loading && discoveredServers.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Found {discoveredServers.length} server{discoveredServers.length !== 1 ? 's' : ''}.
                Select which to import:
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto thin-scrollbar">
                {discoveredServers.map((server) => (
                  <label
                    key={server.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:border-muted-foreground transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(server.id)}
                      onCheckedChange={() => toggleId(server.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{server.name}</span>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {[server.command, ...server.args].join(' ')}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {selectedSource && (
            <Button variant="outline" onClick={() => setSelectedSource(null)}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {selectedSource && discoveredServers.length > 0 && (
            <Button onClick={handleImport} disabled={importing || selectedIds.size === 0}>
              {importing ? 'Importing...' : `Import ${selectedIds.size} Server${selectedIds.size !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
