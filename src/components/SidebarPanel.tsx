import { useState, useCallback, useRef, useEffect } from "react";
import { Settings, PanelLeft, GripVerticalIcon } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STRIP_WIDTH = 40;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const HOVER_DELAY = 150;
const LEAVE_DELAY = 300;

interface SidebarPanelProps {
  onOpenSettings: () => void;
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
  onOpenExistingProject?: () => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'pptx' | 'html') => void;
}

export function SidebarPanel({
  onOpenSettings,
  ...sidebarProps
}: SidebarPanelProps) {
  const { sidebarPinned, setSidebarPinned, sidebarWidth, setSidebarWidth } = useSettingsStore();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const expanded = sidebarPinned || overlayVisible;
  const expandedWidth = sidebarWidth || 280;

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Reset overlay when pinned state changes (e.g. Cmd+Shift+L)
  useEffect(() => {
    setOverlayVisible(false);
    clearTimeout(hoverTimerRef.current);
    clearTimeout(leaveTimerRef.current);
  }, [sidebarPinned]);

  // Hover to expand when collapsed
  const handleMouseEnter = useCallback(() => {
    if (sidebarPinned) return;
    clearTimeout(leaveTimerRef.current);
    if (!overlayVisible) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        setOverlayVisible(true);
      }, HOVER_DELAY);
    }
  }, [sidebarPinned, overlayVisible]);

  const scheduleCollapse = useCallback(() => {
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      // Don't collapse if a context menu or dropdown is open (rendered in a portal)
      const hasOpenOverlay = document.querySelector(
        '[data-state="open"][role="menu"], [data-state="open"][data-radix-menu-content]'
      );
      if (hasOpenOverlay) {
        // Menu still open — re-check when it closes
        scheduleCollapse();
        return;
      }
      setOverlayVisible(false);
    }, LEAVE_DELAY);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (sidebarPinned || isResizing) return;
    clearTimeout(hoverTimerRef.current);
    scheduleCollapse();
  }, [sidebarPinned, isResizing, scheduleCollapse]);

  const dismissOverlay = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    clearTimeout(leaveTimerRef.current);
    setOverlayVisible(false);
  }, []);

  const handleToggle = useCallback(() => {
    setSidebarPinned(!sidebarPinned);
  }, [sidebarPinned, setSidebarPinned]);

  // Escape to dismiss overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlayVisible && !sidebarPinned) {
        dismissOverlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [overlayVisible, sidebarPinned, dismissOverlay]);

  // Resize handle drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = expandedWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      isResizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [expandedWidth, setSidebarWidth]);

  // Toggle left position: after traffic lights when collapsed, near sidebar right edge when expanded
  const toggleLeft = expanded ? expandedWidth - 34 : 72;

  return (
    <>
      {/* Click-away backdrop for overlay */}
      {!sidebarPinned && overlayVisible && (
        <div className="fixed inset-0 z-30" onClick={dismissOverlay} />
      )}

      {/* Sidebar toggle — fixed in title bar area, slides with sidebar */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "fixed z-50 h-7 w-7 text-muted-foreground hover:text-foreground",
          !isResizing && "transition-all duration-150 ease-out",
          sidebarPinned && "text-foreground"
        )}
        style={{ left: toggleLeft, top: 4, ...(isResizing && { transition: "none" }) }}
        onClick={handleToggle}
        title={`${sidebarPinned ? "Collapse" : "Expand"} Sidebar (⌘⇧L)`}
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </Button>

      {/* Flow container — reserves width in document flow */}
      <div
        className={cn(
          "h-full shrink-0 relative z-40",
          !isResizing && "transition-[width] duration-150 ease-out"
        )}
        style={{ width: sidebarPinned ? expandedWidth : STRIP_WIDTH, ...(isResizing && { transition: "none" }) }}
      >
        {/* Panel surface — single column, overflow-hidden clips content past width */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 bg-card flex flex-col overflow-hidden",
            !isResizing && "transition-[width] duration-150 ease-out",
            !sidebarPinned && overlayVisible && "shadow-xl"
          )}
          style={{ width: expanded ? expandedWidth : STRIP_WIDTH, ...(isResizing && { transition: "none" }) }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Traffic-light spacer row */}
          <div className="shrink-0 h-9" data-tauri-drag-region />

          {/* Content below traffic lights — has the right border */}
          <div className="flex-1 flex flex-col min-h-0 border-r border-border">
            {/* Sidebar sections */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Sidebar panelCollapsed={!expanded} {...sidebarProps} />
            </div>

            {/* Bottom: Settings */}
            <button
              className="shrink-0 flex items-center h-10 w-full text-left hover:bg-accent transition-colors duration-150"
              onClick={onOpenSettings}
              title="Settings (⌘,)"
            >
              <div className="w-10 shrink-0 flex items-center justify-center">
                <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap select-none">
                Settings
              </span>
            </button>
          </div>
        </div>

        {/* Resize handle — only when pinned (not during hover auto-show) */}
        {sidebarPinned && (
          <div
            className={cn(
              "absolute top-0 bottom-0 z-50 flex items-center justify-center cursor-col-resize",
              "w-px bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
              isResizing ? "w-0.5 bg-muted-foreground" : "hover:w-0.5 hover:bg-muted-foreground",
              "transition-all"
            )}
            style={{ right: 0 }}
            onMouseDown={handleResizeStart}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex h-8 w-3 items-center justify-center rounded-full bg-muted">
              <GripVerticalIcon className="size-2.5 text-muted-foreground" strokeWidth={1.5} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
