import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { GlobeLock, Shield, X as XIcon, Plus } from 'lucide-react';
import type { Connection } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { usePermissionStore } from '@/stores/permission-store';
import { t } from '@/lib/i18n';

/** Telemetry domains managed by the toggle (not shown in the domain list) */
const TELEMETRY_DOMAINS: readonly string[] = ['sentry.io', '*.sentry.io', '*.datadoghq.com'];

interface AdvancedSettingsFormProps {
  connection: Connection;
  sandboxEnabled: boolean;
  onSandboxEnabledChange: (enabled: boolean) => void;
  extraWritablePaths: string[];
  onExtraWritablePathsChange: (paths: string[]) => void;
  newWritablePath: string;
  onNewWritablePathChange: (value: string) => void;
  networkSandbox: boolean;
  onNetworkSandboxChange: (enabled: boolean) => void;
  kernelNetworkDeny: boolean;
  onKernelNetworkDenyChange: (enabled: boolean) => void;
  newDomain: string;
  onNewDomainChange: (value: string) => void;
}

export function AdvancedSettingsForm({
  connection,
  sandboxEnabled,
  onSandboxEnabledChange,
  extraWritablePaths,
  onExtraWritablePathsChange,
  newWritablePath,
  onNewWritablePathChange,
  networkSandbox,
  onNetworkSandboxChange,
  kernelNetworkDeny,
  onKernelNetworkDenyChange,
  newDomain,
  onNewDomainChange,
}: AdvancedSettingsFormProps) {
  const isAgentManaged = connection.authMethod === 'agent_managed';
  const domainsByConn = usePermissionStore((s) => s.domainAlwaysAllowed);

  if (!isAgentManaged) return null;

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("conn.security")}</p>

        {/* Sandbox */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <Label className="text-sm font-medium">{t("conn.sandbox")}</Label>
            </div>
            <Switch
              checked={sandboxEnabled}
              onCheckedChange={(checked) => {
                onSandboxEnabledChange(checked);
                if (!checked) onNetworkSandboxChange(false);
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Restricts agent file system access. The agent can only write to your project folders, temp directories, and its own config. Sensitive directories like ~/.ssh and ~/.aws are always blocked.
          </p>
          {sandboxEnabled && extraWritablePaths.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[11px] font-medium text-muted-foreground">{t("conn.extraWritablePaths")}</p>
              {extraWritablePaths.map((p) => (
                <div key={p} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground flex-1 truncate">{p}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => onExtraWritablePathsChange(extraWritablePaths.filter((x) => x !== p))}
                    title={t("conn.remove")}
                  >
                    <XIcon className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {sandboxEnabled && (
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                placeholder={t("conn.addWritablePathPlaceholder")}
                value={newWritablePath}
                onChange={(e) => onNewWritablePathChange(e.target.value)}
                className="h-7 text-xs flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newWritablePath.trim()) {
                    onExtraWritablePathsChange([...extraWritablePaths, newWritablePath.trim()]);
                    onNewWritablePathChange('');
                  }
                }}
              />
              <Button
                variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                aria-label={t("conn.addWritablePath")}
                title={t("conn.addWritablePath")}
                onClick={() => {
                  if (newWritablePath.trim()) {
                    onExtraWritablePathsChange([...extraWritablePaths, newWritablePath.trim()]);
                    onNewWritablePathChange('');
                  }
                }}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>

        {/* Network Restriction */}
        {sandboxEnabled && (
          <div className="rounded-lg border border-border p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GlobeLock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                <Label className="text-sm font-medium">{t("conn.networkRestriction")}</Label>
              </div>
              <Switch
                checked={networkSandbox}
                onCheckedChange={onNetworkSandboxChange}
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Routes all agent network traffic through a local proxy that filters by domain. Only approved domains can be reached. Requests to unknown domains require your explicit approval before they go through.
            </p>
            {networkSandbox && (
              <div className="pt-1 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-medium">{t("conn.kernelEnforcement")}</Label>
                  <Switch
                    checked={kernelNetworkDeny}
                    onCheckedChange={onKernelNetworkDenyChange}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Blocks direct network at the OS level. Disable if agents
                  fail to start.
                </p>
              </div>
            )}
            {networkSandbox && (() => {
              const ab = connection.credentials.type === 'agent_managed'
                ? (connection.credentials as { agentBinary: string }).agentBinary
                : '';
              const provOpt = PROVIDER_OPTIONS.find(
                (o) => o.agentBinary === ab || o.lspBinary === ab
              );
              const builtInDomains = provOpt?.installMeta?.allowedDomains ?? [];
              // The settings UI surfaces the "global" (cross-project) bucket of
              // always-allowed domains for this connection. Per-project buckets
              // land here via the per-project scope enforcement work (tasks
              // #6/#8/#12) — the shape supports them even though this UI doesn't
              // expose per-project scoping yet.
              const userDomains = domainsByConn[connection.id]?.global ?? [];
              const telemetryEnabled = TELEMETRY_DOMAINS.some((d) =>
                userDomains.includes(d)
              );
              const toggleTelemetry = (enabled: boolean) => {
                const store = usePermissionStore.getState();
                if (enabled) {
                  for (const d of TELEMETRY_DOMAINS) {
                    store.allowDomain(connection.id, d, 'always', null);
                  }
                } else {
                  for (const d of TELEMETRY_DOMAINS) {
                    store.removeDomain(connection.id, d, null);
                  }
                }
              };
              // Separate user domains into telemetry vs custom
              const activeTelemetryDomains = userDomains.filter((d) => TELEMETRY_DOMAINS.includes(d));
              const customDomains = userDomains.filter((d) => !TELEMETRY_DOMAINS.includes(d));

              return (
                <div className="space-y-2.5 pt-1">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-medium text-foreground">
                        Allow telemetry
                      </p>
                      <Switch
                        checked={telemetryEnabled}
                        onCheckedChange={toggleTelemetry}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Allow known telemetry endpoints. Providers may use
                      additional domains — unknown domains will prompt
                      for approval.
                    </p>
                  </div>
                  <Separator />
                  <p className="text-[11px] font-medium text-muted-foreground">{t("conn.allowedDomains")}</p>
                  <div className="space-y-1">
                    {builtInDomains.map((d) => (
                      <div key={d} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground flex-1 truncate">{d}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">API</span>
                      </div>
                    ))}
                    {activeTelemetryDomains.map((d) => (
                      <div key={d} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground flex-1 truncate">{d}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{t("conn.telemetry")}</span>
                      </div>
                    ))}
                    {customDomains.map((d) => (
                      <div key={d} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground flex-1 truncate">{d}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{t("conn.user")}</span>
                        <button
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => usePermissionStore.getState().removeDomain(connection.id, d, null)}
                          title={t("conn.remove")}
                        >
                          <XIcon className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="text"
                      placeholder={t("conn.addDomainPlaceholder")}
                      value={newDomain}
                      onChange={(e) => onNewDomainChange(e.target.value)}
                      className="h-7 text-xs flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newDomain.trim()) {
                          usePermissionStore.getState().allowDomain(connection.id, newDomain.trim(), 'always', null);
                          onNewDomainChange('');
                        }
                      }}
                    />
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      aria-label={t("conn.addAllowedDomain")}
                      title={t("conn.addAllowedDomain")}
                      onClick={() => {
                        if (newDomain.trim()) {
                          usePermissionStore.getState().allowDomain(connection.id, newDomain.trim(), 'always', null);
                          onNewDomainChange('');
                        }
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}
