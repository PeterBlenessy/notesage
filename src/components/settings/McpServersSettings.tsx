import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  RefreshCw, Plus, MoreHorizontal, Play, Square, RotateCcw,
  ChevronDown, Download, Wrench, Trash2, Boxes,
  Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { useMcpStore, type McpServerEntry, type McpToolInfo, type McpCatalogItem, type McpTransport } from '@/stores/mcp-store';
import { useMcpOperations, type McpValidationResult, type McpValidateInput } from '@/hooks/useMcpOperations';
import { McpCatalog } from './McpCatalog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusDot(status: McpServerEntry['status']) {
  switch (status) {
    case 'running':
      return 'bg-foreground';
    case 'starting':
      return 'bg-muted-foreground animate-pulse';
    case 'error':
      return 'bg-destructive';
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

  const isRemote = server.transport === 'http';
  const commandDisplay = isRemote
    ? (server.url ?? 'remote')
    : [server.command, ...server.args].join(' ');

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
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {isRemote ? 'Remote' : 'Local'}
              </Badge>
            </div>
            {server.error && (
              <p className="text-xs text-destructive mt-1 line-clamp-2">{server.error}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 pb-2 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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

/** Pre-filled values when adding a server from the catalog. */
export interface CatalogPrefill {
  name: string;
  command: string;
  args: string[];
  env: { key: string; value: string }[];
  transport?: McpTransport;
  url?: string | null;
}

interface AddEditServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editServer?: McpServerEntry;
  /** When adding from the catalog, seed the form with these values. */
  prefill?: CatalogPrefill;
}

type ValidationState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; result: McpValidationResult }
  | { status: 'error'; result: McpValidationResult };

function AddEditServerDialog({ open, onOpenChange, editServer, prefill }: AddEditServerDialogProps) {
  const [command, setCommand] = useState(editServer?.command ?? '');
  const [args, setArgs] = useState(editServer?.args.join(' ') ?? '');
  const [name, setName] = useState(editServer?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(editServer?.transport ?? 'stdio');
  const [url, setUrl] = useState(editServer?.url ?? '');
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>(
    editServer
      ? Object.entries(editServer.env).map(([key, value]) => ({ key, value }))
      : []
  );
  const [saving, setSaving] = useState(false);
  // Validation dry-run state — drives the tool preview / error panel and gates
  // the write (config is only persisted after a successful start → handshake).
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });

  const { validateServer } = useMcpOperations();

  const isRemote = transport === 'http';
  const hasRequiredFields = isRemote ? !!url.trim() : !!command.trim();

  // The "Add" dialog is mounted once and reused, so seed its fields whenever it
  // (re)opens — from the edited server, a catalog prefill, or empty.
  useEffect(() => {
    if (!open) return;
    if (editServer) {
      setCommand(editServer.command);
      setArgs(editServer.args.join(' '));
      setName(editServer.name);
      setEnvPairs(Object.entries(editServer.env).map(([key, value]) => ({ key, value })));
      setTransport(editServer.transport ?? 'stdio');
      setUrl(editServer.url ?? '');
    } else if (prefill) {
      setCommand(prefill.command);
      setArgs(prefill.args.join(' '));
      setName(prefill.name);
      setEnvPairs(prefill.env);
      setTransport(prefill.transport ?? 'stdio');
      setUrl(prefill.url ?? '');
    } else {
      // Fresh manual add — clear any state left over from a prior session.
      setCommand('');
      setArgs('');
      setName('');
      setEnvPairs([]);
      setTransport('stdio');
      setUrl('');
    }
  }, [open, editServer, prefill]);

  // Any edit to the config invalidates a prior test result so a stale "ok"
  // can never let a changed config skip validation.
  useEffect(() => {
    setValidation({ status: 'idle' });
  }, [command, args, envPairs, transport, url]);

  const { requestRescan } = useMcpStore();

  const buildInput = useCallback((): McpValidateInput => {
    const fallback = isRemote
      ? url.trim() || 'server'
      : command.trim().split('/').pop()?.replace(/^@/, '') || 'server';
    const serverName = name.trim() || fallback;
    const argsArray = !isRemote && args.trim() ? args.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) {
        env[pair.key.trim()] = pair.value;
      }
    }
    return {
      name: serverName,
      command: isRemote ? '' : command.trim(),
      args: argsArray,
      env,
      transport,
      url: isRemote ? url.trim() : null,
    };
  }, [name, command, args, envPairs, transport, url, isRemote]);

  const requiredFieldError = isRemote ? 'Server URL is required' : 'Command is required';

  const handleTest = async () => {
    if (!hasRequiredFields) {
      toast.error(requiredFieldError);
      return;
    }
    setValidation({ status: 'testing' });
    try {
      const result = await validateServer(buildInput());
      setValidation({ status: result.ok ? 'ok' : 'error', result });
    } catch (err) {
      setValidation({
        status: 'error',
        result: { ok: false, tools: [], server_info: null, error: String(err), error_kind: null, stderr_tail: null },
      });
    }
  };

  const handleSave = async () => {
    if (!hasRequiredFields) {
      toast.error(requiredFieldError);
      return;
    }

    setSaving(true);
    try {
      const input = buildInput();
      const serverName = input.name;
      const env = input.env;

      // Validate before writing. Reuse a prior successful test for the
      // current config (field edits reset validation to idle), otherwise run a
      // fresh dry run now. A failure blocks the write.
      let result: McpValidationResult;
      if (validation.status === 'ok') {
        result = validation.result;
      } else {
        setValidation({ status: 'testing' });
        result = await validateServer(input);
        setValidation({ status: result.ok ? 'ok' : 'error', result });
      }
      if (!result.ok) {
        toast.error(result.error ?? 'The server failed to start — fix the config and try again');
        return;
      }

      // Build config to save — http servers store transport + url, stdio
      // servers keep the legacy command/args shape (transport defaults to stdio).
      const configEntry: Record<string, unknown> = isRemote
        ? { transport: 'http', url: input.url, env }
        : { command: input.command, args: input.args, env };

      // Save to global config
      const home = await invoke<string>('get_home_dir');
      const configPath = `${home}/.notesage/mcp.json`;

      // Read existing config, merge, save
      let existingConfigs: Record<string, Record<string, unknown>> = {};
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
          <DialogDescription>Configure how Notesage connects to the MCP server.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Transport</Label>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(['stdio', 'http'] as const).map((t) => {
                const active = transport === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTransport(t)}
                    className={cn(
                      'px-3 py-1 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'stdio' ? 'Local (command)' : 'Remote (URL)'}
                  </button>
                );
              })}
            </div>
          </div>

          {isRemote ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Server URL</Label>
              <Input
                value={url ?? ''}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Streamable HTTP endpoint</p>
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Display Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isRemote ? 'Auto-derived from URL' : 'Auto-derived from command'}
              className="text-sm"
            />
          </div>

          {/* Environment Variables — stdio only (http MVP is no-auth) */}
          {!isRemote && (
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
          )}

          {/* Validation result — tool preview on success, actionable error on failure */}
          {validation.status === 'testing' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              Testing connection…
            </div>
          )}
          {validation.status === 'ok' && (
            <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Connected — {validation.result.tools.length} tool{validation.result.tools.length !== 1 ? 's' : ''}
              </div>
              {validation.result.tools.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {validation.result.tools.slice(0, 12).map((t) => (
                    <Badge key={t.name} variant="secondary" className="h-4 px-1.5 text-xs font-normal font-mono">
                      {t.name}
                    </Badge>
                  ))}
                  {validation.result.tools.length > 12 && (
                    <span className="text-xs text-muted-foreground self-center">
                      +{validation.result.tools.length - 12} more
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {validation.status === 'error' && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 space-y-1.5">
              <div className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" strokeWidth={1.5} />
                <span>{validation.result.error ?? 'The server failed to start'}</span>
              </div>
              {validation.result.stderr_tail && (
                <Collapsible>
                  <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    Show details
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                      {validation.result.stderr_tail}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Saved to ~/.notesage/mcp.json (global)
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={saving || validation.status === 'testing' || !hasRequiredFields}
          >
            {validation.status === 'testing' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <Wrench className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
            )}
            Test
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !hasRequiredFields}>
              {saving ? 'Saving...' : editServer ? 'Update' : 'Add Server'}
            </Button>
          </div>
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

  const handleRescan = () => {
    useMcpStore.getState().requestRescan();
    setRescanSpinning(true);
    setTimeout(() => setRescanSpinning(false), 600);
  };

  // Catalog pick → close catalog, seed the Add dialog with the entry's template.
  const handleCatalogSelect = (item: McpCatalogItem) => {
    setPrefill({
      name: item.name,
      command: item.command ?? '',
      args: item.args,
      env: item.required_env.map((e) => ({ key: e.key, value: '' })),
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
          <Label className="text-sm font-semibold">MCP Servers</Label>
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
              onClick={handleRescan}
              disabled={rescanSpinning}
              aria-label="Refresh servers"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', rescanSpinning && 'animate-spin')} strokeWidth={1.5} />
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
