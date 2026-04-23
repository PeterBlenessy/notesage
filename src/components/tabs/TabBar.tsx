import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore, type FileType } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { X, FileText, FileImage, FileType2, FileSpreadsheet, File } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TAB_DRAG_MIME = "application/x-notesage-tab";

function TabIcon({ fileType }: { fileType?: FileType }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  switch (fileType) {
    case "pdf":
      return <FileType2 className={cls} strokeWidth={1.5} />;
    case "docx":
      return <FileSpreadsheet className={cls} strokeWidth={1.5} />;
    case "image":
      return <FileImage className={cls} strokeWidth={1.5} />;
    case "other":
      return <File className={cls} strokeWidth={1.5} />;
    case "markdown":
    default:
      return <FileText className={cls} strokeWidth={1.5} />;
  }
}

export function TabBar() {
  const tabs = useEditorStore((s) => s.openDocuments);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const reorderTab = useEditorStore((s) => s.reorderTab);
  const pendingCloseTabId = useEditorStore((s) => s.pendingCloseTabId);
  const setPendingCloseTabId = useEditorStore((s) => s.setPendingCloseTabId);
  const { saveFile } = useFileOperations();
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);

  // Scroll the active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  const doCloseTab = useCallback((tabId: string) => {
    // Hide the editor content instantly via DOM before React's synchronous
    // unmount of heavy viewers (e.g., PDF with hundreds of canvas elements).
    const editorContent = document.getElementById("editor-content");
    if (editorContent) editorContent.style.visibility = "hidden";

    closeTab(tabId);

    // Restore visibility after React finishes rendering the new state.
    requestAnimationFrame(() => {
      if (editorContent) editorContent.style.visibility = "";
    });
  }, [closeTab]);

  const handleCloseTab = (
    e: React.MouseEvent | React.KeyboardEvent,
    tabId: string,
    isDirty: boolean
  ) => {
    e.stopPropagation();

    if (isDirty) {
      setPendingCloseTabId(tabId);
      return;
    }

    doCloseTab(tabId);
  };

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingCloseTabId) return;
    const tab = tabs.find((t) => t.id === pendingCloseTabId);
    if (!tab) return;
    try {
      await saveFile(tab.filePath, tab.content, tab.id);
      doCloseTab(pendingCloseTabId);
    } catch {
      toast.error(`Failed to save "${tab.fileName}"`);
    }
    setPendingCloseTabId(null);
  }, [pendingCloseTabId, tabs, saveFile, doCloseTab]);

  const handleDiscard = useCallback(() => {
    if (!pendingCloseTabId) return;
    doCloseTab(pendingCloseTabId);
    setPendingCloseTabId(null);
  }, [pendingCloseTabId, doCloseTab]);

  const pendingTab = pendingCloseTabId ? tabs.find((t) => t.id === pendingCloseTabId) : null;

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(TAB_DRAG_MIME, String(index));
    setDraggingIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setDropIndicatorIndex(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Determine if cursor is in the left or right half of the tab
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const insertIndex = e.clientX < midpoint ? index : index + 1;
    setDropIndicatorIndex(insertIndex);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    const sourceIndexStr = e.dataTransfer.getData(TAB_DRAG_MIME);
    if (!sourceIndexStr) return;
    e.preventDefault();

    const fromIndex = parseInt(sourceIndexStr, 10);
    if (dropIndicatorIndex === null || isNaN(fromIndex)) return;

    // Adjust toIndex: if dragging forward, the removal shifts indices
    let toIndex = dropIndicatorIndex;
    if (fromIndex < toIndex) toIndex -= 1;
    if (fromIndex !== toIndex) {
      reorderTab(fromIndex, toIndex);
    }

    setDraggingIndex(null);
    setDropIndicatorIndex(null);
  }, [dropIndicatorIndex, reorderTab]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the tab bar entirely
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDropIndicatorIndex(null);
    }
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
    <div
      className="h-9 border-b border-border flex items-end shrink-0 overflow-x-auto overflow-y-hidden tabbar-scrollbar gap-0.5 px-2 bg-background"
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {tabs.map((tab, index) => {
        const isActive = activeTabId === tab.id;
        const isDragging = draggingIndex === index;
        const showIndicatorBefore = dropIndicatorIndex === index && draggingIndex !== index && draggingIndex !== index - 1;

        return (
          <button
            key={tab.id}
            ref={isActive ? activeTabRef : undefined}
            onClick={() => setActiveTab(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            className={cn(
              "group relative flex items-center gap-1.5 px-3 h-8 text-sm rounded-t-md transition-colors duration-150 shrink-0 max-w-[200px] focus-visible:outline-none",
              isActive
                ? "bg-muted text-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:text-foreground focus-visible:bg-muted",
              isDragging && "opacity-50"
            )}
          >
            {/* Drop insertion indicator — left side */}
            {showIndicatorBefore && (
              <span className="absolute -left-[2px] top-0 bottom-0 w-[2px] bg-primary rounded-full z-10" />
            )}

            {/* Drop insertion indicator — right side (after last tab) */}
            {dropIndicatorIndex === index + 1 && draggingIndex !== index && draggingIndex !== index + 1 && (
              <span className="absolute -right-[2px] top-0 bottom-0 w-[2px] bg-primary rounded-full z-10" />
            )}

            {/* Active indicator */}
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
            )}

            {/* Dirty dot — primary affordance (unsaved-changes signal); reaches the accent
                token so it picks up the user's accent. Falls back to neutral primary today. */}
            {tab.isDirty && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-primary)] shrink-0" />
            )}

            {/* File type icon */}
            <TabIcon fileType={tab.fileType} />

            {/* File name */}
            <span className={cn("truncate", tab.deleted && "line-through text-muted-foreground")}>{tab.fileName}</span>

            {/* Close button */}
            <span
              onClick={(e) => handleCloseTab(e, tab.id, tab.isDirty)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCloseTab(e, tab.id, tab.isDirty); } }}
              tabIndex={0}
              className={cn(
                "shrink-0 rounded-sm p-0.5 transition-all cursor-pointer inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                isActive
                  ? "opacity-60 hover:opacity-100 hover:bg-foreground/10"
                  : "opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-foreground/10 focus-visible:opacity-60"
              )}
              role="button"
              aria-label="Close tab"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </span>
          </button>
        );
      })}
    </div>

    <AlertDialog open={pendingCloseTabId !== null} onOpenChange={(open) => { if (!open) setPendingCloseTabId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{pendingTab?.fileName}&rdquo; has unsaved changes. What would you like to do?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleDiscard}>Discard</Button>
          <AlertDialogAction onClick={handleSaveAndClose}>Save &amp; Close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
