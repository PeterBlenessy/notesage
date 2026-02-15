import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QuickOpen } from "@/components/QuickOpen";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { PanelLeft, MessageSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const BREAKPOINT_WIDE = 1200; // px
const SIDEBAR_FLOAT_WIDTH = 280; // px - sidebar width in narrow/floating mode
const PANEL_SIZES_KEY = "notesage-panel-sizes";

function savePanelSizes(key: string, sizes: Record<string, number>) {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    stored[key] = sizes;
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(stored));
  } catch {}
}

function loadPanelSize(key: string, panel: string, fallback: number): number {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    return stored[key]?.[panel] ?? fallback;
  } catch {
    return fallback;
  }
}

// Editor area with document-style presentation
function EditorArea() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-muted)' }}>
      <TabBar />
      <Editor />
    </div>
  );
}

function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isWideMode, setIsWideMode] = useState(window.innerWidth >= BREAKPOINT_WIDE);
  const { sidebarOpen, setSidebarOpen, chatPanelOpen, setChatPanelOpen } = useSettingsStore();

  useKeyboardShortcuts();

  const handleWideLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes("wide", layout);
  }, []);

  const handleNarrowLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes("narrow", layout);
  }, []);

  // Track window width for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setIsWideMode(window.innerWidth >= BREAKPOINT_WIDE);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+P for quick open
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible(true);
      }

      // Cmd+B for sidebar toggle
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarOpen(!useSettingsStore.getState().sidebarOpen);
      }

      // Cmd+Shift+A for AI chat toggle
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "a") {
        e.preventDefault();
        setChatPanelOpen(!useSettingsStore.getState().chatPanelOpen);
      }

      // Cmd+, for settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ThemeProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        {/* Title Bar & Toolbar */}
        <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Notesage</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(sidebarOpen && "bg-accent")}
              title={`${sidebarOpen ? "Hide" : "Show"} Sidebar (Cmd+B)`}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChatPanelOpen(!chatPanelOpen)}
              className={cn(chatPanelOpen && "bg-accent")}
              title={`${chatPanelOpen ? "Hide" : "Show"} AI Chat (Cmd+Shift+A)`}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              title="Settings (Cmd+,)"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden relative">
          {isWideMode ? (
            // WIDE MODE: All panels docked and resizable
            <ResizablePanelGroup direction="horizontal" className="flex h-full w-full" onLayoutChanged={handleWideLayout}>
              {sidebarOpen && (
                <>
                  <ResizablePanel id="sidebar" defaultSize={loadPanelSize("wide", "sidebar", 20)} minSize={200} maxSize={400}>
                    <Sidebar />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              )}

              <ResizablePanel id="editor" defaultSize={loadPanelSize("wide", "editor", sidebarOpen && chatPanelOpen ? 50 : 70)} minSize={300}>
                <EditorArea />
              </ResizablePanel>

              {chatPanelOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="chat" defaultSize={loadPanelSize("wide", "chat", 30)} minSize={280} maxSize={500}>
                    <ChatPanel onClose={() => setChatPanelOpen(false)} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          ) : (
            // NARROW MODE: Sidebar floats, content + chat are docked
            <>
              {/* Backdrop overlay - click to close sidebar */}
              {sidebarOpen && (
                <div
                  className="absolute inset-0 bg-black/20 z-[9]"
                  onClick={() => setSidebarOpen(false)}
                />
              )}

              {/* Floating Sidebar Overlay */}
              {sidebarOpen && (
                <div
                  className="absolute left-0 top-0 bottom-0 z-10 shadow-2xl"
                  style={{ width: `${SIDEBAR_FLOAT_WIDTH}px`, backgroundColor: 'var(--color-card)' }}
                >
                  <Sidebar />
                </div>
              )}

              {/* Content + Chat (always docked) */}
              <ResizablePanelGroup
                direction="horizontal"
                className="flex h-full w-full"
                onLayoutChanged={handleNarrowLayout}
              >
                <ResizablePanel id="editor-narrow" minSize={300}>
                  <EditorArea />
                </ResizablePanel>

                {chatPanelOpen && (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel id="chat-narrow" defaultSize={loadPanelSize("narrow", "chat-narrow", 35)} minSize={280} maxSize={500}>
                      <ChatPanel onClose={() => setChatPanelOpen(false)} />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </>
          )}
        </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <QuickOpen open={quickOpenVisible} onOpenChange={setQuickOpenVisible} />
      </div>
    </ThemeProvider>
  );
}

export default App;
