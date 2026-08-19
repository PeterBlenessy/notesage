import { useMemo } from "react";
import { GitBranch, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileTreeItemState } from "@/hooks/useFileTreeItemState";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { describeLockTarget } from "@/lib/ai/project-lock";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

/**
 * Shared visual-state indicators for every sidebar row (task #129).
 * Renders three classes of state:
 *
 *   - git status — single-letter glyph from `useFileTreeItemState`
 *     (M / A / U / D / R / C; `●` when a folder contains changes).
 *   - git repo badge — project/folder rows that ARE a detected git repo
 *     root get a small `GitBranch` glyph (only while git integration is
 *     enabled). Tooltip shows the current branch when git-store has it.
 *     Derived purely from git-store state populated once per root by
 *     `useGitRepoDetection` — no IPC per row render.
 *   - external-change indicator — dim dot when another process wrote
 *     the file behind our back (drives the inline diff review).
 *   - AI-lock padlock — project rows only. Surfaces when the project
 *     carries an `aiLock`; tooltip lists the locked connection.
 *
 * Each indicator is wrapped in a Tooltip for context; the aria labels
 * also carry the meaning so AT users don't need the hover.
 */

export interface SidebarRowIndicatorsProps {
  /** Absolute path of the row. */
  path: string;
  kind: "file" | "folder" | "project";
  /** Optional utility classname appended to the outer flex container. */
  className?: string;
}

function resolveRepoRoot(
  path: string,
  kind: "file" | "folder" | "project",
  projects: Array<{ path: string }>,
): string | undefined {
  // Projects own themselves as their repo root; files/folders walk up to
  // the nearest ancestor project (longest-prefix wins).
  if (kind === "project") return path;
  const sorted = [...projects].sort((a, b) => b.path.length - a.path.length);
  const owning = sorted.find(
    (p) => path === p.path || path.startsWith(p.path + "/"),
  );
  return owning?.path;
}

export function SidebarRowIndicators({
  path,
  kind,
  className,
}: SidebarRowIndicatorsProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const repoRoot = useMemo(
    () => resolveRepoRoot(path, kind, projects),
    [path, kind, projects],
  );

  const { hasExternalChange, gitInfo } = useFileTreeItemState(
    path,
    kind !== "file",
    repoRoot,
  );

  // Repo badge — only for container rows that are themselves a detected
  // git repo root (populated by `useGitRepoDetection`), and only while
  // git integration is on. File rows never carry the badge.
  useLocale();
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const rowRepo = useGitStore((s) =>
    kind === "file" ? undefined : s.repos[path],
  );
  const isRepoRoot = Boolean(gitEnabled && rowRepo?.isGitRepo);
  const repoTooltip = rowRepo?.currentBranch
    ? t("git.repositoryOn", { branch: rowRepo.currentBranch })
    : t("git.repository");

  // AI-lock only matters on project rows. The selector returns
  // undefined for non-project paths, which short-circuits the padlock.
  const aiLock = useProjectMetadataStore((s) => {
    if (kind !== "project") return undefined;
    return s.metadataMap[path]?.aiLock ?? undefined;
  });

  // Resolve the locked connection's user-set label so the tooltip reads
  // "Locked to Claude — Personal" instead of leaking the raw id
  // (`conn-1774086797085-ak920t`). Falls through to the id with an
  // "(unavailable)" suffix when the connection has been removed but the
  // lock metadata still references it.
  const lockedConnection = useConnectionsStore((s) =>
    aiLock ? s.getConnection(aiLock.connectionId) : undefined,
  );
  const lockTooltip = aiLock
    ? lockedConnection
      ? `Locked to ${describeLockTarget(aiLock.connectionId, lockedConnection.label)}`
      : `Locked to ${aiLock.connectionId} (unavailable)`
    : null;

  const hasAnyIndicator =
    Boolean(gitInfo) || hasExternalChange || Boolean(aiLock) || isRepoRoot;

  if (!hasAnyIndicator) return null;

  return (
    <span
      data-sidebar-indicators
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1.5",
        className,
      )}
      aria-hidden={false}
    >
      <TooltipProvider delayDuration={400}>
        {hasExternalChange ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={t("sidebar.externalChangePending")}
                className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
              />
            </TooltipTrigger>
            <TooltipContent side="top">{t("sidebar.changedExternally")}</TooltipContent>
          </Tooltip>
        ) : null}

        {gitInfo ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={`Git: ${gitInfo.tooltip}`}
                className={cn(
                  "text-[10px] leading-none font-mono tabular-nums",
                  gitInfo.color,
                )}
              >
                {gitInfo.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{gitInfo.tooltip}</TooltipContent>
          </Tooltip>
        ) : null}

        {isRepoRoot ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={repoTooltip}
                className="inline-flex items-center text-muted-foreground"
              >
                <GitBranch className="h-3 w-3" strokeWidth={1.5} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{repoTooltip}</TooltipContent>
          </Tooltip>
        ) : null}

        {aiLock && lockTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={lockTooltip}
                className="inline-flex items-center text-muted-foreground"
              >
                <Lock className="h-3 w-3" strokeWidth={1.5} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{lockTooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </TooltipProvider>
    </span>
  );
}

export default SidebarRowIndicators;
