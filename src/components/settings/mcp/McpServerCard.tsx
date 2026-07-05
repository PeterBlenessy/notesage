import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  MoreHorizontal, Play, Square, RotateCcw,
  ChevronDown, Wrench, Trash2,
  Lock, LogOut,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import {
  useMcpStore,
  isSecretEnvValue,
  mcpSecretService,
  type McpServerEntry,
} from '@/stores/mcp-store';
import { useMcpOperations } from '@/hooks/useMcpOperations';
import { cn } from '@/lib/utils';
import { ToolRow } from './ToolRow';
import { AddEditServerDialog } from './AddEditServerDialog';

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

export function McpServerCard({ server }: { server: McpServerEntry }) {
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const removeServer = useMcpStore((s) => s.removeServer);
  const { startServer, stopServer, restartServer, oauthAuthorize, oauthLogout } = useMcpOperations();

  const handleReauth = useCallback(async () => {
    if (!server.url) return;
    try {
      await oauthAuthorize(server.id, server.url);
      toast.success(`Re-authenticated "${server.name}"`);
    } catch (err) {
      toast.error(`Authorization failed: ${err}`);
    }
  }, [server.id, server.url, server.name, oauthAuthorize]);

  const handleSignOut = useCallback(async () => {
    try {
      await oauthLogout(server.id);
      toast.success(`Signed out of "${server.name}"`);
    } catch (err) {
      toast.error(`Failed to sign out: ${err}`);
    }
  }, [server.id, server.name, oauthLogout]);
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
    // Delete any keychain-stored secrets for this server.
    for (const [key, value] of Object.entries(server.env)) {
      if (isSecretEnvValue(value)) {
        try {
          await invoke('delete_credential', { service: mcpSecretService(server.id, key) });
        } catch {
          // best-effort cleanup
        }
      }
    }
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
                {isRemote && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleReauth} disabled={!server.url}>
                      <Lock className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                      Re-authenticate
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                      Sign out
                    </DropdownMenuItem>
                  </>
                )}
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
