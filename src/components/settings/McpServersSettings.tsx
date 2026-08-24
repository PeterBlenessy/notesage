import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Plus, Download, Boxes, FolderSync } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  useMcpStore,
  type McpCatalogItem,
} from '@/stores/mcp-store';
import { refreshMcpServerStatus } from '@/hooks/useMcpOperations';
import { McpCatalog } from './McpCatalog';
import { cn } from '@/lib/utils';
import { McpServerCard } from './mcp/McpServerCard';
import { AddEditServerDialog } from './mcp/AddEditServerDialog';
import { ImportDialog } from './mcp/ImportDialog';
import type { CatalogPrefill } from './mcp/types';
import { t } from '@/lib/i18n';

// Re-exported so existing consumers/tests keep importing from this module path.
export { AddEditServerDialog } from './mcp/AddEditServerDialog';
export { ImportDialog } from './mcp/ImportDialog';
export type { CatalogPrefill } from './mcp/types';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function McpServersSettings() {
  const { servers } = useMcpStore();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [prefill, setPrefill] = useState<CatalogPrefill | undefined>(undefined);
  const [rescanSpinning, setRescanSpinning] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  const handleRescan = () => {
    useMcpStore.getState().requestRescan();
    setRescanSpinning(true);
    setTimeout(() => setRescanSpinning(false), 600);
  };

  // Fetch the backend snapshot (`mcp_get_server_status`) and reconcile each
  // card's running/stopped/tool-count state. Cheaper than a full rescan —
  // no config re-discovery, no server restarts.
  const handleRefreshStatus = async () => {
    setStatusRefreshing(true);
    try {
      await refreshMcpServerStatus();
    } catch (err) {
      toast.error(`Failed to refresh server status: ${err}`);
    } finally {
      setStatusRefreshing(false);
    }
  };

  // Catalog pick → close catalog, seed the Add dialog with the entry's template.
  const handleCatalogSelect = (item: McpCatalogItem) => {
    setPrefill({
      name: item.name,
      command: item.command ?? '',
      args: item.args,
      env: item.required_env.map((e) => ({ key: e.key, value: '', secret: e.secret })),
      transport: item.transport,
      url: item.url ?? null,
    });
    setCatalogOpen(false);
    setAddOpen(true);
  };

  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) setPrefill(undefined);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">{t("mcp.serversTitle")}</Label>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setCatalogOpen(true)}>
              <Boxes className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Catalog
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Import
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPrefill(undefined); setAddOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshStatus}
              disabled={statusRefreshing}
              aria-busy={statusRefreshing}
              aria-label={t("mcp.refreshStatus")}
              title={t("mcp.refreshStatusHint")}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', statusRefreshing && 'animate-spin')} strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRescan}
              disabled={rescanSpinning}
              aria-label={t("mcp.refreshServers")}
              title={t("mcp.refreshServersHint")}
            >
              <FolderSync className={cn('h-3.5 w-3.5', rescanSpinning && 'animate-spin')} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Connect external tool servers via the Model Context Protocol
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="px-4 py-8 text-center rounded-lg border border-dashed border-border">
          <p className="text-sm text-muted-foreground">{t("mcp.noServers")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Browse the catalog, add a server manually, or import from Claude Desktop, Cursor, or VS Code
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {servers.map((server) => (
            <McpServerCard key={server.id} server={server} />
          ))}
        </div>
      )}

      <AddEditServerDialog open={addOpen} onOpenChange={handleAddOpenChange} prefill={prefill} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <McpCatalog open={catalogOpen} onOpenChange={setCatalogOpen} onSelectItem={handleCatalogSelect} />
    </div>
  );
}
