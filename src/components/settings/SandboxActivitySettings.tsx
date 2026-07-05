import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { tauriApi, type NetworkProxyStatus } from '@/lib/tauri';
import { getAllAcpAgents } from '@/lib/ai/acp-agent-state';
import { useConnectionsStore } from '@/stores/connections-store';
import { usePermissionStore } from '@/stores/permission-store';
import { PROVIDER_OPTIONS, type Connection } from '@/lib/ai/connections';
import { cn } from '@/lib/utils';

/**
 * Minimal sandbox observability panel (Settings > AI Providers > Sandbox
 * Activity). Read-only: lists each running per-agent network proxy from
 * `network_proxy_status` — connection, proxy port, session-approved domain
 * count, and the effective domain allowlist (built-in provider domains +
 * the user's persisted/session approvals from the permission store).
 *
 * The full observability surface (violation history, live request feed) is
 * a follow-up PRD (`docs/prds/2026-04-19-agent-sandbox-observability.md`);
 * this panel intentionally stops at "what is running and what may it reach".
 */
export function SandboxActivitySettings() {
  const [statuses, setStatuses] = useState<NetworkProxyStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const connections = useConnectionsStore((s) => s.connections);
  const getDomainAllowedList = usePermissionStore((s) => s.getDomainAllowedList);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await tauriApi.networkProxyStatus();
      setStatuses(result);
      setFailed(false);
    } catch {
      setStatuses([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    // Map instance id → connection via the live ACP agent registry. Agents
    // that died between the status snapshot and now simply fall back to the
    // agent binary + truncated instance id.
    const agents = getAllAcpAgents();
    return statuses.map((status) => {
      const agent = agents.find((a) => a.instanceId === status.instanceId);
      const connection: Connection | null = agent
        ? connections.find((c) => c.id === agent.connectionId) ?? null
        : null;

      const providerOption = PROVIDER_OPTIONS.find(
        (o) => o.agentBinary === status.agentId || o.lspBinary === status.agentId,
      );
      const builtIn = providerOption?.installMeta?.allowedDomains ?? [];
      const userDomains = connection ? getDomainAllowedList(connection.id, null) : [];
      const domains = [...new Set([...builtIn, ...userDomains])];

      return {
        status,
        connection,
        port: status.proxyAddr.split(':').pop() ?? status.proxyAddr,
        domains,
      };
    });
  }, [statuses, connections, getDomainAllowedList]);

  return (
    <div data-testid="sandbox-activity" className="space-y-2 py-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          {failed
            ? 'Could not read proxy status.'
            : rows.length === 0
              ? 'No sandboxed agents running.'
              : `${rows.length} sandboxed ${rows.length === 1 ? 'agent' : 'agents'} running.`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => void refresh()}
          disabled={loading}
          aria-busy={loading}
          aria-label="Refresh sandbox status"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.5}
            className={cn(loading && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ status, connection, port, domains }) => (
            <li
              key={status.instanceId}
              className="rounded-lg border border-border bg-background px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck
                  size={16}
                  strokeWidth={1.5}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="truncate text-[13px] font-medium text-foreground">
                  {connection
                    ? connection.label
                    : `${status.agentId} · ${status.instanceId.slice(-8)}`}
                </span>
                {connection && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    {connection.provider}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-[11px] text-muted-foreground">
                <span>
                  Proxy port <span className="font-mono text-foreground/80">{port}</span>
                </span>
                <span>
                  {status.sessionDomainCount} session-approved{' '}
                  {status.sessionDomainCount === 1 ? 'domain' : 'domains'}
                </span>
                <span>{status.allowedDomainCount} allowlisted at spawn</span>
              </div>
              <Collapsible>
                <CollapsibleTrigger className="group mt-1 flex items-center gap-1 pl-6 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight
                    size={12}
                    strokeWidth={1.5}
                    className="transition-transform duration-150 group-data-[state=open]:rotate-90"
                  />
                  Effective allowlist
                  <span className="text-muted-foreground/60">({domains.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {domains.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 pl-10">
                      {domains.map((domain) => (
                        <li
                          key={domain}
                          className="font-mono text-[11px] text-muted-foreground"
                        >
                          {domain}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 pl-10 text-[11px] italic text-muted-foreground/70">
                      No domains — kernel deny confines this agent to localhost.
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
