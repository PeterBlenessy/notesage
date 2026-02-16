import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
}

export interface RecentFile {
  path: string;
  name: string;
}

const MAX_RECENT_FILES = 5;

interface EditorStore {
  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];

  openTab: (filePath: string, fileName: string, content: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  markTabClean: (tabId: string) => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      recentFiles: [],

      openTab: (filePath: string, fileName: string, content: string) => {
        set((state) => {
          // Track in recent files (deduplicate, cap)
          const filteredRecent = state.recentFiles.filter((r) => r.path !== filePath);
          const newRecent = [{ path: filePath, name: fileName }, ...filteredRecent].slice(0, MAX_RECENT_FILES);

          // Check if tab already exists
          const existingTab = state.tabs.find((tab) => tab.filePath === filePath);

          if (existingTab) {
            return { activeTabId: existingTab.id, recentFiles: newRecent };
          }

          // Create new tab
          const newTab: Tab = {
            id: crypto.randomUUID(),
            filePath,
            fileName,
            isDirty: false,
            content,
          };

          return {
            tabs: [...state.tabs, newTab],
            activeTabId: newTab.id,
            recentFiles: newRecent,
          };
        });
      },

      closeTab: (tabId: string) => {
        set((state) => {
          const newTabs = state.tabs.filter((tab) => tab.id !== tabId);
          let newActiveTabId = state.activeTabId;

          // If closing active tab, switch to another
          if (state.activeTabId === tabId) {
            if (newTabs.length > 0) {
              const closedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
              const newIndex = Math.max(0, closedIndex - 1);
              newActiveTabId = newTabs[newIndex]?.id || null;
            } else {
              newActiveTabId = null;
            }
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        });
      },

      setActiveTab: (tabId: string) => {
        set({ activeTabId: tabId });
      },

      updateTabContent: (tabId: string, content: string, isDirty: boolean) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, content, isDirty } : tab
          ),
        }));
      },

      markTabClean: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, isDirty: false } : tab
          ),
        }));
      },
    }),
    {
      name: "notesage-editor",
      partialize: (state) => ({
        recentFiles: state.recentFiles,
      }),
    }
  )
);
