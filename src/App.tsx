import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QuickOpen } from "@/components/QuickOpen";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  useKeyboardShortcuts();

  // Handle Cmd+P for quick open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible(true);
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
          <TabBar />
          <div className="flex-1 overflow-hidden">
            <Editor />
          </div>
        </div>
        <QuickOpen open={quickOpenVisible} onOpenChange={setQuickOpenVisible} />
      </div>
    </ThemeProvider>
  );
}

export default App;
