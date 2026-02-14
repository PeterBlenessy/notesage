import { create } from "zustand";

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
}

interface EditorStore {
  tabs: Tab[];
  activeTabId: string | null;

  openTab: (filePath: string, fileName: string, content: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  markTabClean: (tabId: string) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  tabs: [],
  activeTabId: null,

  openTab: (filePath: string, fileName: string, content: string) => {
    set((state) => {
      // Check if tab already exists
      const existingTab = state.tabs.find((tab) => tab.filePath === filePath);

      if (existingTab) {
        return { activeTabId: existingTab.id };
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
}));
