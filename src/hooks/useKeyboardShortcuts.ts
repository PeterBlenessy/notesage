import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { PaletteMode } from "@/lib/command-palette";

interface KeyboardShortcutCallbacks {
  onPaletteOpen: (mode: PaletteMode) => void;
  onFindOpen: () => void;
  onFindReplaceOpen: () => void;
  onToggleFocusMode: () => void;
  onExitFocusMode: () => void;
  onOutlineOpen: () => void;
  onSettingsOpen: () => void;
  onExportOpen: () => void;
  onNewProject: () => void;
  onNewNote: () => void;
  onOpenFolder: () => void;
  onShortcutsOpen: () => void;
  onToggleActivityStrip?: () => void;
  onToggleRecording?: () => void;
  onOpenActions?: () => void;
  focusMode: boolean;
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks) {
  const { tabs, activeTabId, closeTab, setPendingCloseTabId } = useEditorStore();
  const { setSidebarPinned, setChatPanelOpen } = useSettingsStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Esc — exit focus mode
      if (e.key === "Escape" && callbacks.focusMode) {
        e.preventDefault();
        callbacks.onExitFocusMode();
        return;
      }

      // Cmd+W — close active tab
      if (isMod && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab?.isDirty) {
            setPendingCloseTabId(activeTabId);
            return;
          }
          closeTab(activeTabId);
        }
        return;
      }

      // Cmd+K — command palette (always, regardless of selection)
      if (isMod && e.key === "k") {
        e.preventDefault();
        callbacks.onPaletteOpen("default");
        return;
      }

      // Cmd+Shift+H — find and replace in document
      if (isMod && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        callbacks.onFindReplaceOpen();
        return;
      }

      // Cmd+Shift+F — project file search
      if (isMod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        callbacks.onPaletteOpen("files");
        return;
      }

      // Cmd+F — find in document (must come after Cmd+Shift+F check)
      if (isMod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        callbacks.onFindOpen();
        return;
      }

      // Cmd+2 — mention search
      if (isMod && !e.shiftKey && e.key === "2") {
        e.preventDefault();
        callbacks.onPaletteOpen("mentions");
        return;
      }

      // Cmd+3 — tag search
      if (isMod && !e.shiftKey && e.key === "3") {
        e.preventDefault();
        callbacks.onPaletteOpen("tags");
        return;
      }

      // Cmd+4 — research search
      if (isMod && !e.shiftKey && e.key === "4") {
        e.preventDefault();
        callbacks.onPaletteOpen("research");
        return;
      }

      // Cmd+1 — open actions dashboard
      if (isMod && !e.shiftKey && e.key === "1") {
        e.preventDefault();
        callbacks.onOpenActions?.();
        return;
      }

      // Cmd+. — focus mode toggle
      if (isMod && e.key === ".") {
        e.preventDefault();
        callbacks.onToggleFocusMode();
        return;
      }

      // Cmd+T — toggle theme
      if (isMod && e.key === "t") {
        e.preventDefault();
        const settings = useSettingsStore.getState();
        settings.setTheme(settings.theme === "dark" ? "light" : "dark");
        return;
      }

      // Cmd+Shift+O — document outline (check before Cmd+O)
      if (isMod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (useEditorStore.getState().activeTabId) {
          callbacks.onOutlineOpen();
        }
        return;
      }

      // Cmd+Shift+L — sidebar pin toggle
      if (isMod && e.shiftKey && e.key === "l") {
        e.preventDefault();
        setSidebarPinned(!useSettingsStore.getState().sidebarPinned);
      }

      // Cmd+Shift+A — agent panel toggle
      if (isMod && e.shiftKey && e.key === "a") {
        e.preventDefault();
        callbacks.onToggleActivityStrip?.();
        return;
      }

      // Cmd+Shift+C — AI chat toggle
      if (isMod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setChatPanelOpen(!useSettingsStore.getState().chatPanelOpen);
      }

      // Cmd+, — settings
      if (isMod && e.key === ",") {
        e.preventDefault();
        callbacks.onSettingsOpen();
      }

      // Cmd+7 — keyboard shortcuts reference
      if (isMod && !e.shiftKey && e.key === "7") {
        e.preventDefault();
        callbacks.onShortcutsOpen();
        return;
      }

      // Cmd+Shift+R — toggle recording
      if (isMod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        callbacks.onToggleRecording?.();
        return;
      }

      // Cmd+Shift+E — export PDF
      if (isMod && e.shiftKey && e.key === "e") {
        e.preventDefault();
        if (useEditorStore.getState().activeTabId) {
          callbacks.onExportOpen();
        }
        return;
      }

      // Cmd+Shift+N — new project
      if (isMod && e.shiftKey && e.key === "n") {
        e.preventDefault();
        callbacks.onNewProject();
        return;
      }

      // Cmd+N — new note
      if (isMod && e.key === "n") {
        e.preventDefault();
        callbacks.onNewNote();
      }

      // Cmd+O — open folder
      if (isMod && e.key === "o") {
        e.preventDefault();
        callbacks.onOpenFolder();
      }

      // Cmd+Option+I — open devtools
      if (isMod && e.altKey && e.key === "i") {
        e.preventDefault();
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("open_devtools").catch(console.error);
        });
        return;
      }

      // Cmd+S is handled in the Editor component for context-aware saving
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, tabs, closeTab, setPendingCloseTabId, setSidebarPinned, setChatPanelOpen, callbacks]);
}
