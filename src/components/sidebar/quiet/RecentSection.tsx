import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileIcon } from "../FileIcon";
import { SidebarContextMenu } from "@/components/sidebar/quiet/SidebarContextMenu";
import {
  chainKeyHandlers,
  useSidebarItemShortcuts,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { useEditorStore, type RecentFile } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { parseFileError } from "@/lib/file-errors";
import { cn } from "@/lib/utils";
import { FilePreview } from "./FilePreview";
import { beginFileDrag } from "./file-drag";

/**
 * RecentSection — quiet-composer sidebar recent-documents list (task #33).
 *
 * Reads `recentFiles` from `editor-store` (already capped at 5 by the store
 * via `MAX_RECENT_FILES` and ordered most-recent-first). "Recent" is a
 * derived list — there is no explicit add action.
 *
 * Cap-based display: up to `DEFAULT_RECENT_CAP` rows are shown by default.
 * A "Show more" toggle below reveals all entries when `recentFiles.length`
 * exceeds the cap. Task #35 will replace the hardcoded default with a
 * user-configurable `recentCap` in settings-store.
 */

/** Default display cap for the Recent section. Task #35 will let users override via settings. */
export const DEFAULT_RECENT_CAP = 5;

export interface RecentSectionProps {
  /** Override the display cap. When omitted, `DEFAULT_RECENT_CAP` is used. */
  cap?: number;
  /**
   * Case-insensitive substring filter applied to recent rows. Matches
   * against both `entry.name` (basename) AND the parent-folder hint so
   * "notes" matches either a file named `notes-today.md` or any file
   * inside a `notes/` folder. Task #43 — sidebar type-to-filter.
   */
  filter?: string;
}

/** Derive a compact parent-folder hint from a file path (last directory component). */
function getParentFolderHint(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  // Drop the filename; the parent is the last remaining directory.
  if (segments.length < 2) return "";
  return segments[segments.length - 2] ?? "";
}

interface RecentRowProps {
  entry: RecentFile;
  isActive: boolean;
  onOpen: (entry: RecentFile) => void;
}

function RecentRow({ entry, isActive, onOpen }: RecentRowProps) {
  const parentHint = useMemo(() => getParentFolderHint(entry.path), [entry.path]);
  const [isDragging, setIsDragging] = useState(false);

  const handleActivate = () => onOpen(entry);

  const { onKeyDown: shortcutKeyDown } = useSidebarItemShortcuts({
    filePath: entry.path,
    kind: "file",
  });

  // Shortcuts (⌘⌥C / ⌘⌥R) first. When they match they preventDefault and
  // chainKeyHandlers short-circuits so Enter/Space doesn't double-fire.
  const onKeyDown = chainKeyHandlers(shortcutKeyDown, (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivate();
    }
  });

  return (
    <FilePreview filePath={entry.path}>
      <SidebarContextMenu
        filePath={entry.path}
        kind="file"
        onOpen={handleActivate}
      >
        <div
          role="button"
          tabIndex={0}
          draggable
          aria-current={isActive ? "page" : undefined}
          data-active={isActive ? "true" : undefined}
          data-dragging={isDragging ? "true" : undefined}
          onClick={handleActivate}
          onKeyDown={onKeyDown}
          onDragStart={(e) => {
            beginFileDrag(e, entry.path);
            setIsDragging(true);
          }}
          onDragEnd={() => setIsDragging(false)}
          title={entry.path}
          className={cn(
            "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isActive
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            isDragging && "opacity-50",
          )}
        >
          <FileIcon fileName={entry.name} />
          <span className="truncate min-w-0 flex-1">{entry.name}</span>
          {parentHint && (
            <span
              aria-hidden="true"
              className="text-xs text-muted-foreground/70 truncate ml-auto max-w-[10ch]"
            >
              {parentHint}
            </span>
          )}
        </div>
      </SidebarContextMenu>
    </FilePreview>
  );
}

export function RecentSection({
  cap = DEFAULT_RECENT_CAP,
  filter,
}: RecentSectionProps = {}) {
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const { openFile } = useFileOperations();

  const [expanded, setExpanded] = useState(false);

  // Apply the filter before cap/overflow logic so "Show more" only fires
  // when there are additional matches hidden behind the cap.
  const filteredFiles = useMemo(() => {
    if (!filter) return recentFiles;
    const needle = filter.toLowerCase();
    return recentFiles.filter((entry) => {
      const parent = getParentFolderHint(entry.path).toLowerCase();
      return (
        entry.name.toLowerCase().includes(needle) || parent.includes(needle)
      );
    });
  }, [recentFiles, filter]);

  const hasOverflow = filteredFiles.length > cap;
  // Auto-collapse when the list shrinks below the cap so the "Show more"
  // button never lingers with nothing extra to reveal.
  const effectiveExpanded = expanded && hasOverflow;
  const visibleFiles = effectiveExpanded
    ? filteredFiles
    : filteredFiles.slice(0, cap);

  const handleOpen = async (entry: RecentFile) => {
    try {
      await openFile(entry.path, entry.name);
    } catch (error) {
      toast.error(`Failed to open: ${parseFileError(error)}`);
    }
  };

  return (
    <section
      aria-label="Recent"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Recent
        </h2>
      </header>
      {filteredFiles.length > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            {visibleFiles.map((entry) => (
              <RecentRow
                key={entry.path}
                entry={entry}
                isActive={entry.path === activeFilePath}
                onOpen={handleOpen}
              />
            ))}
          </div>
          {hasOverflow && (
            <button
              type="button"
              aria-expanded={effectiveExpanded}
              aria-label={
                effectiveExpanded ? "Show fewer recent files" : "Show more recent files"
              }
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "self-start px-2 py-0.5 text-xs text-muted-foreground",
                "hover:text-foreground underline-offset-2 hover:underline",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
                "transition-colors duration-150",
              )}
            >
              {effectiveExpanded ? "Show fewer" : "Show more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
