import { useState, useCallback, useRef, useEffect } from "react";
import { Settings, PanelLeft } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STRIP_WIDTH = 40;
const EXPANDED_WIDTH = 280;
const HOVER_DELAY = 150;
const LEAVE_DELAY = 300;

interface SidebarPanelProps {
  onOpenSettings: () => void;
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
  onOpenExistingProject?: () => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string) => void;
}

export function SidebarPanel({
  onOpenSettings,
  ...sidebarProps
}: SidebarPanelProps) {
  const { sidebarPinned, setSidebarPinned } = useSettingsStore();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const expanded = sidebarPinned || overlayVisible;

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Reset overlay when pinned state changes (e.g. Cmd+B)
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

  const handleMouseLeave = useCallback(() => {
    if (sidebarPinned) return;
    clearTimeout(hoverTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setOverlayVisible(false);
    }, LEAVE_DELAY);
  }, [sidebarPinned]);

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

  // Toggle left position: after traffic lights when collapsed, near sidebar right edge when expanded
  const toggleLeft = expanded ? EXPANDED_WIDTH - 34 : 72;

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
          "fixed z-50 h-7 w-7 text-muted-foreground hover:text-foreground transition-all duration-200 ease-in-out",
          sidebarPinned && "text-foreground"
        )}
        style={{ left: toggleLeft, top: 4 }}
        onClick={handleToggle}
        title={`${sidebarPinned ? "Collapse" : "Expand"} Sidebar (⌘B)`}
      >
        <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
      </Button>

      {/* Flow container — reserves width in document flow */}
      <div
        className="h-full shrink-0 relative z-40 transition-[width] duration-200 ease-in-out"
        style={{ width: sidebarPinned ? EXPANDED_WIDTH : STRIP_WIDTH }}
      >
        {/* Panel surface — single column, overflow-hidden clips content past width */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 bg-card flex flex-col overflow-hidden",
            "transition-[width] duration-200 ease-in-out",
            !sidebarPinned && overlayVisible && "shadow-xl"
          )}
          style={{ width: expanded ? EXPANDED_WIDTH : STRIP_WIDTH }}
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
      </div>
    </>
  );
}
