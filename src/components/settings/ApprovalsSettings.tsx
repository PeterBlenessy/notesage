import { useMemo } from 'react';
import { ShieldCheck, Trash2, AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePermissionStore, type ScopedApproval } from '@/stores/permission-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';
import { t } from '@/lib/i18n';

type ApprovalCategory = 'tool_call' | 'acp_tool' | 'skill_script';

interface UnifiedApproval {
  category: ApprovalCategory;
  approval: ScopedApproval;
}

interface DomainApprovalRow {
  connectionId: string;
  projectRoot: string | null;
  domain: string;
}

function basenameFromPath(path: string | null): string {
  if (!path) return '';
  return path.split('/').filter(Boolean).pop() || path;
}

function ConnectionCell({
  connectionId,
  connection,
}: {
  connectionId: string | null;
  connection: Connection | undefined;
}) {
  if (connectionId === null) {
    return <span className="italic text-muted-foreground/70">any</span>;
  }
  if (!connection) {
    const short = connectionId.startsWith('conn-') ? connectionId.slice(-6) : connectionId;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default italic text-muted-foreground">
            Unknown ({short})
          </span>
        </TooltipTrigger>
        <TooltipContent>Deleted connection · {connectionId}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 cursor-default">
          <span className="text-foreground">{connection.label}</span>
          <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
            {connection.provider}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{connectionId}</TooltipContent>
    </Tooltip>
  );
}

function formatCategoryLabel(category: ApprovalCategory): string {
  switch (category) {
    case 'tool_call':
      return 'Tool call';
    case 'acp_tool':
      return 'ACP tool';
    case 'skill_script':
      return 'Skill script';
  }
}

export function ApprovalsSettings() {
  const alwaysAllowed = usePermissionStore((s) => s.alwaysAllowed);
  const toolCallAlways = usePermissionStore((s) => s.toolCallAlways);
  const skillScriptAlways = usePermissionStore((s) => s.skillScriptAlways);
  const domainAlwaysAllowed = usePermissionStore((s) => s.domainAlwaysAllowed);
  const connections = useConnectionsStore((s) => s.connections);

  const connectionMap = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const c of connections) map.set(c.id, c);
    return map;
  }, [connections]);

  /** Short display label for bulk action buttons (aria-labels + button text). */
  const connectionLabel = (id: string | null): string => {
    if (id === null) return 'any';
    const conn = connectionMap.get(id);
    if (conn) return conn.label;
    const short = id.startsWith('conn-') ? id.slice(-6) : id;
    return `Unknown (${short})`;
  };

  const scopedApprovals: UnifiedApproval[] = useMemo(() => {
    return [
      ...toolCallAlways.map((a) => ({ category: 'tool_call' as const, approval: a })),
      ...alwaysAllowed.map((a) => ({ category: 'acp_tool' as const, approval: a })),
      ...skillScriptAlways.map((a) => ({ category: 'skill_script' as const, approval: a })),
    ];
  }, [toolCallAlways, alwaysAllowed, skillScriptAlways]);

  const domainRows: DomainApprovalRow[] = useMemo(() => {
    const rows: DomainApprovalRow[] = [];
    for (const [connectionId, byProject] of Object.entries(domainAlwaysAllowed)) {
      for (const [bucket, domains] of Object.entries(byProject)) {
        const projectRoot = bucket === 'global' ? null : bucket;
        for (const domain of domains) {
          rows.push({ connectionId, projectRoot, domain });
        }
      }
    }
    return rows;
  }, [domainAlwaysAllowed]);

  const allScopeProjects = useMemo(() => {
    const set = new Set<string>();
    for (const { approval } of scopedApprovals) {
      if (approval.projectRoot) set.add(approval.projectRoot);
    }
    for (const row of domainRows) {
      if (row.projectRoot) set.add(row.projectRoot);
    }
    return [...set].sort();
  }, [scopedApprovals, domainRows]);

  const allScopeConnections = useMemo(() => {
    const set = new Set<string>();
    for (const { approval } of scopedApprovals) {
      if (approval.connectionId) set.add(approval.connectionId);
    }
    for (const row of domainRows) set.add(row.connectionId);
    return [...set].sort();
  }, [scopedApprovals, domainRows]);

  const hasLegacy = useMemo(
    () =>
      scopedApprovals.some(
        ({ approval }) => approval.connectionId === null && approval.projectRoot === null,
      ),
    [scopedApprovals],
  );

  const isEmpty = scopedApprovals.length === 0 && domainRows.length === 0;

  function handleRevokeScoped(entry: UnifiedApproval) {
    const store = usePermissionStore.getState();
    const { category, approval } = entry;
    if (category === 'tool_call') {
      store.removeToolAlways(approval.toolName, approval.connectionId, approval.projectRoot);
    } else if (category === 'acp_tool') {
      store.removeAlways(approval.toolName, approval.connectionId, approval.projectRoot);
    } else {
      store.removeSkillScriptAlways(approval.toolName, approval.connectionId, approval.projectRoot);
    }
  }

  function handleRevokeDomain(row: DomainApprovalRow) {
    const store = usePermissionStore.getState();
    store.removeDomain(row.connectionId, row.domain, row.projectRoot);
  }

  function handleRevokeAllLegacy() {
    usePermissionStore.setState((state) => ({
      alwaysAllowed: state.alwaysAllowed.filter(
        (a) => !(a.connectionId === null && a.projectRoot === null),
      ),
      toolCallAlways: state.toolCallAlways.filter(
        (a) => !(a.connectionId === null && a.projectRoot === null),
      ),
      skillScriptAlways: state.skillScriptAlways.filter(
        (a) => !(a.connectionId === null && a.projectRoot === null),
      ),
    }));
  }

  function handleRevokeAllForConnection(connectionId: string) {
    usePermissionStore.setState((state) => {
      const nextDomains = { ...state.domainAlwaysAllowed };
      delete nextDomains[connectionId];
      return {
        alwaysAllowed: state.alwaysAllowed.filter((a) => a.connectionId !== connectionId),
        toolCallAlways: state.toolCallAlways.filter((a) => a.connectionId !== connectionId),
        skillScriptAlways: state.skillScriptAlways.filter((a) => a.connectionId !== connectionId),
        domainAlwaysAllowed: nextDomains,
      };
    });
  }

  function handleRevokeAllForProject(projectRoot: string) {
    usePermissionStore.setState((state) => {
      const nextDomains: typeof state.domainAlwaysAllowed = {};
      for (const [connId, byProject] of Object.entries(state.domainAlwaysAllowed)) {
        const filtered: Record<string, string[]> = {};
        for (const [bucket, domains] of Object.entries(byProject)) {
          if (bucket !== projectRoot) filtered[bucket] = domains;
        }
        if (Object.keys(filtered).length > 0) nextDomains[connId] = filtered;
      }
      return {
        alwaysAllowed: state.alwaysAllowed.filter((a) => a.projectRoot !== projectRoot),
        toolCallAlways: state.toolCallAlways.filter((a) => a.projectRoot !== projectRoot),
        skillScriptAlways: state.skillScriptAlways.filter((a) => a.projectRoot !== projectRoot),
        domainAlwaysAllowed: nextDomains,
      };
    });
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-foreground" strokeWidth={1.5} />
            <Label className="text-sm font-semibold">{t("approvals.title")}</Label>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Review and revoke persisted &quot;Always allow&quot; approvals. Scoped by tool,
            connection, and project.
          </p>
        </div>

        {isEmpty ? (
          <div className="rounded-lg border border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No persisted approvals yet. Approvals you grant with &quot;Allow always&quot; will
              appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Bulk actions */}
            <div className="flex flex-wrap gap-2">
              {hasLegacy && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleRevokeAllLegacy}
                  aria-label={t("approvals.revokeAllLegacy")}
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  {t("approvals.revokeAllLegacy")}
                </Button>
              )}
              {allScopeConnections.map((connId) => (
                <Button
                  key={`conn-${connId}`}
                  variant="outline"
                  size="xs"
                  onClick={() => handleRevokeAllForConnection(connId)}
                  aria-label={`Revoke all for ${connectionLabel(connId)}`}
                >
                  Revoke all for {connectionLabel(connId)}
                </Button>
              ))}
              {allScopeProjects.map((projectRoot) => (
                <Button
                  key={`proj-${projectRoot}`}
                  variant="outline"
                  size="xs"
                  onClick={() => handleRevokeAllForProject(projectRoot)}
                  aria-label={`Revoke all for ${projectRoot}`}
                >
                  Revoke all for {basenameFromPath(projectRoot)}
                </Button>
              ))}
            </div>

            {/* Scoped tool/skill approvals table */}
            {scopedApprovals.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colTool")}</th>
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colKind")}</th>
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colConnection")}</th>
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colProject")}</th>
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colGranted")}</th>
                      <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-right">{t("approvals.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedApprovals.map((entry, idx) => {
                      const { approval } = entry;
                      const isLegacy =
                        approval.connectionId === null && approval.projectRoot === null;
                      return (
                        <tr
                          key={`${entry.category}-${approval.toolName}-${approval.connectionId}-${approval.projectRoot}-${idx}`}
                          data-row="approval"
                          className={cn(
                            'border-t border-border',
                            isLegacy && 'bg-muted/30',
                          )}
                        >
                          <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">{approval.toolName}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">
                            {formatCategoryLabel(entry.category)}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <ConnectionCell
                              connectionId={approval.connectionId}
                              connection={approval.connectionId ? connectionMap.get(approval.connectionId) : undefined}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">
                            {approval.projectRoot ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default">
                                    {basenameFromPath(approval.projectRoot)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{approval.projectRoot}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="italic text-muted-foreground/70">any</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
                            {new Date(approval.grantedAt).toISOString().slice(0, 10)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {isLegacy && (
                                <span className="inline-flex items-center whitespace-nowrap px-1.5 py-px rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                  legacy, broad
                                </span>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleRevokeScoped(entry)}
                                    aria-label={`Revoke ${approval.toolName}`}
                                  >
                                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("approvals.revoke")}</TooltipContent>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Domain approvals table */}
            {domainRows.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Network domains
                </Label>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/40">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colDomain")}</th>
                        <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colConnection")}</th>
                        <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{t("approvals.colProject")}</th>
                        <th className="px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-right">{t("approvals.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domainRows.map((row, idx) => (
                        <tr
                          key={`dom-${row.connectionId}-${row.projectRoot}-${row.domain}-${idx}`}
                          data-row="approval"
                          className="border-t border-border"
                        >
                          <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">{row.domain}</td>
                          <td className="px-2.5 py-1.5">
                            <ConnectionCell
                              connectionId={row.connectionId}
                              connection={connectionMap.get(row.connectionId)}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">
                            {row.projectRoot ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default">
                                    {basenameFromPath(row.projectRoot)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{row.projectRoot}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="italic text-muted-foreground/70">any</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => handleRevokeDomain(row)}
                                  aria-label={`Revoke ${row.domain}`}
                                >
                                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("approvals.revoke")}</TooltipContent>
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
