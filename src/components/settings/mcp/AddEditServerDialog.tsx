import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  Wrench, FolderOpen,
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
  mcpHeaderSecretService,
  mcpOAuthService,
  mcpGlobalServerId,
  mcpProjectServerId,
  type McpCatalogRequiredArg,
  type McpServerEntry,
  type McpTransport,
  type McpEnvValue,
} from '@/stores/mcp-store';
import { useMcpOperations, type McpValidationResult, type McpValidateInput } from '@/hooks/useMcpOperations';
import { tauriApi } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import type { EnvRow, CatalogPrefill } from './types';
import { t } from '@/lib/i18n';
import { McpConfigUnreadableError, mcpConfigPathFor, readMcpServersForUpdate } from './mcp-config-file';
import { joinCommandLine, quoteArg, resolveCommandAndArgs } from './command-line';
import { argsFromAnswers, isArgRequired } from './catalog-requirements';
import { deleteCredential, moveCredential, readCredential } from './mcp-credentials';
import { KeyValueRows } from './KeyValueRows';

/** Convert a stored env/header map into editable rows (secrets start masked + stored). */
function valuesToRows(values: Record<string, McpEnvValue> | undefined): EnvRow[] {
  return Object.entries(values ?? {}).map(([key, value]) =>
    isSecretEnvValue(value)
      ? { key, value: '', secret: true, stored: true }
      : { key, value: value as string, secret: false }
  );
}

/** The plaintext name/value pairs of a set of rows, as a dry run needs them. */
function rowsToPlain(rows: EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) out[row.key.trim()] = row.value;
  }
  return out;
}

/** Programs that run another program: the server is what they are given. */
const RUNNERS = new Set([
  'npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'uv', 'pnpm', 'yarn', 'npm', 'bun', 'deno',
  'node', 'python', 'python3', 'docker', 'podman',
]);
/** Sub-commands of those runners that are not the server either. */
const RUNNER_VERBS = new Set(['run', 'dlx', 'x', 'exec', 'tool']);

function baseName(path: string): string {
  return path.split('/').pop()?.replace(/^@/, '') ?? '';
}

/**
 * A display name for a server the user did not name: the package or script a
 * runner is given (`npx -y @scope/server-files` is "server-files"), otherwise
 * the program itself.
 */
function deriveName(command: string, args: string[]): string {
  if (RUNNERS.has(baseName(command))) {
    const target = args.find((arg) => !arg.startsWith('-') && !RUNNER_VERBS.has(arg));
    if (target && baseName(target)) return baseName(target);
  }
  return baseName(command) || 'server';
}

/**
 * How a stored command is shown in the Command field, which is split like a
 * command line when it is read back. A program path that contains spaces is
 * quoted so it stays one word. Anything else is shown as it is: an entry
 * saved before the field was split may hold a whole line (`npx -y pkg`), and
 * showing that unquoted is what lets a plain re-save repair it.
 */
function commandFieldValue(command: string): string {
  const isPath = /^(\/|~|\.{1,2}\/)/.test(command);
  return isPath && /\s/.test(command) ? quoteArg(command) : command;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** What the form currently describes, ready to test or to save. */
interface ResolvedForm {
  name: string;
  /** The id the server will have once saved (also its keychain namespace). */
  id: string;
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
}

const NO_REQUIRED_ARGS: McpCatalogRequiredArg[] = [];

/**
 * The keys of an `mcp.json` entry this form writes. `type` is the other
 * spelling of `transport`; leaving an old one behind could contradict it.
 */
const FORM_OWNED_KEYS = new Set(['command', 'args', 'env', 'transport', 'type', 'url', 'headers', 'cwd']);

export function AddEditServerDialog({ open, onOpenChange, editServer, prefill }: AddEditServerDialogProps) {
  const fieldId = useId();
  const [command, setCommand] = useState(commandFieldValue(editServer?.command ?? ''));
  const [args, setArgs] = useState(joinCommandLine(editServer?.args ?? []));
  const [cwd, setCwd] = useState(editServer?.cwd ?? '');
  const [name, setName] = useState(editServer?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(editServer?.transport ?? 'stdio');
  const [url, setUrl] = useState(editServer?.url ?? '');
  const [envPairs, setEnvPairs] = useState<EnvRow[]>(
    editServer ? valuesToRows(editServer.env) : []
  );
  const [headerPairs, setHeaderPairs] = useState<EnvRow[]>(
    editServer ? valuesToRows(editServer.headers) : []
  );
  // Answers to the arguments a catalog entry says it needs, by argument key.
  const [argAnswers, setArgAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // A save is writing right now (a ref: the test-then-save path reads it
  // after an await, when the state it closed over is stale).
  const persisting = useRef(false);
  // Validation dry-run state — drives the tool preview / error panel. A failed
  // or skipped test does not block saving: "Save without testing" writes the
  // entry as configured.
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });
  // Untrusted (deep-link-sourced) prefills must be explicitly acknowledged
  // before Test/Add can spawn the command. Editing or a manual/catalog add is
  // trusted and never gated.
  const untrusted = !editServer && !!prefill?.untrusted;
  const [acknowledged, setAcknowledged] = useState(false);

  const { validateServer, oauthAuthorize, oauthStatus, stopServer } = useMcpOperations();
  const [authorizing, setAuthorizing] = useState(false);
  const [oauthOk, setOauthOk] = useState(false);
  // The id the OAuth token was stored under when Authorize was pressed. The
  // server's final id is only known at save (it follows the name), so the
  // token is moved then if the two differ.
  const [oauthTokenId, setOauthTokenId] = useState<string | null>(null);

  const requiredArgs = (!editServer && prefill?.requiredArgs) || NO_REQUIRED_ARGS;
  const isRemote = transport === 'http';
  const missingRequiredArg = !isRemote && requiredArgs.some(
    (arg) => isArgRequired(arg) && !(argAnswers[arg.key] ?? '').trim()
  );
  const hasRequiredFields = isRemote ? !!url.trim() : !!command.trim() && !missingRequiredArg;
  // Untrusted prefills block Test/Add until the user ticks the acknowledgement.
  const gateBlocked = untrusted && !acknowledged;

  // Which server is being edited. The effects that fill the form depend on
  // this, not on the `editServer` object: the store replaces that object on
  // every status change (a retry flips a failing server between "starting" and
  // "error" every few seconds), and refilling the form each time would wipe
  // what the user is typing into it.
  const editId = editServer?.id ?? null;

  // The "Add" dialog is mounted once and reused, so seed its fields whenever it
  // (re)opens — from the edited server, a catalog prefill, or empty.
  useEffect(() => {
    if (!open) return;
    // Every (re)open starts unacknowledged — a fresh untrusted prefill must be
    // reviewed again even if a prior one was acknowledged in this mount.
    setAcknowledged(false);
    setArgAnswers({});
    setOauthTokenId(null);
    if (editServer) {
      setCommand(commandFieldValue(editServer.command));
      setArgs(joinCommandLine(editServer.args));
      setCwd(editServer.cwd ?? '');
      setName(editServer.name);
      setEnvPairs(valuesToRows(editServer.env));
      setHeaderPairs(valuesToRows(editServer.headers));
      setTransport(editServer.transport ?? 'stdio');
      setUrl(editServer.url ?? '');
    } else if (prefill) {
      setCommand(commandFieldValue(prefill.command));
      setArgs(joinCommandLine(prefill.args));
      setCwd('');
      setName(prefill.name);
      setEnvPairs(prefill.env);
      setHeaderPairs([]);
      setTransport(prefill.transport ?? 'stdio');
      setUrl(prefill.url ?? '');
    } else {
      // Fresh manual add — clear any state left over from a prior session.
      setCommand('');
      setArgs('');
      setCwd('');
      setName('');
      setEnvPairs([]);
      setHeaderPairs([]);
      setTransport('stdio');
      setUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on editId, see above
  }, [open, editId, prefill]);

  // On edit, reveal stored secret values from the keychain so the user can
  // re-validate / re-save without re-typing them. Best-effort: a missing
  // entry just leaves the row blank.
  useEffect(() => {
    if (!open || !editServer) return;
    let cancelled = false;
    const reveal = (rows: EnvRow[], service: (key: string) => string) =>
      Promise.all(
        rows.map(async (row) => {
          if (!row.secret) return row;
          const value = await readCredential(service(row.key));
          return value ? { ...row, value, stored: false } : row;
        })
      );
    (async () => {
      const [env, headers] = await Promise.all([
        reveal(valuesToRows(editServer.env), (key) => mcpSecretService(editServer.id, key)),
        reveal(valuesToRows(editServer.headers), (key) => mcpHeaderSecretService(editServer.id, key)),
      ]);
      if (cancelled) return;
      setEnvPairs(env);
      setHeaderPairs(headers);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on editId, see above
  }, [open, editId]);

  // Any edit to the config invalidates a prior test result so a stale "ok"
  // can never be shown for a changed config.
  useEffect(() => {
    setValidation({ status: 'idle' });
  }, [command, args, cwd, envPairs, headerPairs, argAnswers, transport, url]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on editId, see above
  }, [open, editId, oauthStatus]);

  const { requestRescan, enableOnNextDiscovery, moveEnabledOverride } = useMcpStore();

  /** Read the form: split the command line, settle the name and the id. */
  const resolveForm = useCallback((): ResolvedForm => {
    const split = isRemote
      ? { command: '', args: [] as string[] }
      : resolveCommandAndArgs(command, args);
    const allArgs = isRemote ? [] : [...split.args, ...argsFromAnswers(requiredArgs, argAnswers)];
    // An existing server keeps its name unless a different one is typed; a
    // new one without a name is named after what it runs.
    const serverName =
      name.trim() ||
      editServer?.name ||
      (isRemote ? url.trim() || 'server' : deriveName(split.command, allArgs));
    let id: string;
    if (!editServer) {
      id = mcpGlobalServerId(serverName);
    } else if (serverName === editServer.name) {
      id = editServer.id;
    } else if (editServer.source === 'notesage-project' && editServer.projectRoot) {
      id = mcpProjectServerId(editServer.projectRoot, serverName);
    } else {
      id = mcpGlobalServerId(serverName);
    }
    return {
      name: serverName,
      id,
      command: split.command,
      args: allArgs,
      cwd: !isRemote && cwd.trim() ? cwd.trim() : null,
      url: isRemote ? url.trim() : null,
    };
  }, [name, command, args, cwd, argAnswers, requiredArgs, url, isRemote, editServer]);

  const buildInput = useCallback((): McpValidateInput => {
    const form = resolveForm();
    return {
      name: form.name,
      command: form.command,
      args: form.args,
      env: rowsToPlain(envPairs),
      transport,
      url: form.url,
      headers: isRemote ? rowsToPlain(headerPairs) : {},
      cwd: form.cwd,
      // Where the OAuth token is right now: under the id it was authorized
      // with, which becomes the server's id at save.
      id: oauthTokenId ?? form.id,
    };
  }, [resolveForm, envPairs, headerPairs, transport, isRemote, oauthTokenId]);

  const handleAuthorize = async () => {
    if (!url.trim()) {
      toast.error(t("mcp.urlRequired"));
      return;
    }
    setAuthorizing(true);
    try {
      const { id } = resolveForm();
      const status = await oauthAuthorize(id, url.trim());
      setOauthOk(status.authorized);
      if (status.authorized) {
        setOauthTokenId(id);
        toast.success(t("mcp.authorized"));
      }
    } catch (err) {
      toast.error(`Authorization failed: ${err}`);
    } finally {
      setAuthorizing(false);
    }
  };

  const requiredFieldError = isRemote
    ? t("mcp.urlRequired")
    : !command.trim()
      ? t("mcpd.commandRequired")
      : t("mcpd.requiredArgMissing");

  const runValidation = async (): Promise<McpValidationResult> => {
    setValidation({ status: 'testing' });
    let result: McpValidationResult;
    try {
      result = await validateServer(buildInput());
    } catch (err) {
      result = { ok: false, tools: [], server_info: null, error: String(err), error_kind: null, stderr_tail: null };
    }
    setValidation({ status: result.ok ? 'ok' : 'error', result });
    return result;
  };

  const handleTest = async () => {
    if (gateBlocked) {
      toast.error(t("mcp.confirmTrustBeforeTest"));
      return;
    }
    if (!hasRequiredFields) {
      toast.error(requiredFieldError);
      return;
    }
    await runValidation();
  };

  /**
   * Store the secret rows in the keychain under `serverId` and return the map
   * to write to `mcp.json` (references for secrets, values for the rest).
   * A secret the user never revealed or retyped is carried over from the
   * server's previous id when it was renamed.
   */
  const persistRows = async (
    rows: EnvRow[],
    serverId: string,
    service: (id: string, key: string) => string,
  ): Promise<Record<string, unknown>> => {
    const forDisk: Record<string, unknown> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      if (!row.secret) {
        forDisk[key] = row.value;
        continue;
      }
      let value = row.value;
      if (!value && editServer && editServer.id !== serverId) {
        // Copied, not moved: the old entry goes only after the file is saved.
        value = (await readCredential(service(editServer.id, key))) ?? '';
      }
      if (value) {
        await invoke('store_credential', { service: service(serverId, key), key: value });
      }
      forDisk[key] = { secret: true };
    }
    return forDisk;
  };

  /**
   * Remove the keychain entries of the server being edited that the saved
   * form no longer refers to: everything under the old id after a rename,
   * and secrets that were deleted or turned into plain values.
   */
  const dropStaleSecrets = async (
    previous: Record<string, McpEnvValue> | undefined,
    kept: Record<string, unknown>,
    serverId: string,
    service: (id: string, key: string) => string,
  ) => {
    if (!editServer) return;
    for (const [key, value] of Object.entries(previous ?? {})) {
      if (!isSecretEnvValue(value)) continue;
      const stillSecret = isRecord(kept[key]) && editServer.id === serverId;
      if (!stillSecret) await deleteCredential(service(editServer.id, key));
    }
  };

  /** Write the entry as the form describes it, without judging whether it runs. */
  const persist = async () => {
    const form = resolveForm();
    const renamed = !!editServer && form.name !== editServer.name;

    // An edit goes back to the file the server came from (a project's own
    // mcp.json for a project-scoped server); a new server goes to the global
    // file. A missing file starts fresh; one that exists but cannot be read
    // throws, so the save below (which rewrites the whole file) never runs
    // on a guess.
    const configPath = await mcpConfigPathFor(editServer);
    const existingConfigs = await readMcpServersForUpdate(configPath);

    if ((!editServer || renamed) && form.name in existingConfigs) {
      toast.error(t("mcpd.nameTaken", { name: form.name }));
      return;
    }

    // Secret values go to the OS keychain under the id the server will have
    // (the backend resolves them by that id at start); mcp.json gets only a
    // `{ secret: true }` reference. Plain values stay inline.
    const envForDisk = await persistRows(envPairs, form.id, mcpSecretService);
    const headersForDisk = isRemote
      ? await persistRows(headerPairs, form.id, mcpHeaderSecretService)
      : {};

    // http servers store transport + url (+ headers), stdio servers keep the
    // command/args shape (transport defaults to stdio).
    // An edit replaces what this form edits and keeps the rest of the entry
    // as it was in the file (`disabled`, and keys this app does not know):
    // the save writes entries verbatim.
    const previousEntry = editServer ? existingConfigs[editServer.name] : undefined;
    const kept: Record<string, unknown> = {};
    if (isRecord(previousEntry)) {
      for (const [key, value] of Object.entries(previousEntry)) {
        if (!FORM_OWNED_KEYS.has(key)) kept[key] = value;
      }
    }
    const configEntry: Record<string, unknown> = isRemote
      ? { ...kept, transport: 'http', url: form.url, headers: headersForDisk, env: envForDisk }
      : { ...kept, command: form.command, args: form.args, env: envForDisk };
    if (form.cwd) configEntry.cwd = form.cwd;

    if (editServer && renamed) delete existingConfigs[editServer.name];
    existingConfigs[form.name] = configEntry;
    await invoke('mcp_save_config', { path: configPath, configs: existingConfigs });

    // The OAuth token follows the server to the id it ended up with.
    const tokenId = oauthTokenId ?? editServer?.id ?? null;
    if (isRemote && tokenId && tokenId !== form.id) {
      await moveCredential(mcpOAuthService(tokenId), mcpOAuthService(form.id));
    }
    await dropStaleSecrets(editServer?.env, envForDisk, form.id, mcpSecretService);
    await dropStaleSecrets(editServer?.headers, headersForDisk, form.id, mcpHeaderSecretService);

    if (!editServer) {
      // Adding a server in this dialog is the user's decision to use it: it is
      // switched on, and the rescan below starts it.
      enableOnNextDiscovery(form.id);
    } else if (renamed) {
      moveEnabledOverride(editServer.id, form.id);
      // The process still running under the old id belongs to no server now.
      if (editServer.status !== 'stopped') await stopServer(editServer.id);
    }

    toast.success(editServer ? `Updated "${form.name}"` : `Added "${form.name}"`);
    requestRescan();
    onOpenChange(false);
  };

  const save = async (testFirst: boolean) => {
    if (gateBlocked) {
      toast.error(t("mcp.confirmTrustBeforeAdd"));
      return;
    }
    if (!hasRequiredFields) {
      toast.error(requiredFieldError);
      return;
    }

    // Reuse a prior successful test for the current config (field edits
    // reset validation to idle), otherwise run a fresh dry run now. A
    // failure stops here and leaves "Save without testing" as the way on.
    // The test can take minutes; "Save without testing" stays usable while
    // it runs, and a save made meanwhile is not repeated when it returns.
    if (testFirst && validation.status !== 'ok') {
      const result = await runValidation();
      if (persisting.current) return;
      if (!result.ok) {
        toast.error(result.error ?? t("mcpd.startFailedFixOrSave"));
        return;
      }
    }
    if (persisting.current) return;

    persisting.current = true;
    setSaving(true);
    try {
      await persist();
    } catch (err) {
      if (err instanceof McpConfigUnreadableError) {
        toast.error(t("mcp.configUnreadable"));
      } else {
        toast.error(`Failed to save: ${err}`);
      }
    } finally {
      persisting.current = false;
      setSaving(false);
    }
  };

  const pickFolder = async (apply: (path: string) => void) => {
    try {
      const picked = await tauriApi.openFolderDialog();
      if (picked) apply(picked);
    } catch (err) {
      toast.error(t("mcpd.folderPickFailed", { error: String(err) }));
    }
  };

  const testFailed = validation.status === 'error';
  const busy = saving || validation.status === 'testing';
  const savedToPath =
    editServer?.source === 'notesage-project' && editServer.projectRoot
      ? `${editServer.projectRoot}/.notesage/mcp.json`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editServer ? t("mcps.editServer") : t("mcps.addServer")}</DialogTitle>
          <DialogDescription>{t("mcp.configureSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto thin-scrollbar -mx-1 px-1">
          {untrusted && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" strokeWidth={1.5} />
              <AlertTitle>{t("mcp.requestedByExternalLink")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {t("mcps.deepLinkWarning")}
                </p>
                <label className="flex items-start gap-2 text-foreground">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(c) => setAcknowledged(c === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    {t("mcpd.reviewed")}
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5" role="group" aria-labelledby={`${fieldId}-transport`}>
            <Label id={`${fieldId}-transport`} className="text-xs text-muted-foreground">{t("mcp.transport")}</Label>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(['stdio', 'http'] as const).map((kind) => {
                const active = transport === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTransport(kind)}
                    className={cn(
                      'px-3 py-1 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {kind === 'stdio' ? t("mcp.transportLocal") : t("mcp.transportRemote")}
                  </button>
                );
              })}
            </div>
          </div>

          {isRemote ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-url`} className="text-xs text-muted-foreground">{t("mcp.serverUrl")}</Label>
                <Input
                  id={`${fieldId}-url`}
                  value={url ?? ''}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="font-mono text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("mcpd.httpHint")}
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
                    {oauthOk ? t("mcps.authorized") : t("mcps.authorize")}
                  </Button>
                </div>
              </div>

              <KeyValueRows
                label={t("mcpd.headers")}
                hint={t("mcpd.headersHint")}
                rows={headerPairs}
                onChange={setHeaderPairs}
                keyPlaceholder={t("mcpd.headerNamePlaceholder")}
                keyLabel={t("mcpd.headerName")}
                valueLabel={t("mcpd.headerValue")}
              />
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-command`} className="text-xs text-muted-foreground">{t("mcp.command")}</Label>
                <Input
                  id={`${fieldId}-command`}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t("mcpd.commandHint")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-args`} className="text-xs text-muted-foreground">{t("mcp.arguments")}</Label>
                <Input
                  id={`${fieldId}-args`}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="/path/to/directory"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t("mcpd.argumentsQuotedHint")}</p>
              </div>

              {requiredArgs.map((arg) => {
                const inputId = `${fieldId}-arg-${arg.key}`;
                const value = argAnswers[arg.key] ?? '';
                const setValue = (next: string) =>
                  setArgAnswers((prev) => ({ ...prev, [arg.key]: next }));
                const required = isArgRequired(arg);
                return (
                  <div key={arg.key} className="space-y-1.5">
                    <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                      {arg.label}
                      {' '}
                      <span>{required ? t("mcpd.requiredMark") : t("mcpd.optionalMark")}</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={inputId}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-required={required}
                        placeholder={arg.kind === 'path' ? '/path/to/directory' : undefined}
                        className="font-mono text-sm flex-1"
                      />
                      {arg.kind === 'path' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1"
                          aria-label={t("mcpd.browseFor", { label: arg.label })}
                          onClick={() => pickFolder(setValue)}
                        >
                          <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                          {t("mcpd.browse")}
                        </Button>
                      )}
                    </div>
                    {required && !value.trim() && (
                      <p className="text-xs text-muted-foreground">{t("mcpd.requiredArgHint")}</p>
                    )}
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-cwd`} className="text-xs text-muted-foreground">
                  {t("mcpd.workingDirectory")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${fieldId}-cwd`}
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder={t("mcpd.workingDirectoryPlaceholder")}
                    className="font-mono text-sm flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1"
                    aria-label={t("mcpd.browseFor", { label: t("mcpd.workingDirectory") })}
                    onClick={() => pickFolder(setCwd)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t("mcpd.browse")}
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-name`} className="text-xs text-muted-foreground">{t("mcp.displayName")}</Label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isRemote ? t("mcpd.autoFromUrl") : t("mcpd.autoFromCommand")}
              className="text-sm"
            />
          </div>

          {/* Environment variables are a local process's; a remote server gets headers. */}
          {!isRemote && (
            <KeyValueRows
              label={t("mcp.envVars")}
              rows={envPairs}
              onChange={setEnvPairs}
              keyPlaceholder="KEY"
              keyLabel={t("mcpd.envName")}
              valueLabel={t("mcpd.envValue")}
            />
          )}

          {/* Validation result — tool preview on success, actionable error on failure */}
          <div aria-live="polite">
            {validation.status === 'testing' && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                  {t("mcpd.testing")}
                </div>
                <p className="text-xs text-muted-foreground">{t("mcpd.testingSlowHint")}</p>
              </div>
            )}
            {validation.status === 'ok' && (
              <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {t("mcp.connectedTools", { count: validation.result.tools.length })}
                </div>
                {validation.result.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {validation.result.tools.slice(0, 12).map((tool) => (
                      <Badge key={tool.name} variant="secondary" className="h-4 px-1.5 text-xs font-normal font-mono">
                        {tool.name}
                      </Badge>
                    ))}
                    {validation.result.tools.length > 12 && (
                      <span className="text-xs text-muted-foreground self-center">
                        {t("mcp.moreTools", { count: validation.result.tools.length - 12 })}
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
                  <span className="whitespace-pre-wrap break-words">{validation.result.error ?? t("mcps.startFailed")}</span>
                </div>
                {validation.result.error_kind === 'timeout' && (
                  <p className="text-xs text-muted-foreground">{t("mcpd.timeoutHint")}</p>
                )}
                {validation.result.stderr_tail && (
                  <Collapsible>
                    <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {t("custagent.showDetails")}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap select-text">
                        {validation.result.stderr_tail}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                )}
                <p className="text-xs text-muted-foreground">{t("mcpd.saveAnywayHint")}</p>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {savedToPath ? t("mcpd.savedToFile", { path: savedToPath }) : t("mcpd.savedTo")}
          </p>
        </div>

        <DialogFooter className="gap-2 flex-wrap sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={busy || !hasRequiredFields || gateBlocked}
          >
            {validation.status === 'testing' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <Wrench className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
            )}
            {t("mcpd.test")}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            {/* Always there; the main action once a test has failed. */}
            <Button
              variant={testFailed ? 'default' : 'outline'}
              onClick={() => save(false)}
              disabled={saving || !hasRequiredFields || gateBlocked}
            >
              {t("mcpd.saveWithoutTesting")}
            </Button>
            <Button
              variant={testFailed ? 'outline' : 'default'}
              onClick={() => save(true)}
              disabled={busy || !hasRequiredFields || gateBlocked}
            >
              {saving ? t("common.saving") : editServer ? t("common.update") : t("mcps.addServerAction")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
