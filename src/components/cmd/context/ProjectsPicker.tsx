import { useMemo } from "react";
import { Lock, ChevronUp, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PickerCheckboxItem } from "@/components/ui/picker-item";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkspaceProject } from "@/stores/workspace-store";
import type { ProjectMetadata } from "@/stores/project-metadata-store";

interface ProjectsPickerProps {
  /** Currently-selected project paths (active conversation scope). */
  projectPaths: string[];
  /** All workspace projects (selected + unselected). */
  workspaceProjects: WorkspaceProject[];
  /** Per-project metadata — used to surface the lock icon. */
  metadataMap: Record<string, ProjectMetadata>;
  /** Toggle a project ON (handles lock conflict checks upstream). */
  onToggle: (path: string) => void;
  /** Toggle a project OFF (skips lock conflict checks — already in scope). */
  onRemove: (path: string) => void;
  /** Open the explain-lock dialog for a locked project. */
  onExplainLock: (path: string) => void;
}

/**
 * Project multiselect picker (live-test 2026-04-26). Single trigger
 * button shows the count + a representative label; popover shows every
 * workspace project with a checkmark for selected ones — `+`
 * consolidated menu pattern.
 */
export function ProjectsPicker({
  projectPaths,
  workspaceProjects,
  metadataMap,
  onToggle,
  onRemove,
  onExplainLock,
}: ProjectsPickerProps) {
  // Trigger label: "All projects" if every workspace project is selected;
  // a single name when only one is selected; "<name> +N" when multiple.
  const triggerLabel = useMemo(() => {
    if (projectPaths.length === 0) return "Projects";
    if (workspaceProjects.length > 0 &&
        projectPaths.length === workspaceProjects.length) {
      return "All projects";
    }
    if (projectPaths.length === 1) {
      const meta = metadataMap[projectPaths[0]];
      return meta?.name?.trim() || basename(projectPaths[0]);
    }
    const firstMeta = metadataMap[projectPaths[0]];
    const firstName = firstMeta?.name?.trim() || basename(projectPaths[0]);
    return `${firstName} +${projectPaths.length - 1}`;
  }, [projectPaths, workspaceProjects.length, metadataMap]);

  // Indicate lock state on the trigger when ANY selected project is locked.
  const anyLocked = projectPaths.some((p) => Boolean(metadataMap[p]?.aiLock));

  // Sorted projects for the popover — selected first (alphabetical),
  // unselected after (alphabetical).
  const sortedProjects = useMemo(() => {
    const byName = (a: WorkspaceProject, b: WorkspaceProject) => {
      const an = metadataMap[a.path]?.name?.trim() || basename(a.path);
      const bn = metadataMap[b.path]?.name?.trim() || basename(b.path);
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    };
    const selected: WorkspaceProject[] = [];
    const unselected: WorkspaceProject[] = [];
    for (const p of workspaceProjects) {
      if (projectPaths.includes(p.path)) selected.push(p);
      else unselected.push(p);
    }
    selected.sort(byName);
    unselected.sort(byName);
    return [...selected, ...unselected];
  }, [workspaceProjects, projectPaths, metadataMap]);

  const allSelected =
    workspaceProjects.length > 0 &&
    projectPaths.length === workspaceProjects.length;

  const tooltipText =
    projectPaths.length === 0
      ? "Pick projects to scope chat to"
      : `${projectPaths.length} project${projectPaths.length === 1 ? "" : "s"} in scope: ${triggerLabel}`;

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={
                  projectPaths.length === 0
                    ? "Pick projects"
                    : `${projectPaths.length} project${projectPaths.length === 1 ? "" : "s"} selected — ${triggerLabel}`
                }
                className={cn(
                  // Same h-7 command-bar rhythm as ProviderPill.
                  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md min-w-0 shrink",
                  "text-xs font-medium",
                  "border border-transparent",
                  "transition-colors duration-150",
                  projectPaths.length > 0
                    ? "text-foreground bg-muted hover:border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate min-w-0">{triggerLabel}</span>
                {anyLocked ? (
                  <Lock
                    className="w-3 h-3 opacity-60 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                ) : null}
                <ChevronUp className="w-3 h-3 opacity-50 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[260px]">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent side="top" align="start" className="w-64 p-1">
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Projects
        </div>
        {workspaceProjects.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No projects open
          </div>
        ) : (
          <>
            {workspaceProjects.length > 1 ? (
              <PickerCheckboxItem
                label={allSelected ? "Deselect all" : "Select all"}
                checked={allSelected}
                onCheckedChange={() => {
                  if (allSelected) {
                    // Deselect all selected.
                    for (const p of [...projectPaths]) onRemove(p);
                  } else {
                    // Select all not-yet-selected (skip locked-conflict —
                    // `onToggle` enforces it). Best-effort.
                    for (const p of workspaceProjects) {
                      if (!projectPaths.includes(p.path)) onToggle(p.path);
                    }
                  }
                }}
                onSelect={(e: Event) => e.preventDefault()}
              />
            ) : null}
            {sortedProjects.map((project) => {
              const isChecked = projectPaths.includes(project.path);
              const locked = Boolean(metadataMap[project.path]?.aiLock);
              const name =
                metadataMap[project.path]?.name?.trim() ||
                basename(project.path);
              return (
                <PickerCheckboxItem
                  key={project.path}
                  label={name}
                  trailing={
                    locked ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onExplainLock(project.path);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onExplainLock(project.path);
                          }
                        }}
                        aria-label={`${name} is locked to a provider`}
                        className="shrink-0 inline-flex text-foreground hover:text-foreground/80 transition-colors rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <Lock className="h-3 w-3" strokeWidth={1.5} />
                      </span>
                    ) : null
                  }
                  checked={isChecked}
                  onCheckedChange={() => {
                    if (isChecked) onRemove(project.path);
                    else onToggle(project.path);
                  }}
                  onSelect={(e: Event) => e.preventDefault()}
                />
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(path: string): string {
  if (!path) return "";
  // Trim trailing slashes so "/foo/bar/" -> "bar" rather than "".
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}
