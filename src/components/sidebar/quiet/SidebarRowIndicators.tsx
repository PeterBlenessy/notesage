import { useMemo } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileTreeItemState } from "@/hooks/useFileTreeItemState";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Shared visual-state indicators for every Quiet Composer sidebar row
 * (task #129). Renders the same three classes of state the legacy
 * `FileTreeItem` carries:
 *
 *   - git status — single-letter glyph from `useFileTreeItemState`
 *     (M / A / U / D / R / C; `●` when a folder contains changes).
 *   - external-change indicator — dim dot when another process wrote
 *     the file behind our back (same state the classic path uses to
 *     drive its inline diff review).
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

  // AI-lock only matters on project rows. The selector returns
  // undefined for non-project paths, which short-circuits the padlock.
  const aiLock = useProjectMetadataStore((s) => {
    if (kind !== "project") return undefined;
    return s.metadataMap[path]?.aiLock ?? undefined;
  });

  const hasAnyIndicator =
    Boolean(gitInfo) || hasExternalChange || Boolean(aiLock);

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
                aria-label="External change pending review"
                className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
              />
            </TooltipTrigger>
            <TooltipContent side="top">Changed externally</TooltipContent>
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

        {aiLock ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label="Project locked to an AI provider"
                className="inline-flex items-center text-muted-foreground"
              >
                <Lock className="h-3 w-3" strokeWidth={1.5} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Locked to {aiLock.connectionId}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </TooltipProvider>
    </span>
  );
}

export default SidebarRowIndicators;
