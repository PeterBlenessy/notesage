import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  RefreshCw, Plus, MoreHorizontal, Play, Square, RotateCcw,
  ChevronDown, Download, Wrench, Trash2,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMcpStore, type McpServerEntry, type McpToolInfo } from '@/stores/mcp-store';
import { useMcpOperations } from '@/hooks/useMcpOperations';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusDot(status: McpServerEntry['status']) {
  switch (status) {
    case 'running':
      return 'bg-green-500';
    case 'starting':
      return 'bg-yellow-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-muted-foreground/40';
  }
}

function statusLabel(status: McpServerEntry['status']) {
  switch (status) {
    case 'running': return 'Running';
    case 'starting': return 'Starting...';
    case 'error': return 'Error';
    default: return 'Stopped';
  }
}

function sourceLabel(source: McpServerEntry['source']) {
  switch (source) {
    case 'notesage-project': return 'Project';
    case 'notesage-global': return 'Global';
    case 'claude-desktop': return 'Claude Desktop';
    case 'cursor': return 'Cursor';
    case 'vscode': return 'VS Code';
  }
}

// ---------------------------------------------------------------------------
// Server Card
// ---------------------------------------------------------------------------

function McpServerCard({ server }: { server: McpServerEntry }) {
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const removeServer = useMcpStore((s) => s.removeServer);
  const { startServer, stopServer, restartServer } = useMcpOperations();
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleToggle = useCallback(async (checked: boolean) => {
    toggleServer(server.id);
    if (checked) {
      // Read fresh server state after toggle
      const fresh = useMcpStore.getState().getServer(server.id);
      if (fresh) await startServer(fresh);
    } else {
      await stopServer(server.id);
    }
  }, [server.id, toggleServer, startServer, stopServer]);

  const handleRemove = useCallback(async () => {
    if (server.status === 'running') {
      await stopServer(server.id);
    }
    removeServer(server.id);
    // Remove from config file on disk
    try {
      const home = await invoke<string>('get_home_dir');
      const configPath = server.source === 'notesage-project'
        ? null // Project config removal not yet supported
        : `${home}/.notesage/mcp.json`;
      if (configPath) {
        const content = await invoke<string>('read_file', { path: configPath });
        const parsed = JSON.parse(content);
        const configs = parsed.mcpServers ?? {};
        delete configs[server.name];
        await invoke('mcp_save_config', { path: configPath, configs });
      }
    } catch {
      // Config file may not exist or server may not be in it — silently ignore
    }
    toast.success(`Removed MCP server "${server.name}"`);
  }, [server, stopServer, removeServer]);

  const commandDisplay = [server.command, ...server.args].join(' ');

  return (
    <>
      <div className="rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150">
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className={cn('h-2 w-2 rounded-full shrink-0', statusDot(server.status))} />
              <span className="text-sm font-medium truncate">{server.name}</span>
              <span className="text-xs text-muted-foreground">{statusLabel(server.status)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
              {commandDisplay}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {server.tools.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
                </span>
              )}
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {sourceLabel(server.source)}
              </Badge>
            </div>
            {server.error && (
              <p className="text-xs text-destructive mt-1 line-clamp-2">{server.error}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]">
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {server.status !== 'running' && (
                  <DropdownMenuItem onClick={() => startServer(server)}>
                    <Play className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    Start
                  </DropdownMenuItem>
                )}
                {server.status === 'running' && (
                  <DropdownMenuItem onClick={() => stopServer(server.id)}>
                    <Square className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    Stop
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => restartServer(server.id)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Restart
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Wrench className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRemove}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Switch
              checked={server.enabled}
              onCheckedChange={handleToggle}
            />
          </div>
        </div>

        {/* Expandable tool list */}
        {server.tools.length > 0 && (
          <Collapsible open={toolsExpanded} onOpenChange={setToolsExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 pb-2 focus-visible:outline-none">
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-150', !toolsExpanded && '-rotate-90')}
                strokeWidth={1.5}
              />
              Tools
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-3 pb-2.5 space-y-1">
                {server.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {editOpen && (
        <AddEditServerDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editServer={server}
        />
      )}
    </>
  );
}

function ToolRow({ tool }: { tool: McpToolInfo }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded text-xs">
      <Wrench className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
      <div className="min-w-0">
        <span className="font-mono text-foreground">{tool.name}</span>
        {tool.description && (
          <p className="text-muted-foreground line-clamp-1">{tool.description}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Server Dialog
// ---------------------------------------------------------------------------

interface AddEditServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editServer?: McpServerEntry;
}

function AddEditServerDialog({ open, onOpenChange, editServer }: AddEditServerDialogProps) {
  const [command, setCommand] = useState(editServer?.command ?? '');
  const [args, setArgs] = useState(editServer?.args.join(' ') ?? '');
  const [name, setName] = useState(editServer?.name ?? '');
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>(
    editServer
      ? Object.entries(editServer.env).map(([key, value]) => ({ key, value }))
      : []
  );
  const [saving, setSaving] = useState(false);

  const { requestRescan } = useMcpStore();

  const handleSave = async () => {
    if (!command.trim()) {
      toast.error('Command is required');
      return;
    }

    setSaving(true);
    try {
      const serverName = name.trim() || command.trim().split('/').pop()?.replace(/^@/, '') || 'server';
      const argsArray = args.trim() ? args.trim().split(/\s+/) : [];
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value;
        }
      }

      // Build config to save
      const configEntry = {
        command: command.trim(),
        args: argsArray,
        env,
      };

      // Save to global config
      const home = await invoke<string>('get_home_dir');
      const configPath = `${home}/.notesage/mcp.json`;

      // Read existing config, merge, save
      let existingConfigs: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
      try {
        const content = await invoke<string>('read_file', { path: configPath });
        const parsed = JSON.parse(content);
        existingConfigs = parsed.mcpServers ?? {};
      } catch {
        // File doesn't exist yet — start fresh
      }

      existingConfigs[serverName] = configEntry;
      await invoke('mcp_save_config', { path: configPath, configs: existingConfigs });

      toast.success(editServer ? `Updated "${serverName}"` : `Added "${serverName}"`);
      requestRescan();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editServer ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
          <DialogDescription>Configure the command, arguments, and environment for the MCP server.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Command</Label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Arguments</Label>
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="/path/to/directory"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">Space-separated arguments</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Display Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-derived from command"
              className="text-sm"
            />
          </div>

          {/* Environment Variables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Environment Variables</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setEnvPairs([...envPairs, { key: '', value: '' }])}
              >
                <Plus className="h-3 w-3 mr-1" strokeWidth={1.5} />
                Add
              </Button>
            </div>
            {envPairs.map((pair, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={pair.key}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[i] = { ...next[i], key: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="KEY"
                  className="font-mono text-xs flex-1"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[i] = { ...next[i], value: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="value"
                  className="font-mono text-xs flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Saved to ~/.notesage/mcp.json (global)
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !command.trim()}>
            {saving ? 'Saving...' : editServer ? 'Update' : 'Add Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Import Dialog
// ---------------------------------------------------------------------------

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

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
    invoke<string[]>('mcp_check_import_sources').then(setAvailableSources).catch(() => {});
  }, []);

  const handleSelectSource = async (sourceId: string) => {
    setSelectedSource(sourceId);
    setLoading(true);
    setDiscoveredServers([]);
    setSelectedIds(new Set());

    try {
      const configs = await invoke<Array<{
        id: string;
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        source: string;
        enabled: boolean;
      }>>('mcp_import_configs', { source: sourceId });

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
      const configs: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
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
      let existing: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
      try {
        const content = await invoke<string>('read_file', { path: configPath });
        const parsed = JSON.parse(content);
        existing = parsed.mcpServers ?? {};
      } catch {
        // File doesn't exist
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
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border text-left transition-colors',
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
                    <input
                      type="checkbox"
                      checked={selectedIds.has(server.id)}
                      onChange={() => toggleId(server.id)}
                      className="accent-foreground"
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function McpServersSettings() {
  const { servers } = useMcpStore();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rescanSpinning, setRescanSpinning] = useState(false);

  const handleRescan = () => {
    useMcpStore.getState().requestRescan();
    setRescanSpinning(true);
    setTimeout(() => setRescanSpinning(false), 600);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">MCP Servers</Label>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Import
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRescan} disabled={rescanSpinning}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', rescanSpinning && 'animate-spin')} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Connect external tool servers via the Model Context Protocol
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="px-4 py-8 text-center rounded-lg border border-dashed border-border">
          <p className="text-sm text-muted-foreground">No MCP servers configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add a server or import from Claude Desktop, Cursor, or VS Code
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {servers.map((server) => (
            <McpServerCard key={server.id} server={server} />
          ))}
        </div>
      )}

      <AddEditServerDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
