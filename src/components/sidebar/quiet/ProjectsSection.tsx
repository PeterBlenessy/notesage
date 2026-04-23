import { useMemo } from "react";
import { Folder, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType } from "@/lib/file-utils";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { FolderPeek } from "./FolderPeek";

/**
 * ProjectsSection (quiet variant) — flat list of projects with `.md` file counts.
 *
 * Distinct from `src/components/sidebar/ProjectsSection.tsx` — that file
 * powers the legacy expandable sidebar and is untouched by this task. The
 * quiet-composer sidebar is a flat list (no expand/collapse) wired to
 * `workspace-store.projects`.
 */

export interface ProjectsSectionProps {
  /** Optional click handler for the `+` add button (wired by task #42). */
  onAdd?: () => void;
}

/**
 * Recursively counts the number of `.md` files in a file tree. Directories
 * and non-markdown files are skipped. The counter dives into `children` on
 * every directory, so nested folders are included in the total.
 *
 * Exported for unit testing.
 */
export function countMarkdownFiles(tree: FileEntry[]): number {
  let count = 0;
  for (const entry of tree) {
    if (entry.is_directory) {
      if (entry.children && entry.children.length > 0) {
        count += countMarkdownFiles(entry.children);
      }
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Finds the project's README (case-insensitive `readme.md` at the top level)
 * or, failing that, the first `.md` file discovered anywhere in the tree
 * (depth-first). Returns `null` if the tree contains no markdown file.
 */
function findEntryToOpen(tree: FileEntry[]): FileEntry | null {
  // Top-level README match takes precedence.
  for (const entry of tree) {
    if (!entry.is_directory && entry.name.toLowerCase() === "readme.md") {
      return entry;
    }
  }
  // Depth-first first-markdown fallback.
  const firstMarkdown = (entries: FileEntry[]): FileEntry | null => {
    for (const entry of entries) {
      if (!entry.is_directory) {
        if (entry.name.toLowerCase().endsWith(".md")) return entry;
        continue;
      }
      if (entry.children && entry.children.length > 0) {
        const nested = firstMarkdown(entry.children);
        if (nested) return nested;
      }
    }
    return null;
  };
  return firstMarkdown(tree);
}

/** Derives the project's display name from the absolute path (basename). */
function projectBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

interface ProjectRowProps {
  project: WorkspaceProject;
  isActive: boolean;
}

function ProjectRow({ project, isActive }: ProjectRowProps) {
  const openTab = useEditorStore((s) => s.openTab);
  const name = useMemo(() => projectBasename(project.path), [project.path]);
  const hasTree = project.fileTree.length > 0;
  const fileCount = useMemo(
    () => (hasTree ? countMarkdownFiles(project.fileTree) : null),
    [project.fileTree, hasTree]
  );
  const ariaLabel =
    fileCount === null
      ? `Open project ${name}`
      : `Open project ${name} (${fileCount} file${fileCount === 1 ? "" : "s"})`;

  const handleOpen = async () => {
    if (!hasTree) return;
    const entry = findEntryToOpen(project.fileTree);
    if (!entry) return;
    try {
      const raw = await invoke<string>("read_file", { path: entry.path });
      const fileType = getFileType(entry.name);
      if (fileType === "markdown") {
        const { frontmatter, content } = parseFrontmatter(raw);
        openTab(entry.path, entry.name, content, frontmatter, fileType);
      } else {
        openTab(entry.path, entry.name, raw, null, fileType);
      }
    } catch (error) {
      toast.error(`Failed to open project: ${String(error)}`);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpen();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-current={isActive ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
        isActive && "bg-muted"
      )}
    >
      <Folder
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{name}</span>
      {fileCount !== null && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {fileCount}
        </span>
      )}
    </div>
  );
}

export function ProjectsSection({ onAdd }: ProjectsSectionProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const activeTabPath = useEditorStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    const tab = s.tabs.find((t) => t.id === id);
    return tab?.filePath ?? null;
  });

  return (
    <section
      aria-label="Projects"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Projects
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add project"
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {projects.length > 0 && (
        <div className="flex flex-col">
          {projects.map((project) => {
            const isActive =
              !!activeTabPath && activeTabPath.startsWith(project.path + "/");
            return (
              <FolderPeek
                key={project.path}
                projectPath={project.path}
                fileTree={project.fileTree}
              >
                <ProjectRow project={project} isActive={isActive} />
              </FolderPeek>
            );
          })}
        </div>
      )}
    </section>
  );
}
