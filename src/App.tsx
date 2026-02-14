import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function App() {
  useKeyboardShortcuts();

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
      </div>
    </ThemeProvider>
  );
}

export default App;
