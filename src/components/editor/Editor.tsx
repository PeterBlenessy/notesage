import { useEffect, useCallback } from "react";
import { EditorContent } from "@tiptap/react";
import { useEditorStore } from "@/stores/editor-store";
import { useEditor } from "@/hooks/useEditor";
import { useFileOperations } from "@/hooks/useFileOperations";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { Toolbar } from "./Toolbar";
import { BubbleMenu } from "./BubbleMenu";
import "@/styles/editor.css";

export function Editor() {
  const { tabs, activeTabId, updateTabContent } = useEditorStore();
  const { saveFile } = useFileOperations();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

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
    if (editor && activeTab) {
      const currentMarkdown = getMarkdownFromEditor(editor);
      if (currentMarkdown !== activeTab.content) {
        editor.commands.setContent(activeTab.content);
      }
    }
  }, [activeTab?.id, activeTab?.content, editor]);

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
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">No file open</h2>
          <p>Select a file from the sidebar to start editing</p>
        </div>
      </div>
    );
  }

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Loading editor...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
        {editor && <BubbleMenu editor={editor} />}
      </div>
    </div>
  );
}
