import { X } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * TitleBar — top chrome for the Quiet Composer shell.
 *
 * Renders a drag region with the document title centred, plus a
 * dirty dot + close-document button in the right zone when a document is open.
 */
export interface TitleBarProps {
  mode: "quiet";
  /** Optional extra utility classes appended to the root. */
  className?: string;
}

export function TitleBar(props: TitleBarProps) {
  const activeTab = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });

  const title = activeTab?.fileName ?? "Notesage";
  const isDirty = Boolean(activeTab?.isDirty);

  const handleCloseActiveTab = () => {
    const editorState = useEditorStore.getState();
    const id = editorState.activeTabId;
    if (!id) return;
    const tab = editorState.openDocuments.find((t) => t.id === id);
    if (tab?.isDirty) {
      editorState.setPendingCloseTabId(id);
      return;
    }
    editorState.closeTab(id);
  };

  const quietDocChrome =
    activeTab ? (
      <div className="flex items-center gap-2 pr-3 shrink-0">
        {isDirty ? (
          <span
            role="status"
            aria-label="Unsaved changes"
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--accent, var(--primary))" }}
          />
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCloseActiveTab}
          className={cn(
            "text-xs text-muted-foreground hover:text-foreground",
            "opacity-0 group-hover/titlebar:opacity-100 focus-visible:opacity-100",
            "transition-[color,opacity] duration-150",
          )}
          title="Close document (⌘W)"
          aria-label="Close document"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    ) : null;

  return (
    <div
      className={cn(
        "group/titlebar h-9 flex items-center shrink-0 select-none",
        "bg-background",
        "[[data-quiet-chrome-transparent='true']_&]:bg-background/40",
        "[[data-quiet-chrome-transparent='true']_&]:backdrop-blur-xl",
        props.className,
      )}
      data-tauri-drag-region
      data-titlebar-mode={props.mode}
    >
      {/* Center: document title (drag region) */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 px-4"
        data-tauri-drag-region
      >
        <span
          className={cn(
            "text-xs truncate",
            activeTab ? "text-foreground font-medium" : "text-muted-foreground"
          )}
          data-tauri-drag-region
        >
          {title}
        </span>
      </div>

      {/* Right: dirty dot + close button */}
      {quietDocChrome}
    </div>
  );
}
