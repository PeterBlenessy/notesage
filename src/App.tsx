import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QuickOpen } from "@/components/QuickOpen";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { Button } from "@/components/ui/button";
import { PanelLeft, MessageSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useKeyboardShortcuts();

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
        setSidebarOpen((prev) => !prev);
      }

      // Cmd+Shift+A for AI chat toggle
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "a") {
        e.preventDefault();
        setChatPanelOpen((prev) => !prev);
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
              onClick={() => setSidebarOpen((prev) => !prev)}
              className={cn(sidebarOpen && "bg-accent")}
              title={`${sidebarOpen ? "Hide" : "Show"} Sidebar (Cmd+B)`}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChatPanelOpen((prev) => !prev)}
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
        <div className="flex flex-1 overflow-hidden">
          {sidebarOpen && <Sidebar />}
          <div className="flex-1 flex flex-col overflow-hidden">
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <Editor />
            </div>
          </div>
          {chatPanelOpen && <ChatPanel onClose={() => setChatPanelOpen(false)} />}
        </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <QuickOpen open={quickOpenVisible} onOpenChange={setQuickOpenVisible} />
      </div>
    </ThemeProvider>
  );
}

export default App;
