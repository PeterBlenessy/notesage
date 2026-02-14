import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "./useFileOperations";

export function useKeyboardShortcuts() {
  const { tabs, activeTabId, closeTab } = useEditorStore();
  const { theme, setTheme } = useSettingsStore();
  const { saveFile } = useFileOperations();

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+W - Close active tab
      if (isMod && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab?.isDirty) {
            const confirmed = window.confirm(
              "This file has unsaved changes. Close anyway?"
            );
            if (!confirmed) return;
          }
          closeTab(activeTabId);
        }
      }

      // Cmd+Shift+T - Toggle theme
      if (isMod && e.shiftKey && e.key === "T") {
        e.preventDefault();
        const newTheme = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
      }

      // Cmd+S is handled in the Editor component for context-aware saving
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, tabs, closeTab, theme, setTheme, saveFile]);
}
