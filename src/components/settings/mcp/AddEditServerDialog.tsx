import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  Plus, Wrench, Trash2,
  Loader2, CheckCircle2, AlertCircle, Lock, ShieldAlert,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  useMcpStore,
  isSecretEnvValue,
  mcpSecretService,
  type McpServerEntry,
  type McpTransport,
  type McpEnvValue,
} from '@/stores/mcp-store';
import { useMcpOperations, type McpValidationResult, type McpValidateInput } from '@/hooks/useMcpOperations';
import { cn } from '@/lib/utils';
import type { EnvRow, CatalogPrefill } from './types';
import { t } from '@/lib/i18n';

/** Convert a stored env map into editable rows (secrets start masked + stored). */
function envToRows(env: Record<string, McpEnvValue>): EnvRow[] {
  return Object.entries(env).map(([key, value]) =>
    isSecretEnvValue(value)
      ? { key, value: '', secret: true, stored: true }
      : { key, value: value as string, secret: false }
  );
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

export function AddEditServerDialog({ open, onOpenChange, editServer, prefill }: AddEditServerDialogProps) {
  const [command, setCommand] = useState(editServer?.command ?? '');
  const [args, setArgs] = useState(editServer?.args.join(' ') ?? '');
  const [name, setName] = useState(editServer?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(editServer?.transport ?? 'stdio');
  const [url, setUrl] = useState(editServer?.url ?? '');
  const [envPairs, setEnvPairs] = useState<EnvRow[]>(
    editServer ? envToRows(editServer.env) : []
  );
  const [saving, setSaving] = useState(false);
  // Validation dry-run state — drives the tool preview / error panel and gates
  // the write (config is only persisted after a successful start → handshake).
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });
  // Untrusted (deep-link-sourced) prefills must be explicitly acknowledged
  // before Test/Add can spawn the command. Editing or a manual/catalog add is
  // trusted and never gated.
  const untrusted = !editServer && !!prefill?.untrusted;
  const [acknowledged, setAcknowledged] = useState(false);

  const { validateServer, oauthAuthorize, oauthStatus } = useMcpOperations();
  const [authorizing, setAuthorizing] = useState(false);
  const [oauthOk, setOauthOk] = useState(false);

  const isRemote = transport === 'http';
  const hasRequiredFields = isRemote ? !!url.trim() : !!command.trim();
  // Untrusted prefills block Test/Add until the user ticks the acknowledgement.
  const gateBlocked = untrusted && !acknowledged;

  // The "Add" dialog is mounted once and reused, so seed its fields whenever it
  // (re)opens — from the edited server, a catalog prefill, or empty.
  useEffect(() => {
    if (!open) return;
    // Every (re)open starts unacknowledged — a fresh untrusted prefill must be
    // reviewed again even if a prior one was acknowledged in this mount.
    setAcknowledged(false);
    if (editServer) {
      setCommand(editServer.command);
      setArgs(editServer.args.join(' '));
      setName(editServer.name);
      setEnvPairs(envToRows(editServer.env));
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

  // On edit, reveal stored secret values from the keychain so the user can
  // re-validate / re-save without re-typing them. Best-effort: a missing
  // entry just leaves the row blank.
  useEffect(() => {
    if (!open || !editServer) return;
    let cancelled = false;
    (async () => {
      const revealed = await Promise.all(
        envToRows(editServer.env).map(async (row) => {
          if (!row.secret) return row;
          try {
            const value = await invoke<string | null>('get_credential', {
              service: mcpSecretService(editServer.id, row.key),
            });
            if (value) return { ...row, value, stored: false };
          } catch {
            // keep masked/stored
          }
          return row;
        })
      );
      if (!cancelled) setEnvPairs(revealed);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editServer]);

  // Any edit to the config invalidates a prior test result so a stale "ok"
  // can never let a changed config skip validation.
  useEffect(() => {
    setValidation({ status: 'idle' });
  }, [command, args, envPairs, transport, url]);

  // Changing the URL invalidates a prior authorization.
  useEffect(() => {
    setOauthOk(false);
  }, [url]);

  // On opening an existing remote server, reflect its stored OAuth status.
  useEffect(() => {
    if (!open || !editServer || editServer.transport !== 'http') return;
    let cancelled = false;
    oauthStatus(editServer.id)
      .then((s) => {
        if (!cancelled) setOauthOk(s.authorized);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, editServer, oauthStatus]);

  const handleAuthorize = async () => {
    if (!url.trim()) {
      toast.error(t("mcp.urlRequired"));
      return;
    }
    setAuthorizing(true);
    try {
      const status = await oauthAuthorize(buildInput().id ?? `global:server`, url.trim());
      setOauthOk(status.authorized);
      if (status.authorized) {
        toast.success(t("mcp.authorized"));
      }
    } catch (err) {
      toast.error(`Authorization failed: ${err}`);
    } finally {
      setAuthorizing(false);
    }
  };

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
      // The id discovery will assign — also the keychain id for OAuth tokens.
      id: editServer?.id ?? `global:${serverName}`,
    };
  }, [name, command, args, envPairs, transport, url, isRemote, editServer]);

  const requiredFieldError = isRemote ? 'Server URL is required' : 'Command is required';

  const handleTest = async () => {
    if (gateBlocked) {
      toast.error(t("mcp.confirmTrustBeforeTest"));
      return;
    }
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
    if (gateBlocked) {
      toast.error(t("mcp.confirmTrustBeforeAdd"));
      return;
    }
    if (!hasRequiredFields) {
      toast.error(requiredFieldError);
      return;
    }

    setSaving(true);
    try {
      const input = buildInput();
      const serverName = input.name;

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

      // Persist env: secret values go to the OS keychain (mcp.json gets only a
      // `{ secret: true }` reference); plaintext values stay inline. The server
      // id must match the one discovery will assign (`global:<name>`) so the
      // backend resolves the same keychain entry at spawn.
      const serverId = editServer?.id ?? `global:${serverName}`;
      const envForDisk: Record<string, unknown> = {};
      for (const row of envPairs) {
        const key = row.key.trim();
        if (!key) continue;
        if (row.secret) {
          if (row.value) {
            await invoke('store_credential', {
              service: mcpSecretService(serverId, key),
              key: row.value,
            });
          }
          envForDisk[key] = { secret: true };
        } else {
          envForDisk[key] = row.value;
        }
      }

      // Build config to save — http servers store transport + url, stdio
      // servers keep the legacy command/args shape (transport defaults to stdio).
      const configEntry: Record<string, unknown> = isRemote
        ? { transport: 'http', url: input.url, env: envForDisk }
        : { command: input.command, args: input.args, env: envForDisk };

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
          <DialogDescription>{t("mcp.configureSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {untrusted && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" strokeWidth={1.5} />
              <AlertTitle>{t("mcp.requestedByExternalLink")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  This MCP server was requested by an external link. MCP servers
                  run programs on your computer — review the command and arguments
                  below before continuing. Only add servers from sources you trust.
                </p>
                <label className="flex items-start gap-2 text-foreground">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(c) => setAcknowledged(c === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    I&apos;ve reviewed this command and trust its source
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("mcp.transport")}</Label>
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
              <Label className="text-xs text-muted-foreground">{t("mcp.serverUrl")}</Label>
              <Input
                value={url ?? ''}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Streamable HTTP endpoint. Authorize first if the server requires OAuth.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 gap-1 text-xs"
                  onClick={handleAuthorize}
                  disabled={authorizing || !url.trim()}
                >
                  {authorizing ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                  ) : oauthOk ? (
                    <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                  ) : (
                    <Lock className="h-3 w-3" strokeWidth={1.5} />
                  )}
                  {oauthOk ? 'Authorized' : 'Authorize'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("mcp.command")}</Label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("mcp.arguments")}</Label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="/path/to/directory"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t("mcp.argumentsHint")}</p>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("mcp.displayName")}</Label>
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
              <Label className="text-xs text-muted-foreground">{t("mcp.envVars")}</Label>
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
                  type={pair.secret ? 'password' : 'text'}
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[i] = { ...next[i], value: e.target.value, stored: false };
                    setEnvPairs(next);
                  }}
                  placeholder={pair.stored ? '•••••• (stored)' : pair.secret ? 'secret value' : 'value'}
                  className="font-mono text-xs flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 w-6 p-0 shrink-0',
                    pair.secret ? 'text-foreground' : 'text-muted-foreground'
                  )}
                  aria-label={pair.secret ? 'Stored in keychain' : 'Store in keychain'}
                  aria-pressed={!!pair.secret}
                  title={pair.secret ? 'Secret — stored in the OS keychain' : 'Store this value in the OS keychain'}
                  onClick={() => {
                    const next = [...envPairs];
                    next[i] = { ...next[i], secret: !next[i].secret, stored: false };
                    setEnvPairs(next);
                  }}
                >
                  <Lock className="h-3 w-3" strokeWidth={1.5} />
                </Button>
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
            disabled={saving || validation.status === 'testing' || !hasRequiredFields || gateBlocked}
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
            <Button onClick={handleSave} disabled={saving || !hasRequiredFields || gateBlocked}>
              {saving ? 'Saving...' : editServer ? 'Update' : 'Add Server'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
