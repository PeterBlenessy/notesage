import { useEffect, useCallback, useRef } from "react";
import { EditorContent } from "@tiptap/react";
import { FileText, FolderOpen, Command } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore, type ContentWidth } from "@/stores/settings-store";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { Toolbar } from "./Toolbar";
import { BubbleMenu } from "./BubbleMenu";
import { StatusBar } from "./StatusBar";
import "@/styles/editor.css";

const CONTENT_WIDTHS: Record<ContentWidth, number | undefined> = {
  full: undefined,
  auto: 720,
  a4: 794,
  a5: 559,
  letter: 816,
};

export function Editor() {
  const { tabs, activeTabId, updateTabContent } = useEditorStore();
  const { showFloatingToolbar, contentWidth } = useSettingsStore();
  const { saveFile } = useFileOperations();
  const maxWidth = CONTENT_WIDTHS[contentWidth];
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const lastLoadedTabId = useRef<string | null>(null);

  const handleUpdate = useCallback(
    (content: string) => {
      if (activeTab) {
        // Check if content has actually changed
        const hasChanged = content !== activeTab.content;
        updateTabContent(activeTab.id, content, hasChanged);
      }
    },
    [activeTab, updateTabContent]
  );

  const editor = useEditor({
    content: activeTab?.content || "",
    onUpdate: handleUpdate,
    editable: true,
  });

  // Update editor content when switching tabs
  useEffect(() => {
    if (editor && activeTab && activeTab.id !== lastLoadedTabId.current) {
      console.log('Switching to tab:', activeTab.id, 'content length:', activeTab.content.length);
      lastLoadedTabId.current = activeTab.id;
      editor.commands.setContent(activeTab.content);
    }
  }, [activeTab?.id, editor, activeTab]);

  // Handle Cmd+S to save
  useEffect(() => {
    const handleSave = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab && activeTab.isDirty) {
          try {
            await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
          } catch (error) {
            alert(`Failed to save file: ${error}`);
          }
        }
      }
    };

    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [activeTab, saveFile]);

  // Auto-save on blur (when switching tabs or focus changes)
  useEffect(() => {
    const handleBlur = async () => {
      if (activeTab && activeTab.isDirty) {
        try {
          await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
        } catch (error) {
          console.error("Auto-save failed:", error);
        }
      }
    };

    // Debounced auto-save
    const timeoutId = setTimeout(() => {
      if (activeTab && activeTab.isDirty) {
        handleBlur();
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [activeTab?.content, activeTab?.isDirty, activeTab, saveFile]);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="text-center space-y-6">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" strokeWidth={1} />
          <div className="space-y-1.5">
            <h2 className="text-lg font-medium text-foreground/70">No file open</h2>
            <p className="text-sm text-muted-foreground">Select a file from the sidebar to start editing</p>
          </div>
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground/60">
            <div className="flex items-center gap-2">
              <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[11px]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                <Command className="h-2.5 w-2.5" />N
              </kbd>
              <span>New file</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[11px]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
                <Command className="h-2.5 w-2.5" />O
              </kbd>
              <span>Open file</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading editor...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar editor={editor} />
      <div className="flex-1 overflow-y-auto editor-scroll-area">
        <div
          className={`min-h-full flex justify-center ${
            contentWidth === "full" ? "py-4 px-4" : "py-10 px-8"
          }`}
        >
          <div
            className="w-full"
            style={maxWidth ? { maxWidth: `${maxWidth}px` } : undefined}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        {editor && showFloatingToolbar && <BubbleMenu editor={editor} />}
      </div>
      <StatusBar editor={editor} />
    </div>
  );
}
