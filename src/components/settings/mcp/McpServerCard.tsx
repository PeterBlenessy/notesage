import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  MoreHorizontal, Play, Square, RotateCcw,
  ChevronDown, Wrench, Trash2,
  Lock, LogOut, Copy,
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
  mcpHeaderSecretService,
  mcpOAuthService,
  type McpServerEntry,
} from '@/stores/mcp-store';
import { useMcpOperations } from '@/hooks/useMcpOperations';
import { cn } from '@/lib/utils';
import { ToolRow } from './ToolRow';
import { AddEditServerDialog } from './AddEditServerDialog';
import { t } from '@/lib/i18n';
import { McpConfigUnreadableError, mcpConfigPathFor, readMcpServersForUpdate } from './mcp-config-file';
import { joinCommandLine } from './command-line';
import { deleteCredential } from './mcp-credentials';

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
  const setServerEnabled = useMcpStore((s) => s.setServerEnabled);
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
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Start from the menu. A server that is switched off is switched on first:
  // a running server that is off offers its tools to no chat, which looks
  // exactly like a server that does not work.
  const handleStart = useCallback(async () => {
    if (!server.enabled) setServerEnabled(server.id, true);
    const fresh = useMcpStore.getState().getServer(server.id) ?? { ...server, enabled: true };
    await startServer(fresh);
  }, [server, setServerEnabled, startServer]);

  const handleCopyError = useCallback(() => {
    if (!server.error) return;
    navigator.clipboard.writeText(server.error).then(
      () => toast.success(t("common.copiedPlain")),
      () => toast.error(t("mcpc.copyFailed")),
    );
  }, [server.error]);

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
    // Read the config file BEFORE removing anything: if it cannot be read,
    // rewriting it would drop every other server, so the removal is refused.
    // The file is the one the server is defined in: the project's own
    // mcp.json for a project-scoped server, the global one otherwise.
    let configPath: string | null = null;
    let configs: Record<string, unknown> | null = null;
    try {
      configPath = await mcpConfigPathFor(server);
      configs = await readMcpServersForUpdate(configPath);
    } catch (err) {
      toast.error(err instanceof McpConfigUnreadableError ? t("mcp.configUnreadable") : `${t("mcp.configSaveFailed")}: ${err}`);
      return;
    }

    if (server.status !== 'stopped') {
      await stopServer(server.id);
    }
    removeServer(server.id);
    // Delete any keychain-stored secrets for this server (best-effort).
    for (const [key, value] of Object.entries(server.env)) {
      if (isSecretEnvValue(value)) await deleteCredential(mcpSecretService(server.id, key));
    }
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      if (isSecretEnvValue(value)) await deleteCredential(mcpHeaderSecretService(server.id, key));
    }
    if (server.transport === 'http') await deleteCredential(mcpOAuthService(server.id));
    // Remove from config file on disk — only if the server is actually in it
    // (a missing file, or a server discovered elsewhere, needs no write).
    if (configPath && configs && server.name in configs) {
      delete configs[server.name];
      try {
        await invoke('mcp_save_config', { path: configPath, configs });
      } catch (err) {
        // Not a success: the server would come back on the next scan.
        toast.error(`${t("mcp.configSaveFailed")}: ${err}`);
        return;
      }
    }
    toast.success(`Removed MCP server "${server.name}"`);
  }, [server, stopServer, removeServer]);

  const isRemote = server.transport === 'http';
  const commandDisplay = isRemote
    ? (server.url ?? 'remote')
    : joinCommandLine([server.command, ...server.args]);
  const toolCount = server.tools.length;
  // Long enough to be cut off by the two-line summary, or more than one line
  // (a start failure carries the server's own output after the reason).
  const errorIsLong = !!server.error && (server.error.length > 120 || server.error.includes('\n'));

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
              {toolCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {toolCount} tool{toolCount !== 1 ? 's' : ''}
                </span>
              )}
              {toolCount === 0 && server.status === 'running' && (
                <span className="text-xs text-muted-foreground">{t("mcpc.noTools")}</span>
              )}
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {sourceLabel(server.source)}
              </Badge>
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {isRemote ? t("common.remote") : t("conns.local")}
              </Badge>
            </div>
            {toolCount === 0 && server.status === 'running' && (
              <p className="text-xs text-muted-foreground mt-1">{t("mcpc.noToolsHint")}</p>
            )}
            {server.status === 'running' && !server.enabled && (
              <p className="text-xs text-muted-foreground mt-1">{t("mcpc.runningButOff")}</p>
            )}
            {server.error && (
              <div className="mt-1 space-y-1">
                {errorExpanded ? (
                  <pre
                    tabIndex={0}
                    aria-label={t("mcpc.fullError")}
                    className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs font-mono text-destructive whitespace-pre-wrap break-words select-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {server.error}
                  </pre>
                ) : (
                  <p className="text-xs text-destructive line-clamp-2 whitespace-pre-wrap break-words">{server.error}</p>
                )}
                <div className="flex items-center gap-3">
                  {errorIsLong && (
                    <button
                      type="button"
                      aria-expanded={errorExpanded}
                      onClick={() => setErrorExpanded((v) => !v)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {errorExpanded ? t("mcpc.hideFullError") : t("mcpc.showFullError")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyError}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Copy className="h-3 w-3" strokeWidth={1.5} />
                    {t("mcpc.copyError")}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t("mcpc.serverActions", { name: server.name })}
                  className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {server.status !== 'running' && (
                  <DropdownMenuItem onClick={handleStart}>
                    <Play className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    {t("localai.start")}
                  </DropdownMenuItem>
                )}
                {server.status === 'running' && (
                  <DropdownMenuItem onClick={() => stopServer(server.id)}>
                    <Square className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    {t("comp.stop")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => restartServer(server.id)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  {t("localai.restart")}
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
                      {t("mcpc.signOut")}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Wrench className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  {t("skills.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRemove}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                  {t("mcpc.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Switch
              checked={server.enabled}
              onCheckedChange={handleToggle}
              aria-label={t("mcpc.enableServer", { name: server.name })}
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
              {t("custom.badgeTools")}
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
