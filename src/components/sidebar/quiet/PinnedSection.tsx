import { type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { SidebarContextMenu } from "@/components/sidebar/quiet/SidebarContextMenu";
import {
  chainKeyHandlers,
  useSidebarItemShortcuts,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { cn } from "@/lib/utils";
import { FilePreview } from "./FilePreview";

/**
 * PinnedSection — the pinned-files list for the quiet-composer sidebar.
 *
 * Reads absolute file paths from `workspace-store.pinnedFiles`. The list is
 * hidden (header only) when nothing is pinned to avoid an empty-state
 * placeholder. Manual ordering from drag-to-reorder (#44) is preserved by
 * rendering `pinnedFiles` in array order.
 */

export interface PinnedSectionProps {
  /**
   * Click handler for the `+` add button. When omitted, the button pins the
   * currently active tab (if any); otherwise the caller decides what "add"
   * means. The button is always rendered so its hover/focus affordances are
   * exercised by visual regression tests.
   */
  onAdd?: () => void;
  /**
   * Case-insensitive substring filter applied to pinned file basenames. When
   * non-empty, rows whose basename doesn't contain `filter` are hidden from
   * the list. Task #43 — sidebar type-to-filter. Empty / undefined = no
   * filter (default behavior).
   */
  filter?: string;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

interface PinnedRowProps {
  path: string;
  isActive: boolean;
  onOpen: (path: string) => void | Promise<void>;
}

/**
 * Single row in the pinned list. Extracted from PinnedSection so we can
 * install the row-level ⌘⌥C / ⌘⌥R shortcut hook per row (#46). The hook
 * must run inside a component because it captures `filePath` in the
 * returned handler.
 */
function PinnedRow({ path, isActive, onOpen }: PinnedRowProps) {
  const name = basename(path);
  const { onKeyDown: shortcutKeyDown } = useSidebarItemShortcuts({
    filePath: path,
    kind: "file",
  });

  const handleOpenKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void onOpen(path);
    }
  };

  // Shortcuts first (⌘⌥C / ⌘⌥R). When a shortcut matches it calls
  // preventDefault and chainKeyHandlers short-circuits so Enter/Space
  // handling doesn't double-fire on the same keystroke.
  const onKeyDown = chainKeyHandlers(shortcutKeyDown, handleOpenKeys);

  return (
    <FilePreview filePath={path}>
      <SidebarContextMenu
        filePath={path}
        kind="file"
        onOpen={() => void onOpen(path)}
      >
        <div
          role="button"
          tabIndex={0}
          data-active={isActive ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          title={path}
          onClick={() => void onOpen(path)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm transition-colors duration-150",
            "hover:bg-muted/50",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
            isActive && "bg-muted",
          )}
        >
          <FileIcon fileName={name} />
          <span className="truncate min-w-0">{name}</span>
        </div>
      </SidebarContextMenu>
    </FilePreview>
  );
}

export function PinnedSection({ onAdd, filter }: PinnedSectionProps) {
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const { openFile } = useFileOperations();

  // Apply the case-insensitive filter at render time — transient UI state,
  // no re-fetch. Empty filter leaves the list untouched.
  const visibleFiles = filter
    ? pinnedFiles.filter((path) =>
        basename(path).toLowerCase().includes(filter.toLowerCase()),
      )
    : pinnedFiles;

  const handleDefaultAdd = () => {
    if (!activeFilePath) {
      toast.info("Open a file to pin it");
      return;
    }
    pinFile(activeFilePath);
  };

  const handleOpen = async (path: string) => {
    try {
      await openFile(path, basename(path));
    } catch (error) {
      toast.error(`Failed to open file: ${error}`);
    }
  };

  return (
    <section
      aria-label="Pinned"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Pinned
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add pinned"
          onClick={onAdd ?? handleDefaultAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {visibleFiles.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {visibleFiles.map((path) => (
            <li key={path}>
              <PinnedRow
                path={path}
                isActive={activeFilePath === path}
                onOpen={handleOpen}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
