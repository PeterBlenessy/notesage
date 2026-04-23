import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";
import { FileIcon } from "../FileIcon";
import {
  SIDEBAR_ENTER_RENAME_MODE_EVENT,
  SidebarContextMenu,
} from "@/components/sidebar/quiet/SidebarContextMenu";
import { SidebarInlineEdit } from "@/components/sidebar/quiet/SidebarInlineEdit";
import {
  basename as pathBasename,
  resolveRenamePath,
  validateRenameBasename,
} from "@/components/sidebar/quiet/rename-utils";
import {
  chainKeyHandlers,
  useSidebarItemShortcuts,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { useEditorStore, type RecentFile } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
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

/**
 * Default display cap for the Recent section — used when neither an explicit
 * `cap` prop nor a persisted `sidebarRecentCap` value is available. Task #35
 * threaded the setting through; this constant remains exported as a stable
 * fallback value (and for tests that import it).
 */
export const DEFAULT_RECENT_CAP = 5;

export interface RecentSectionProps {
  /**
   * Override the display cap. When omitted, the component reads
   * `settings.sidebarRecentCap` (task #35). Primarily for tests; production
   * callers should rely on the settings value.
   */
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
  isRenaming: boolean;
  onOpen: (entry: RecentFile) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newBasename: string) => void;
  onCancelRename: () => void;
}

function RecentRow({
  entry,
  isActive,
  isRenaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: RecentRowProps) {
  const parentHint = useMemo(() => getParentFolderHint(entry.path), [entry.path]);
  const [isDragging, setIsDragging] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

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
    } else if (e.key === "F2") {
      // F2 enters rename mode (task #40). See PinnedRow for rationale.
      e.preventDefault();
      onStartRename(entry.path);
    }
  });

  // Double-click via event.detail === 2 — see PinnedRow for the same pattern.
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      onStartRename(entry.path);
      return;
    }
    handleActivate();
  };

  // Restore focus to the row when rename mode ends.
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming) {
      rowRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  return (
    <FilePreview filePath={entry.path}>
      <SidebarContextMenu
        filePath={entry.path}
        kind="file"
        onOpen={handleActivate}
      >
        <div
          ref={rowRef}
          role="button"
          tabIndex={0}
          draggable={!isRenaming}
          aria-current={isActive ? "page" : undefined}
          data-active={isActive ? "true" : undefined}
          data-dragging={isDragging ? "true" : undefined}
          data-renaming={isRenaming ? "true" : undefined}
          onClick={isRenaming ? undefined : handleClick}
          onKeyDown={isRenaming ? undefined : onKeyDown}
          onDragStart={(e) => {
            beginFileDrag(e, entry.path);
            setIsDragging(true);
          }}
          onDragEnd={() => setIsDragging(false)}
          title={entry.path}
          className={cn(
            "h-7 px-2 flex items-center gap-2 rounded-sm text-sm",
            "transition-colors duration-150",
            !isRenaming && "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isActive
              ? "bg-muted text-foreground font-medium"
              : cn(
                  "text-muted-foreground",
                  !isRenaming && "hover:bg-muted/50 hover:text-foreground",
                ),
            isDragging && "opacity-50",
          )}
        >
          <FileIcon fileName={entry.name} />
          {isRenaming ? (
            <SidebarInlineEdit
              mode="rename"
              initialValue={entry.name}
              validate={validateRenameBasename}
              onCommit={(value) => onCommitRename(entry.path, value)}
              onCancel={onCancelRename}
              className="flex-1 min-w-0"
            />
          ) : (
            <>
              <span className="truncate min-w-0 flex-1">{entry.name}</span>
              {parentHint && (
                <span
                  aria-hidden="true"
                  className="text-xs text-muted-foreground/70 truncate ml-auto max-w-[10ch]"
                >
                  {parentHint}
                </span>
              )}
            </>
          )}
        </div>
      </SidebarContextMenu>
    </FilePreview>
  );
}

export function RecentSection({
  cap,
  filter,
}: RecentSectionProps = {}) {
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  // Task #35 — read cap from settings. The explicit `cap` prop still wins
  // when provided (tests, edge-case callers) so the component remains
  // cap-agnostic from the caller's perspective.
  const settingCap = useSettingsStore((s) => s.sidebarRecentCap);
  const effectiveCap = cap ?? settingCap ?? DEFAULT_RECENT_CAP;
  const { openFile, renamePath } = useFileOperations();

  const [expanded, setExpanded] = useState(false);
  // Task #40 — inline rename state, same pattern as PinnedSection.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

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

  const hasOverflow = filteredFiles.length > effectiveCap;
  // Auto-collapse when the list shrinks below the cap so the "Show more"
  // button never lingers with nothing extra to reveal.
  const effectiveExpanded = expanded && hasOverflow;
  const visibleFiles = effectiveExpanded
    ? filteredFiles
    : filteredFiles.slice(0, effectiveCap);

  const handleOpen = async (entry: RecentFile) => {
    try {
      await openFile(entry.path, entry.name);
    } catch (error) {
      toast.error(`Failed to open: ${parseFileError(error)}`);
    }
  };

  // Rename handlers (task #40). Same semantics as PinnedSection.
  const startRename = (path: string) => setRenamingPath(path);
  const cancelRename = () => setRenamingPath(null);
  const commitRename = async (oldPath: string, newBasename: string) => {
    setRenamingPath(null);
    const oldName = pathBasename(oldPath);
    if (newBasename === oldName) return;
    const newPath = resolveRenamePath(oldPath, newBasename);
    try {
      await renamePath(oldPath, newPath);
      toast.success(`Renamed to ${pathBasename(newPath)}`);
    } catch (error) {
      toast.error(`Failed to rename: ${error}`);
    }
  };

  // Listen for the Rename context-menu event. Only activate if the path is
  // visible in this section's recent list — the other sections' listeners
  // gracefully no-op on non-matching paths.
  useEffect(() => {
    function handleRenameEvent(event: Event) {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      if (!detail?.filePath) return;
      if (!recentFiles.some((entry) => entry.path === detail.filePath)) return;
      setRenamingPath(detail.filePath);
    }
    window.addEventListener(
      SIDEBAR_ENTER_RENAME_MODE_EVENT,
      handleRenameEvent,
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_ENTER_RENAME_MODE_EVENT,
        handleRenameEvent,
      );
    };
  }, [recentFiles]);

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
                isRenaming={renamingPath === entry.path}
                onOpen={handleOpen}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
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
