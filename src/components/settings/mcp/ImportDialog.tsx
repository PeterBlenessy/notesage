import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { joinCommandLine } from './command-line';
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
import { filterValidMcpConfigs } from '@/lib/mcp/config-guards';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { McpConfigUnreadableError, readMcpServersForUpdate } from './mcp-config-file';

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

/**
 * Why a discovered entry cannot be imported as it stands: a remote server
 * with no URL, or a local one with no command. Saving either would add a
 * server that can never start.
 */
function importProblem(server: McpServerEntry): 'no-url' | 'no-command' | null {
  if (server.transport === 'http') return server.url?.trim() ? null : 'no-url';
  return server.command.trim() ? null : 'no-command';
}

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
        // A remote server is its transport and URL (and often an API-key
        // header); without them it would be saved as a local server with no
        // command.
        transport: c.transport ?? 'stdio',
        url: c.url ?? null,
        headers: c.headers ?? {},
        cwd: c.cwd ?? null,
      }));

      setDiscoveredServers(entries);
      // An entry that cannot run as it stands is listed, but not imported.
      setSelectedIds(new Set(entries.filter((e) => !importProblem(e)).map((e) => e.id)));
    } catch (err) {
      toast.error(`Failed to scan ${sourceId}: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const selected = discoveredServers.filter((s) => selectedIds.has(s.id) && !importProblem(s));

      // Build config entries for saving
      const configs: Record<string, Record<string, unknown>> = {};
      for (const server of selected) {
        const entry: Record<string, unknown> =
          server.transport === 'http'
            ? { transport: 'http', url: server.url, headers: server.headers ?? {}, env: server.env }
            : { command: server.command, args: server.args, env: server.env };
        if (server.cwd) entry.cwd = server.cwd;
        configs[server.name] = entry;
      }

      // Read existing global config
      const home = await invoke<string>('get_home_dir');
      const configPath = `${home}/.notesage/mcp.json`;
      // The file is user-editable. A missing file starts fresh; a half-written
      // or hand-edited one throws, so the save below (which rewrites the whole
      // file) cannot delete the servers already in it.
      const existing = await readMcpServersForUpdate(configPath);

      // Merge
      const merged = { ...existing, ...configs };
      await invoke('mcp_save_config', { path: configPath, configs: merged });

      toast.success(`Imported ${selected.length} server${selected.length !== 1 ? 's' : ''}`);
      requestRescan();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof McpConfigUnreadableError) {
        toast.error(t("mcp.configUnreadable"));
      } else {
        toast.error(`Failed to import: ${err}`);
      }
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
          <DialogTitle>{t("mcp.importTitle")}</DialogTitle>
          <DialogDescription>{t("mcp.importSubtitle")}</DialogDescription>
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
                          <p className="text-xs text-muted-foreground">{t("mcp.notInstalled")}</p>
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
              <span className="text-sm text-muted-foreground ml-2">{t("imp.scanning")}</span>
            </div>
          )}

          {selectedSource && !loading && discoveredServers.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">{t("mcp.noServersFound")}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setSelectedSource(null)}
              >
                {t("imp.tryAnother")}
              </Button>
            </div>
          )}

          {selectedSource && !loading && discoveredServers.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t("imp.foundServers", { count: discoveredServers.length })}
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto thin-scrollbar">
                {discoveredServers.map((server) => {
                  const remote = server.transport === 'http';
                  const problem = importProblem(server);
                  return (
                    <label
                      key={server.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg border border-border transition-colors',
                        problem ? 'opacity-70' : 'hover:border-muted-foreground cursor-pointer',
                      )}
                    >
                      <Checkbox
                        checked={selectedIds.has(server.id)}
                        onCheckedChange={() => toggleId(server.id)}
                        disabled={!!problem}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{server.name}</span>
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                            {remote ? t("common.remote") : t("conns.local")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {remote ? (server.url ?? '') : joinCommandLine([server.command, ...server.args])}
                        </p>
                        {problem && (
                          <p className="text-xs text-destructive">
                            {problem === 'no-url' ? t("imp.skipNoUrl") : t("imp.skipNoCommand")}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t("imp.importedOffHint")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {selectedSource && (
            <Button variant="outline" onClick={() => setSelectedSource(null)}>
              {t("connect.back")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {selectedSource && discoveredServers.length > 0 && (
            <Button onClick={handleImport} disabled={importing || selectedIds.size === 0}>
              {importing ? t("common.importing") : `Import ${selectedIds.size} Server${selectedIds.size !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
