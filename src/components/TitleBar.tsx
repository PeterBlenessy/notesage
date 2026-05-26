import { X } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * TitleBar — top chrome for QuietLayout.
 *
 * Renders the document title (drag region) plus the dirty dot + close-document
 * `×` button in the right zone when a document is active. Was previously a
 * discriminated union of classic vs quiet modes; Classic Layout removal
 * (#325) dropped the classic branch.
 */
export interface TitleBarProps {
  /**
   * Optional extra utility classes appended to the root. Used by
   * `QuietLayout` (#132) to switch the bar to absolute positioning
   * when translucent chrome is enabled.
   */
  className?: string;
}

export function TitleBar(props: TitleBarProps) {
  const activeTab = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const title = activeTab?.fileName ?? "Notesage";
  const isDirty = Boolean(activeTab?.isDirty);

  // ⌘W mirror — closes the active document (or routes through the
  // setPendingCloseTabId warn flow when the doc is dirty).
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

  const docChrome = activeTab ? (
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
          // Live-test 2026-04-26 — the X is hover-revealed: invisible
          // at rest, fades in when the user hovers ANY part of the
          // title bar (the `group/titlebar` lives on the outer wrapper).
          // `focus-visible:opacity-100` keeps keyboard users from
          // losing the affordance.
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
        // `group/titlebar` so the close-document X (and any future
        // hover-revealed chrome) can fade in only when the bar is hovered.
        "group/titlebar h-9 flex items-center shrink-0 select-none",
        // Live-test 2026-04-25 — the title bar is now ALWAYS
        // absolute-positioned by QuietLayout (so the sidebar's right
        // border can run unbroken to y=0). The frosted bg + blur are
        // gated on the user's `quietChromeTransparent` preference via
        // the layout-root data attribute — when on, the bar is
        // translucent and editor content scrolls behind it; when off,
        // the bar is solid with no blur. Sibling selectors in
        // globals.css carry the doc-area's own pt-clearance toggle.
        "bg-background",
        "[[data-quiet-chrome-transparent='true']_&]:bg-background/40",
        "[[data-quiet-chrome-transparent='true']_&]:backdrop-blur-xl",
        props.className,
      )}
      data-tauri-drag-region
      // CSS hook for `.app.focus-mode [data-titlebar-mode="quiet"]` in
      // globals.css which hides the title bar entirely in focus mode.
      // The attribute is now constant ("quiet") since Classic Layout
      // removal left QuietLayout as the only consumer.
      data-titlebar-mode="quiet"
    >
      {/* Center: document title (drag region) */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 px-4"
        data-tauri-drag-region
      >
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "text-xs truncate",
                  activeTab ? "text-foreground font-medium" : "text-muted-foreground"
                )}
                data-tauri-drag-region
              >
                {title}
              </span>
            </TooltipTrigger>
            {activeTab && (
              <TooltipContent side="bottom">{activeTab.filePath}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Right: dirty dot + close button. */}
      {docChrome}
    </div>
  );
}
