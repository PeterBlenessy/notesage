import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Frontmatter } from "@/lib/frontmatter";
import type { FileType, ViewMode } from "@/lib/file-utils";


export type { FileType, ViewMode } from "@/lib/file-utils";

/** Scroll target for navigating to a specific tag occurrence within a document. */
export interface ScrollToTag {
  tag: string;
  occurrence: number; // 0-based index of this tag match within the file
}

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
  /** Session-only: true once file content has been loaded from disk. Tabs restored
   *  on startup are created with contentLoaded=false and loaded on demand. */
  contentLoaded?: boolean;
  /** Session-only: error message when file could not be loaded from disk (e.g., file moved/renamed). */
  loadError?: string;
  /** Session-only: scroll to a specific tag occurrence after content loads. Cleared after use. */
  scrollToTag?: ScrollToTag;
  /** Session-only: scroll to a text match after content loads. Cleared after use. */
  scrollToText?: string;
  /** Session-only: the markdown content at the time of the last save. Used to distinguish
   *  self-writes from external changes when the user continues typing after a save. */
  lastSavedContent?: string;
  /** Session-only: epoch millis of the last time this tab transitioned from dirty → clean
   *  (i.e. was saved). Drives the "saved Xs ago" indicator in `DocHead`. Undefined means
   *  the tab has never been saved this session. */
  lastSavedAt?: number;
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
const MAX_SCROLL_POSITIONS = 200;

interface EditorStore {
  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];
  /** Scroll position ratios (0–1) keyed by file path, persisted across restarts. */
  scrollPositions: Record<string, number>;
  /** Ephemeral: paths with pending external changes → disk content. Not persisted. */
  externalChanges: Record<string, string>;
  /** Ephemeral: tab ID awaiting save/discard decision. Not persisted. */
  pendingCloseTabId: string | null;
  /** Persisted list of open file paths so we can re-open them on restart. */
  persistedTabs: PersistedTab[];
  /** Persisted: which file was active, so we can re-activate it on restart. */
  persistedActiveFilePath: string | null;

  openTab: (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType, scrollToTag?: ScrollToTag, scrollToText?: string) => void;
  /** Create a tab placeholder without loading content (for startup restoration). */
  openTabPlaceholder: (filePath: string, fileName: string, fileType?: FileType) => void;
  /** Load content into a placeholder tab. */
  loadTabContent: (tabId: string, content: string, frontmatter?: Frontmatter | null) => void;
  /** Mark a tab as having a load error (file not found, etc.). */
  setTabLoadError: (tabId: string, error: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string, isDirty: boolean) => void;
  markTabClean: (tabId: string, savedContent?: string) => void;
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
  /** Reorder tabs by moving a tab from one index to another. */
  reorderTab: (fromIndex: number, toIndex: number) => void;
  /** Set a tag scroll target. Cleared after Editor.tsx consumes it. */
  setScrollToTag: (tabId: string, target: ScrollToTag | undefined) => void;
  /** Set a text scroll target. Cleared after Editor.tsx consumes it. */
  setScrollToText: (tabId: string, text: string | undefined) => void;
  /** Set tab awaiting save/discard decision (for dirty tab close). */
  setPendingCloseTabId: (tabId: string | null) => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      pendingCloseTabId: null,
      persistedTabs: [],
      persistedActiveFilePath: null,

      openTab: (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType, scrollToTag?: ScrollToTag, scrollToText?: string) => {
        set((state) => {
          // Track in recent files (deduplicate, cap)
          const filteredRecent = state.recentFiles.filter((r) => r.path !== filePath);
          const newRecent = [{ path: filePath, name: fileName }, ...filteredRecent].slice(0, MAX_RECENT_FILES);

          // Check if tab already exists
          const existingTab = state.tabs.find((tab) => tab.filePath === filePath);

          if (existingTab) {
            // Sync persisted state + set scroll targets atomically with tab activation
            const needsTabUpdate = scrollToTag !== undefined || scrollToText !== undefined;
            const newPersistedTabs = state.persistedTabs.some((p) => p.filePath === filePath)
              ? state.persistedTabs
              : [...state.persistedTabs, { filePath, fileName }];
            return {
              tabs: needsTabUpdate
                ? state.tabs.map((tab) => tab.id === existingTab.id
                  ? { ...tab, ...(scrollToTag !== undefined && { scrollToTag }), ...(scrollToText !== undefined && { scrollToText }) }
                  : tab)
                : state.tabs,
              activeTabId: existingTab.id,
              recentFiles: newRecent,
              persistedTabs: newPersistedTabs,
              persistedActiveFilePath: filePath,
            };
          }

          // Create new tab
          const newTab: Tab = {
            id: crypto.randomUUID(),
            filePath,
            fileName,
            isDirty: false,
            content,
            contentLoaded: true,
            frontmatter: frontmatter ?? null,
            fileType: fileType ?? "markdown",
            scrollToTag,
            scrollToText,
            lastSavedContent: content,
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

      openTabPlaceholder: (filePath, fileName, fileType) => {
        set((state) => {
          if (state.tabs.some((t) => t.filePath === filePath)) return state;
          const newTab: Tab = {
            id: crypto.randomUUID(),
            filePath,
            fileName,
            isDirty: false,
            content: "",
            contentLoaded: false,
            frontmatter: null,
            fileType: fileType ?? "markdown",
          };
          return { tabs: [...state.tabs, newTab] };
        });
      },

      loadTabContent: (tabId, content, frontmatter) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, contentLoaded: true, frontmatter: frontmatter ?? t.frontmatter, lastSavedContent: content } : t
          ),
        }));
      },

      setTabLoadError: (tabId, error) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, contentLoaded: true, loadError: error } : t
          ),
        }));
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
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            // Stamp lastSavedAt only on the dirty → clean transition so the
            // "saved Xs ago" clock resets at save time, not on every keystroke
            // that happens to land in a clean state.
            const savedNow = !isDirty && tab.isDirty;
            return {
              ...tab,
              content,
              isDirty,
              ...(!isDirty && { lastSavedContent: content }),
              ...(savedNow && { lastSavedAt: Date.now() }),
            };
          }),
        }));
      },

      markTabClean: (tabId: string, savedContent?: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const savedNow = tab.isDirty;
            return {
              ...tab,
              isDirty: false,
              ...(savedContent !== undefined && { lastSavedContent: savedContent }),
              ...(savedNow && { lastSavedAt: Date.now() }),
            };
          }),
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
        set((state) => {
          const positions = { ...state.scrollPositions };
          // Move to end of insertion order (LRU)
          delete positions[filePath];
          positions[filePath] = ratio;
          // Evict oldest if over limit
          const keys = Object.keys(positions);
          if (keys.length > MAX_SCROLL_POSITIONS) {
            for (let i = 0; i < keys.length - MAX_SCROLL_POSITIONS; i++) {
              delete positions[keys[i]];
            }
          }
          return { scrollPositions: positions };
        });
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

      reorderTab: (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        set((state) => {
          const newTabs = [...state.tabs];
          const [moved] = newTabs.splice(fromIndex, 1);
          if (!moved) return state;
          newTabs.splice(toIndex, 0, moved);

          const newPersisted = [...state.persistedTabs];
          const [movedPersisted] = newPersisted.splice(fromIndex, 1);
          if (movedPersisted) {
            newPersisted.splice(toIndex, 0, movedPersisted);
          }

          return { tabs: newTabs, persistedTabs: newPersisted };
        });
      },

      setScrollToTag: (tabId: string, target: ScrollToTag | undefined) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, scrollToTag: target } : tab
          ),
        }));
      },

      setScrollToText: (tabId: string, text: string | undefined) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, scrollToText: text } : tab
          ),
        }));
      },

      setPendingCloseTabId: (tabId: string | null) => {
        set({ pendingCloseTabId: tabId });
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
