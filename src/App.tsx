import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QuickOpen } from "@/components/QuickOpen";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
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
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TabBar settingsButton={<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />} />
          <div className="flex-1 overflow-hidden">
            <Editor />
          </div>
        </div>
        {chatPanelOpen && <ChatPanel onClose={() => setChatPanelOpen(false)} />}
        <QuickOpen open={quickOpenVisible} onOpenChange={setQuickOpenVisible} />
      </div>
    </ThemeProvider>
  );
}

export default App;
