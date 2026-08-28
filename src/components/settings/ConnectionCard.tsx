import { useState, useCallback, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Connection } from '@/lib/ai/connections';
import { CAPABILITY_LABELS, prettyModelName, setAgentModels } from '@/lib/ai/connections';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Settings2, Unplug, HeartPulse, Loader2, Check, X, ArrowUpCircle, Shield, Globe, KeyRound, BrainCog, Trash2, LogOut } from 'lucide-react';
import { LocalAIModelsDialog } from './LocalAIModelsDialog';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { tauriApi, type CopilotStatus, type LocalServerStatus } from '@/lib/tauri';
import type { AcpSessionResult, AcpSpawnResult } from '@/lib/ai/acp-utils';
import { canReauthenticate } from '@/lib/ai/reauth';
import { isLocalAgentPreset, resolveAgentLaunch, resolveLocalAgentEndpoint } from '@/lib/ai/acp-agent-state';
import { LocalAgentAttribution } from './LocalAgentAttribution';
import { ReauthDialog } from './ReauthDialog';
import { ConnectionUsageDetail } from './ConnectionUsageDetail';
import { t } from '@/lib/i18n';

const AUTH_BADGES: Record<string, string> = {
  api_key: 'API Key',
  agent_managed: 'Subscription',
  local: 'Local',
  local_bundled: 'On-device',
};

function StatusDot({ status, tooltip }: { status: Connection['status']; tooltip?: string }) {
  const colors: Record<Connection['status'], string> = {
    connected: 'bg-green-500',
    expired: 'bg-yellow-500',
    error: 'bg-red-500',
    not_installed: 'bg-muted-foreground/40',
  };

  const defaultTooltips: Record<Connection['status'], string> = {
    connected: 'Connected',
    expired: 'Not ready',
    error: 'Error',
    not_installed: 'Not installed',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status]}`}
      title={tooltip ?? defaultTooltips[status]}
    />
  );
}

type HealthState = 'idle' | 'testing' | 'ok' | 'fail';

export interface AgentUpdateAvailable {
  agentId: string;
  currentVersion: string;
  latestVersion: string;
  /** Upstream is past the exact-tested version pin — not installable here.
   *  Renders as an informational "held back" line, not a clickable update. */
  heldBack?: boolean;
  /** Whether an update is actually pending.
   *
   *  This object is now present for EVERY managed agent, including current
   *  ones, so the card can show an installed version rather than nothing —
   *  which is what made "check for agent updates" look like it did nothing.
   *  Its presence no longer implies an update; this flag does. */
  hasUpdate: boolean;
}

interface ConnectionCardProps {
  connection: Connection;
  onConfigure?: (connection: Connection) => void;
  onDisconnect?: (connection: Connection) => void;
  updateAvailable?: AgentUpdateAvailable | null;
  onUpdateComplete?: () => void;
}

export function ConnectionCard({ connection, onConfigure, onDisconnect, updateAvailable, onUpdateComplete }: ConnectionCardProps) {
  const [health, setHealth] = useState<HealthState>('idle');
  const [healthError, setHealthError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  /** 0–100 while an update downloads, `null` when unknown. */
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [modelsDialogOpen, setModelsDialogOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const updateConnection = useConnectionsStore((s) => s.updateConnection);

  const isRenamable = connection.provider === 'openai_compatible';

  // The agent id for agent_manager.rs commands is the binary name — the same
  // mapping ConnectionsSettings uses for `agent_update` (see updateAvailable).
  const agentBinary =
    connection.authMethod === 'agent_managed'
      ? (connection.credentials as { agentBinary?: string }).agentBinary ?? null
      : null;
  const isCopilotLsp = agentBinary === 'copilot-language-server';
  // Uninstall applies only to binaries Notesage itself installed
  // (~/.notesage/agents/bin/) — never to PATH-resolved system binaries.
  const canUninstall = connection.binarySource === 'managed' && !!agentBinary;

  const handleUninstall = useCallback(async () => {
    if (!agentBinary) return;
    setUninstalling(true);
    try {
      await tauriApi.agentUninstall(agentBinary);
      // Refresh installed-state: a PATH-resolved system binary may still
      // exist; if nothing resolves, the connection is no longer usable.
      let resolution: Awaited<ReturnType<typeof tauriApi.agentResolveBinary>> = null;
      try {
        resolution = await tauriApi.agentResolveBinary(agentBinary);
      } catch {
        // Resolver failure — treat as not installed.
      }
      if (resolution) {
        updateConnection(connection.id, { binarySource: resolution.source });
      } else {
        updateConnection(connection.id, { binarySource: undefined, status: 'not_installed' });
      }
      toast.success(`Uninstalled ${agentBinary}`);
      setUninstallOpen(false);
    } catch (err) {
      toast.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUninstalling(false);
    }
  }, [agentBinary, connection.id, updateConnection]);

  const handleCopilotSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await tauriApi.copilotLspSignOut();
      // The OAuth token is gone — mark the connection as needing re-auth so
      // the key icon (re-authenticate) surfaces, mirroring the reauth flow's
      // status transitions.
      updateConnection(connection.id, { status: 'expired' });
      toast.success(t("conn.signedOutCopilot"));
    } catch (err) {
      toast.error(`Sign out failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSigningOut(false);
    }
  }, [connection.id, updateConnection]);

  // Download progress for THIS agent's update.
  //
  // `agent_install` (which `agent_update` reuses) emits `agent-install-progress`
  // with `agent_id`, `progress` and `total`. `LocalAgentSetupDialog` already
  // draws a bar from these; this surface ignored them and showed a bare
  // spinner, which for a ~79 MB tarball is indistinguishable from a hang.
  //
  // Mounted only while updating, so idle cards register no listeners.
  useEffect(() => {
    if (!updating || !updateAvailable) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ agent_id: string; progress: number; total: number }>(
      'agent-install-progress',
      (event) => {
        const p = event.payload;
        if (p.agent_id !== updateAvailable.agentId) return;
        // `total` is 0 until the server reports a content-length; leave the
        // label on the version string rather than showing a fake 0%.
        if (!p.total) return;
        setUpdateProgress(Math.min(100, Math.round((p.progress / p.total) * 100)));
      },
    ).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [updating, updateAvailable]);

  const startRename = useCallback(() => {
    setLabelDraft(connection.label);
    setEditingLabel(true);
    requestAnimationFrame(() => labelInputRef.current?.select());
  }, [connection.label]);

  const commitRename = useCallback(() => {
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== connection.label) {
      updateConnection(connection.id, { label: trimmed });
    }
    setEditingLabel(false);
  }, [labelDraft, connection.id, connection.label, updateConnection]);

  const testConnection = useCallback(async () => {
    setHealth('testing');
    setHealthError(null);

    try {
      if (connection.authMethod === 'agent_managed') {
        const creds = connection.credentials as { agentBinary: string; agentArgs?: string[] };
        const isLsp = creds.agentBinary === 'copilot-language-server';

        if (isLocalAgentPreset(connection)) {
          // The generic ACP health check below spawns from `credentials.agentBinary`
          // /`agentArgs` with NO env. The Local Agent preset keeps its `acp` arg in
          // `config.binaryArgs` and needs the Goose env (GOOSE_PROVIDER/OPENAI_HOST/
          // GOOSE_MODEL/GOOSE_DISABLE_KEYRING) + the bundled llama-server port — without
          // them Goose falls into its interactive `goose configure` flow and dies in the
          // non-TTY subprocess ("goose configure requires an interactive terminal"), so
          // the heartbeat failed even though chat works. Run the same smoke test the
          // setup uses (correct binary+args, live-regenerated env, llama port, preset
          // sandbox) so the heartbeat reflects what chat actually does.
          const launch = resolveAgentLaunch(connection);
          const endpoint = await resolveLocalAgentEndpoint(connection);
          const report = await tauriApi.acpAgentSmokeTest({
            agentBinary: launch.agentBinary,
            agentArgs: launch.agentArgs,
            workingDirectory: '/tmp',
            envVars: endpoint?.env ?? null,
            sandboxEnabled: true,
            sandboxPaths: ['/tmp'],
            networkSandboxEnabled: true,
            networkAllowedDomains: [],
            kernelNetworkDeny: true,
            extraLocalhostPorts: endpoint ? [endpoint.port] : null,
            requireLocalServer: true,
          });
          if (!report.ok) {
            throw new Error(report.error ?? `Verification failed at the ${report.stage} stage`);
          }
        } else if (isLsp) {
          // Copilot LSP: check status via LSP protocol (don't use ACP)
          let status = await invoke<CopilotStatus>('copilot_lsp_status');

          // Auto-recover: if the LSP isn't running, restart it and retry
          if (!status.authenticated && status.kind === 'Inactive') {
            const workingDir = useWorkspaceStore.getState().projects[0]?.path ?? '/tmp';
            await invoke('copilot_lsp_start', { workingDirectory: workingDir });
            status = await invoke<CopilotStatus>('copilot_lsp_status');
          }

          if (!status.authenticated) {
            throw new Error(status.message || 'Not authenticated');
          }
        } else {
          // ACP: spawn agent, create session, check for models, stop
          const args = [...(creds.agentArgs ?? [])];
          if (connection.config?.model) {
            if (creds.agentBinary === 'codex-acp') {
              args.push('-c', `model="${connection.config.model}"`);
            } else {
              args.push('--model', connection.config.model);
            }
          }

          const spawn = await invoke<AcpSpawnResult>('acp_agent_spawn', {
            agentBinary: creds.agentBinary,
            agentArgs: args.length > 0 ? args : null,
            role: 'interactive',
            workingDirectory: '/tmp',
            sandboxPaths: [],  // Health check: /tmp only
          });

          try {
            // Try authenticate
            try {
              await invoke('acp_agent_authenticate', { instanceId: spawn.instance_id });
            } catch (authErr) {
              const msg = String(authErr);
              if (!msg.toLowerCase().includes('not implemented')) {
                throw authErr;
              }
            }

            // Create session to get models
            const session = await invoke<AcpSessionResult>('acp_session_new', {
              instanceId: spawn.instance_id,
              workingDirectory: '/tmp',
            });

            // Cache models
            if (session.available_models.length > 0) {
              setAgentModels(
                connection.id,
                session.available_models.map((m) => ({
                  modelId: m.model_id,
                  name: m.name,
                  description: m.description,
                })),
                session.current_model,
              );
            }
          } finally {
            invoke('acp_agent_stop', { instanceId: spawn.instance_id }).catch(() => {});
          }
        }

        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'api_key') {
        // API key: try listing models — key resolved from keychain in Rust
        const baseUrl = connection.config?.baseUrl;
        const provider = connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;
        await invoke('list_models', { provider, connectionId: connection.id, baseUrl: baseUrl ?? null });
        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'local') {
        // Ollama: check tags endpoint
        const url = connection.credentials.type === 'local' ? connection.credentials.url : 'http://localhost:11434';
        await invoke('list_models', { provider: 'ollama', baseUrl: url });
        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'local_bundled') {
        // Local AI: check if llama-server is actually running
        const status = await invoke<LocalServerStatus>('get_local_server_status');
        if (status.running) {
          updateConnection(connection.id, { status: 'connected' });
          setHealth('ok');
        } else {
          throw new Error('Local AI server is not running. Enable it in the Local AI tab.');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHealthError(msg);
      updateConnection(connection.id, { status: 'error' });
      setHealth('fail');
    }

    // Reset indicator after 4 seconds
    setTimeout(() => setHealth('idle'), 4000);
  }, [connection, updateConnection]);

  const handleUpdate = useCallback(async () => {
    if (!updateAvailable) return;
    setUpdating(true);
    // Reset per attempt — a stale percentage from a previous run would read as
    // progress that is not happening.
    setUpdateProgress(null);
    try {
      const newVersion = await invoke<string>('agent_update', { agentId: updateAvailable.agentId });
      toast.success(`Updated ${updateAvailable.agentId} to v${newVersion}`);
      onUpdateComplete?.();
    } catch (err) {
      toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(false);
      setUpdateProgress(null);
    }
  }, [updateAvailable, onUpdateComplete]);

  // Derive a contextual tooltip and subtitle for the status dot
  const serverStatusReason = useLocalAIStore((s) => s.serverStatusReason);
  const statusTooltip = (() => {
    if (connection.authMethod === 'local_bundled' && serverStatusReason) {
      return serverStatusReason;
    }
    if (connection.authMethod === 'local_bundled' && connection.status === 'expired') {
      return 'Not ready';
    }
    return undefined; // use default
  })();
  const showStatusSubtitle = connection.authMethod === 'local_bundled'
    && (connection.status === 'expired' || connection.status === 'error')
    && serverStatusReason;

  return (
    <div className="space-y-0">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground/50 transition-colors duration-150">
        {/* Logo + status */}
        <div className="relative shrink-0 mt-0.5">
          <ProviderLogo provider={connection.provider} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <StatusDot status={connection.status} tooltip={statusTooltip} />
          </span>
        </div>

        {/* Center: name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {editingLabel ? (
              <input
                ref={labelInputRef}
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingLabel(false);
                }}
                className="text-sm font-medium bg-transparent border-b border-muted-foreground/40 outline-none px-0 py-0 w-32"
                autoFocus
              />
            ) : (
              <span
                className={`text-sm font-medium truncate min-w-0 ${isRenamable ? 'cursor-pointer hover:underline decoration-muted-foreground/40' : ''}`}
                onDoubleClick={isRenamable ? startRename : undefined}
                title={isRenamable ? 'Double-click to rename' : connection.label}
              >
                {connection.label}
              </span>
            )}
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {AUTH_BADGES[connection.authMethod] ?? connection.authMethod}
            </span>
            {/* Plan-ish pill (provider-usage-display #10) — surfaced when the
                account tier is known. `freeAccount` is detected at runtime for
                agent connections; a paid/plan signal may join it in Phase 3. */}
            {connection.freeAccount && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                Free account
              </span>
            )}
          </div>
          {/* Transparency: the Local Agent preset is powered by an open-source
              engine (Goose or pi) — credit it (with a link) on the connection
              card too, not just at setup. */}
          {isLocalAgentPreset(connection) && (
            <LocalAgentAttribution
              engine={connection.config?.localAgentPreset === 'pi' ? 'pi' : 'goose'}
              compact
              className="mt-0.5"
            />
          )}
          {/* Badge row wraps to multiple lines so capability + sandbox
              + network + update pills don't overflow the card on
              narrower dialog widths (live-test 2026-04-26). */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {connection.config?.model && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 max-w-[140px] truncate" title={connection.config.model}>
                {prettyModelName(connection.config.model)}
              </span>
            )}
            {connection.capabilities.map((cap) => (
              <span
                key={cap}
                className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0"
              >
                {CAPABILITY_LABELS[cap]}
              </span>
            ))}
            {connection.authMethod === 'agent_managed' && connection.sandboxEnabled !== false && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0 flex items-center gap-0.5" title={t("conn.sandboxEnabled")}>
                <Shield className="h-2.5 w-2.5" strokeWidth={2} />
                Sandbox
              </span>
            )}
            {connection.networkSandboxEnabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0 flex items-center gap-0.5" title={t("conn.networkRestrictionEnabled")}>
                <Globe className="h-2.5 w-2.5" strokeWidth={2} />
                Network
              </span>
            )}
            {connection.binarySource === 'managed' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0" title={t("conn.installedByNotesage")}>
                Managed
              </span>
            )}
            {/* The INSTALLED version, always, whenever it is known.
                Previously nothing showed a version at all, and an agent with
                no pending update rendered nothing whatsoever — so pressing
                "check for agent updates" produced no visible change and read
                as broken. A version badge is the confirmation the check ran. */}
            {updateAvailable && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0 tabular-nums"
                title={t("conn.installedVersion", { version: updateAvailable.currentVersion })}
              >
                v{updateAvailable.currentVersion}
              </span>
            )}
            {updateAvailable && updateAvailable.hasUpdate && updateAvailable.heldBack && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                title={`v${updateAvailable.latestVersion} is available upstream but not yet tested with Notesage — it will install when a Notesage update includes it.`}
              >
                Update held back
              </span>
            )}
            {updateAvailable && updateAvailable.hasUpdate && !updateAvailable.heldBack && (
              <button
                onClick={handleUpdate}
                disabled={updating}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-foreground/10 text-foreground shrink-0 hover:bg-foreground/20 transition-colors cursor-pointer flex items-center gap-1 disabled:cursor-default"
                title={`Update from v${updateAvailable.currentVersion} to v${updateAvailable.latestVersion}`}
              >
                {updating ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowUpCircle className="h-2.5 w-2.5" strokeWidth={2} />
                )}
                {/* Real progress, not just a spinner. `agent_install` already
                    emits `agent-install-progress` with bytes/total — the setup
                    dialog draws a bar from exactly these events, and this
                    surface was throwing them away. A ~79 MB download behind an
                    unlabelled spinner is indistinguishable from a hang. */}
                {updating && updateProgress !== null
                  ? `${updateProgress}%`
                  : `v${updateAvailable.currentVersion} → v${updateAvailable.latestVersion}`}
              </button>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <ConnectionUsageDetail connection={connection} />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={testConnection}
            disabled={health === 'testing'}
            title={t("conn.testConnection")}
          >
            {health === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            {health === 'ok' && <Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />}
            {health === 'fail' && <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />}
            {health === 'idle' && <HeartPulse className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </Button>
          {connection.authMethod === 'agent_managed' && (() => {
            const creds = connection.credentials as { agentBinary: string };
            if (!canReauthenticate(creds.agentBinary)) return null;
            // Only surface the key icon when the connection actually needs
            // re-auth — i.e. its status is `expired` (set on a 401 during use) or
            // `error` (a failed heartbeat). When `connected`, the icon would just
            // read as a permanent "needs attention" badge on a healthy provider.
            if (connection.status !== 'expired' && connection.status !== 'error') return null;
            return (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setReauthOpen(true)}
                title="Re-authenticate"
              >
                <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            );
          })()}
          {isCopilotLsp && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleCopilotSignOut}
              disabled={signingOut}
              title={t("conn.signOutCopilot")}
              aria-label={t("conn.signOutCopilot")}
            >
              {signingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </Button>
          )}
          {canUninstall && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => setUninstallOpen(true)}
              title={t("conn.uninstallAgentBinary")}
              aria-label={t("conn.uninstallAgentBinary")}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
          {connection.authMethod === 'local_bundled' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setModelsDialogOpen(true)}
              title={t("conn.manageModels")}
              aria-label={t("conn.manageLocalModels")}
            >
              <BrainCog className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
          {onConfigure && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onConfigure(connection)}
              title={t("conn.configure")}
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
          {onDisconnect && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDisconnect(connection)}
              title={t("conn.disconnect")}
            >
              <Unplug className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      {showStatusSubtitle && health !== 'fail' && (
        <p className="text-xs text-muted-foreground px-4 py-1 break-words">
          {serverStatusReason}
        </p>
      )}
      {health === 'fail' && healthError && (
        <p className="text-xs text-destructive px-4 py-1.5 break-words">
          {healthError}
        </p>
      )}
      {connection.authMethod === 'local_bundled' && (
        <LocalAIModelsDialog
          open={modelsDialogOpen}
          onOpenChange={setModelsDialogOpen}
        />
      )}
      {connection.authMethod === 'agent_managed' && (
        <ReauthDialog
          connection={connection}
          open={reauthOpen}
          onOpenChange={setReauthOpen}
        />
      )}
      {canUninstall && (
        <AlertDialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Uninstall {connection.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                The binary will be removed; your connection settings remain.
                You can reinstall it any time from this connection card.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={uninstalling}>{t("conn.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Keep the dialog open while the IPC call runs; it closes
                  // on success inside handleUninstall.
                  e.preventDefault();
                  void handleUninstall();
                }}
                disabled={uninstalling}
              >
                {uninstalling ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />
                ) : null}
                Uninstall
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
