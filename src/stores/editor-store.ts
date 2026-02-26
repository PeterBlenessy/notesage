import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Frontmatter } from "@/lib/frontmatter";
import type { FileType, ViewMode } from "@/lib/file-utils";

export type { FileType, ViewMode } from "@/lib/file-utils";

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
  frontmatter: Frontmatter | null;
  /** Determined from file extension on open. */
  fileType: FileType;
  /** WYSIWYG vs source mode — only meaningful for markdown tabs. Session-only, not persisted. */
  viewMode?: ViewMode;
  /** Session-only: when true, Copilot completions are suppressed for this tab. */
  copilotDisabled?: boolean;
  /** Session-only: true when the file has been deleted from disk. */
  deleted?: boolean;
}

export interface RecentFile {
  path: string;
  name: string;
}

/** Lightweight record of an open file, persisted to localStorage. */
export interface PersistedTab {
  filePath: string;
  fileName: string;
}

const MAX_RECENT_FILES = 5;

interface EditorStore {
  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];
  /** Scroll position ratios (0–1) keyed by file path, persisted across restarts. */
  scrollPositions: Record<string, number>;
  /** Ephemeral: paths with pending external changes → disk content. Not persisted. */
  externalChanges: Record<string, string>;
  /** Persisted list of open file paths so we can re-open them on restart. */
  persistedTabs: PersistedTab[];
  /** Persisted: which file was active, so we can re-activate it on restart. */
  persistedActiveFilePath: string | null;

  openTab: (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  markTabClean: (tabId: string) => void;
  markTabDeleted: (filePath: string) => void;
  setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => void;
  updateFrontmatter: (tabId: string, updates: Partial<Frontmatter>) => void;
  setScrollPosition: (filePath: string, ratio: number) => void;
  setExternalChange: (filePath: string, diskContent: string) => void;
  clearExternalChange: (filePath: string) => void;
  /** Update a single tab's file path and name after a rename. */
  renameTab: (oldPath: string, newPath: string) => void;
  /** Rewrite all file paths that start with oldPrefix to use newPrefix (used by project migration). */
  updateFilePaths: (oldPrefix: string, newPrefix: string) => void;
  /** Set view mode for a markdown tab (session-only, not persisted). */
  setViewMode: (tabId: string, mode: ViewMode) => void;
  /** Toggle between WYSIWYG and source mode for a markdown tab. */
  toggleViewMode: (tabId: string) => void;
  /** Toggle Copilot completions for a specific tab (session-only, not persisted). */
  toggleCopilotForTab: (tabId: string) => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      persistedTabs: [],
      persistedActiveFilePath: null,

      openTab: (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType) => {
        set((state) => {
          // Track in recent files (deduplicate, cap)
          const filteredRecent = state.recentFiles.filter((r) => r.path !== filePath);
          const newRecent = [{ path: filePath, name: fileName }, ...filteredRecent].slice(0, MAX_RECENT_FILES);

          // Check if tab already exists
          const existingTab = state.tabs.find((tab) => tab.filePath === filePath);

          if (existingTab) {
            // Sync persisted state
            const newPersistedTabs = state.persistedTabs.some((p) => p.filePath === filePath)
              ? state.persistedTabs
              : [...state.persistedTabs, { filePath, fileName }];
            return { activeTabId: existingTab.id, recentFiles: newRecent, persistedTabs: newPersistedTabs, persistedActiveFilePath: filePath };
          }

          // Create new tab
          const newTab: Tab = {
            id: crypto.randomUUID(),
            filePath,
            fileName,
            isDirty: false,
            content,
            frontmatter: frontmatter ?? null,
            fileType: fileType ?? "markdown",
          };

          const newPersistedTabs = [...state.persistedTabs.filter((p) => p.filePath !== filePath), { filePath, fileName }];

          return {
            tabs: [...state.tabs, newTab],
            activeTabId: newTab.id,
            recentFiles: newRecent,
            persistedTabs: newPersistedTabs,
            persistedActiveFilePath: filePath,
          };
        });
      },

      closeTab: (tabId: string) => {
        set((state) => {
          const closedTab = state.tabs.find((tab) => tab.id === tabId);
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

          const newPersistedTabs = closedTab
            ? state.persistedTabs.filter((p) => p.filePath !== closedTab.filePath)
            : state.persistedTabs;
          const activeTab = newActiveTabId ? newTabs.find((t) => t.id === newActiveTabId) : null;

          return {
            tabs: newTabs,
            activeTabId: newActiveTabId,
            persistedTabs: newPersistedTabs,
            persistedActiveFilePath: activeTab?.filePath ?? null,
          };
        });
      },

      setActiveTab: (tabId: string) => {
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          return { activeTabId: tabId, persistedActiveFilePath: tab?.filePath ?? state.persistedActiveFilePath };
        });
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

      markTabDeleted: (filePath: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.filePath === filePath || tab.filePath.startsWith(filePath + '/')
              ? { ...tab, deleted: true, isDirty: false }
              : tab
          ),
        }));
      },

      setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, frontmatter, isDirty: true } : tab
          ),
        }));
      },

      updateFrontmatter: (tabId: string, updates: Partial<Frontmatter>) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, frontmatter: { ...tab.frontmatter, ...updates }, isDirty: true }
              : tab
          ),
        }));
      },

      setScrollPosition: (filePath: string, ratio: number) => {
        set((state) => ({
          scrollPositions: { ...state.scrollPositions, [filePath]: ratio },
        }));
      },

      setExternalChange: (filePath: string, diskContent: string) => {
        set((state) => ({
          externalChanges: { ...state.externalChanges, [filePath]: diskContent },
        }));
      },

      clearExternalChange: (filePath: string) => {
        set((state) => {
          const { [filePath]: _, ...rest } = state.externalChanges;
          return { externalChanges: rest };
        });
      },

      renameTab: (oldPath: string, newPath: string) => {
        const newName = newPath.split("/").pop() ?? newPath;
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.filePath === oldPath
              ? { ...tab, filePath: newPath, fileName: newName }
              : tab
          ),
          persistedTabs: state.persistedTabs.map((pt) =>
            pt.filePath === oldPath
              ? { ...pt, filePath: newPath, fileName: newName }
              : pt
          ),
          persistedActiveFilePath:
            state.persistedActiveFilePath === oldPath
              ? newPath
              : state.persistedActiveFilePath,
          recentFiles: state.recentFiles.map((rf) =>
            rf.path === oldPath ? { ...rf, path: newPath, name: newName } : rf
          ),
          scrollPositions: Object.fromEntries(
            Object.entries(state.scrollPositions).map(([k, v]) =>
              k === oldPath ? [newPath, v] : [k, v]
            )
          ),
        }));
      },

      setViewMode: (tabId: string, mode: ViewMode) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, viewMode: mode } : tab
          ),
        }));
      },

      toggleViewMode: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, viewMode: tab.viewMode === "source" ? "wysiwyg" : "source" }
              : tab
          ),
        }));
      },

      toggleCopilotForTab: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, copilotDisabled: !tab.copilotDisabled } : tab
          ),
        }));
      },

      updateFilePaths: (oldPrefix: string, newPrefix: string) => {
        set((state) => {
          const rewrite = (p: string) =>
            p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p;

          return {
            tabs: state.tabs.map((tab) => ({
              ...tab,
              filePath: rewrite(tab.filePath),
            })),
            persistedTabs: state.persistedTabs.map((pt) => ({
              ...pt,
              filePath: rewrite(pt.filePath),
            })),
            persistedActiveFilePath: state.persistedActiveFilePath
              ? rewrite(state.persistedActiveFilePath)
              : null,
            recentFiles: state.recentFiles.map((rf) => ({
              ...rf,
              path: rewrite(rf.path),
            })),
            scrollPositions: Object.fromEntries(
              Object.entries(state.scrollPositions).map(([k, v]) => [rewrite(k), v])
            ),
          };
        });
      },
    }),
    {
      name: "notesage-editor",
      partialize: (state) => ({
        recentFiles: state.recentFiles,
        scrollPositions: state.scrollPositions,
        persistedTabs: state.persistedTabs,
        persistedActiveFilePath: state.persistedActiveFilePath,
      }),
    }
  )
);
