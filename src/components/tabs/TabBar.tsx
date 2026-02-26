import { useEditorStore, type FileType } from "@/stores/editor-store";
import { X, FileText, FileImage, FileType2, FileSpreadsheet, File } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();

  const handleCloseTab = (
    e: React.MouseEvent,
    tabId: string,
    isDirty: boolean
  ) => {
    e.stopPropagation();

    if (isDirty) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close anyway?"
      );
      if (!confirmed) return;
    }

    closeTab(tabId);
  };

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className="h-9 border-b border-border flex items-end shrink-0 overflow-x-auto overflow-y-hidden gap-0.5 px-2 bg-background"
    >
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-1.5 px-3 h-8 text-sm rounded-t-md transition-colors duration-150 shrink-0 max-w-[200px]",
              isActive
                ? "bg-muted text-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
            )}

            {/* Dirty dot */}
            {tab.isDirty && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            )}

            {/* File type icon */}
            <TabIcon fileType={tab.fileType} />

            {/* File name */}
            <span className={cn("truncate", tab.deleted && "line-through text-muted-foreground")}>{tab.fileName}</span>

            {/* Close button */}
            <span
              onClick={(e) => handleCloseTab(e, tab.id, tab.isDirty)}
              className={cn(
                "shrink-0 rounded-sm p-0.5 transition-all cursor-pointer inline-flex items-center justify-center",
                isActive
                  ? "opacity-60 hover:opacity-100 hover:bg-foreground/10"
                  : "opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-foreground/10"
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
  );
}
