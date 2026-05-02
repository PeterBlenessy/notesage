import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Frontmatter } from "@/lib/frontmatter";
import type { FileType, ViewMode } from "@/lib/file-utils";
import { useSettingsStore } from "@/stores/settings-store";


export type { FileType, ViewMode } from "@/lib/file-utils";

/**
 * Quiet Composer is a single-document shell — opening a new doc evicts the
 * previously-active one, and closing the active doc lands on the empty
 * landing state instead of auto-switching to a sibling tab. Both store
 * actions branch on this helper. The legacy shell is unaffected.
 */
function isQuietComposer(): boolean {
  try {
    return useSettingsStore.getState().uiPreview === "quiet-composer";
  } catch {
    // Defensive: if settings-store isn't initialised yet (very early startup),
    // fall back to legacy semantics so we don't accidentally evict during
    // tab restoration.
    return false;
  }
}

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
   *  (i.e. was saved). Drives the "saved Xs ago" indicator rendered by the quiet-mode
   *  `TitleBar` (post-#131) and the `StatusBar`. Undefined means the tab has never been
   *  saved this session. */
  lastSavedAt?: number;
}

export interface RecentFile {
  path: string;
  name: string;
  /**
   * Epoch millis of the most recent open / activation. Drives the
   * Quiet sidebar's relative-time hint ("2h", "1d", "3d") per
   * mockup-d. Optional for back-compat with pre-#107 persisted state.
   */
  lastAccessedAt?: number;
}

/** Lightweight record of an open file, persisted to localStorage. */
export interface PersistedTab {
  filePath: string;
  fileName: string;
}

const MAX_RECENT_FILES = 5;
const MAX_SCROLL_POSITIONS = 200;

interface EditorStore {
  /** All open documents. Renamed from `tabs` in persist version 1 as part of
   *  the UI Refresh project — semantically the same set, but no longer bound to
   *  a visible tab strip. Keyboard navigation (⌃Tab / ⌃⇧Tab) still cycles
   *  through this array. */
  openDocuments: Tab[];
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
  /**
   * Session-only: MRU order of document IDs — first entry is the most
   * recently activated. Maintained by `openTab` / `setActiveTab` /
   * `closeTab`. Drives the ⌃Tab / ⌃⇧Tab cycle shortcut (#77). Not
   * persisted — access order resets on restart and repopulates as the
   * user navigates.
   */
  documentAccessOrder: string[];

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
  /**
   * Drop a file from the Recent list. Sidebar-simplification task #18 —
   * called by `useFileOperations.deletePath` (alongside
   * `workspace-store.unpinFile`) so a deleted file disappears from
   * both Pinned AND Recent in one render cycle. Path-prefix delete
   * (folder removal) cleans up every recent entry under that prefix.
   */
  removeRecent: (path: string) => void;
  setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => void;
  updateFrontmatter: (tabId: string, updates: Partial<Frontmatter>) => void;
  setScrollPosition: (filePath: string, ratio: number) => void;
  setExternalChange: (filePath: string, diskContent: string) => void;
  clearExternalChange: (filePath: string) => void;
  /** Update a single tab's file path and name after a rename. */
  renameTab: (oldPath: string, newPath: string) => void;
  /** Rewrite all file paths that start with oldPrefix to use newPrefix (used by project migration). */
  updateFilePaths: (oldPrefix: string, newPrefix: string) => void;
  /**
   * Handle an external file or folder rename atomically. For a file rename,
   * rewrites the exact matching tab; for a folder rename, rewrites all
   * descendant paths. In both cases fileName is kept correct.
   *
   * `isDirectory` defaults to auto-detection: true when no open document
   * matches `oldPath` exactly (i.e. the path is a directory prefix).
   */
  renameOpenDocument: (oldPath: string, newPath: string, isDirectory?: boolean) => void;
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
      openDocuments: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      pendingCloseTabId: null,
      persistedTabs: [],
      persistedActiveFilePath: null,
      documentAccessOrder: [],

      openTab: (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType, scrollToTag?: ScrollToTag, scrollToText?: string) => {
        set((state) => {
          // Track in recent files (deduplicate, cap). `lastAccessedAt`
          // drives the sidebar's relative-time hint per mockup-d.
          const filteredRecent = state.recentFiles.filter((r) => r.path !== filePath);
          const newRecent = [
            { path: filePath, name: fileName, lastAccessedAt: Date.now() },
            ...filteredRecent,
          ].slice(0, MAX_RECENT_FILES);

          // Quiet Composer is a single-document shell — opening a new doc
          // evicts the previously-active one. We only evict when adding a
          // NEW tab; when the user clicks a doc that's already open we just
          // re-activate it (nothing to evict). Dirty docs rely on the
          // 1-second debounced auto-save in `Editor.tsx` having already
          // flushed by the time the user opens a sibling — same guarantee
          // the legacy `closeTab` provides today (it doesn't gate on dirty
          // either; the warn-if-dirty path is in TitleBar / TabBar at the
          // call site, not in the store mutator).
          const quiet = isQuietComposer();

          // Check if tab already exists
          const existingTab = state.openDocuments.find((tab) => tab.filePath === filePath);

          if (existingTab) {
            // Sync persisted state + set scroll targets atomically with tab activation
            const needsTabUpdate = scrollToTag !== undefined || scrollToText !== undefined;
            const newPersistedTabs = state.persistedTabs.some((p) => p.filePath === filePath)
              ? state.persistedTabs
              : [...state.persistedTabs, { filePath, fileName }];
            return {
              openDocuments: needsTabUpdate
                ? state.openDocuments.map((tab) => tab.id === existingTab.id
                  ? { ...tab, ...(scrollToTag !== undefined && { scrollToTag }), ...(scrollToText !== undefined && { scrollToText }) }
                  : tab)
                : state.openDocuments,
              activeTabId: existingTab.id,
              recentFiles: newRecent,
              persistedTabs: newPersistedTabs,
              persistedActiveFilePath: filePath,
              documentAccessOrder: [
                existingTab.id,
                ...state.documentAccessOrder.filter((id) => id !== existingTab.id),
              ],
            };
          }

          // Create new tab. Under Quiet Composer, evict every other open
          // doc first so the end state is always exactly 1 entry. Under
          // the legacy shell we keep the existing append-to-end semantics.
          const baseDocs = quiet ? [] : state.openDocuments;
          const basePersisted = quiet
            ? []
            : state.persistedTabs.filter((p) => p.filePath !== filePath);
          const baseAccessOrder = quiet
            ? []
            : state.documentAccessOrder;

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

          const newPersistedTabs = [...basePersisted, { filePath, fileName }];

          return {
            openDocuments: [...baseDocs, newTab],
            activeTabId: newTab.id,
            recentFiles: newRecent,
            persistedTabs: newPersistedTabs,
            persistedActiveFilePath: filePath,
            documentAccessOrder: [
              newTab.id,
              ...baseAccessOrder.filter((id) => id !== newTab.id),
            ],
          };
        });
      },

      openTabPlaceholder: (filePath, fileName, fileType) => {
        set((state) => {
          if (state.openDocuments.some((t) => t.filePath === filePath)) return state;
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
          return { openDocuments: [...state.openDocuments, newTab] };
        });
      },

      loadTabContent: (tabId, content, frontmatter) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((t) =>
            t.id === tabId ? { ...t, content, contentLoaded: true, frontmatter: frontmatter ?? t.frontmatter, lastSavedContent: content } : t
          ),
        }));
      },

      setTabLoadError: (tabId, error) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((t) =>
            t.id === tabId ? { ...t, contentLoaded: true, loadError: error } : t
          ),
        }));
      },

      closeTab: (tabId: string) => {
        set((state) => {
          const closedTab = state.openDocuments.find((tab) => tab.id === tabId);
          const newTabs = state.openDocuments.filter((tab) => tab.id !== tabId);
          let newActiveTabId = state.activeTabId;

          // If closing active tab, decide where to land. Under Quiet Composer,
          // closing the active doc lands on the empty landing state — the
          // shell is a single-document editor by design (see openTab eviction
          // above), so even if a stale sibling is in the array (e.g., a
          // pre-quiet tab survived from a setting-flip mid-session) we don't
          // auto-switch to it. The legacy shell keeps the previous behaviour
          // of falling back to the prior-index sibling.
          if (state.activeTabId === tabId) {
            if (newTabs.length > 0 && !isQuietComposer()) {
              const closedIndex = state.openDocuments.findIndex((tab) => tab.id === tabId);
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
            openDocuments: newTabs,
            activeTabId: newActiveTabId,
            persistedTabs: newPersistedTabs,
            persistedActiveFilePath: activeTab?.filePath ?? null,
            documentAccessOrder: state.documentAccessOrder.filter((id) => id !== tabId),
          };
        });
      },

      setActiveTab: (tabId: string) => {
        set((state) => {
          const tab = state.openDocuments.find((t) => t.id === tabId);
          return {
            activeTabId: tabId,
            persistedActiveFilePath: tab?.filePath ?? state.persistedActiveFilePath,
            documentAccessOrder: [
              tabId,
              ...state.documentAccessOrder.filter((id) => id !== tabId),
            ],
          };
        });
      },

      updateTabContent: (tabId: string, content: string, isDirty: boolean) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) => {
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
          openDocuments: state.openDocuments.map((tab) => {
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
          openDocuments: state.openDocuments.map((tab) =>
            tab.filePath === filePath || tab.filePath.startsWith(filePath + '/')
              ? { ...tab, deleted: true, isDirty: false }
              : tab
          ),
        }));
      },

      removeRecent: (path: string) => {
        set((state) => ({
          // Drop exact-path match AND any recent entry under a deleted
          // folder (`/path/to/folder/...`). Mirrors `markTabDeleted`'s
          // prefix-aware behaviour so folder deletes clean recursively.
          recentFiles: state.recentFiles.filter(
            (rf) => rf.path !== path && !rf.path.startsWith(path + "/"),
          ),
        }));
      },

      setFrontmatter: (tabId: string, frontmatter: Frontmatter | null) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
            tab.id === tabId ? { ...tab, frontmatter, isDirty: true } : tab
          ),
        }));
      },

      updateFrontmatter: (tabId: string, updates: Partial<Frontmatter>) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
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
          openDocuments: state.openDocuments.map((tab) =>
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

      renameOpenDocument: (oldPath: string, newPath: string, isDirectory?: boolean) => {
        set((state) => {
          const resolvedIsDirectory =
            isDirectory !== undefined
              ? isDirectory
              : !state.openDocuments.some((t) => t.filePath === oldPath);
          const rewritePath = (p: string): string => {
            if (resolvedIsDirectory) {
              const prefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
              if (p === oldPath || p.startsWith(prefix)) {
                return newPath + p.slice(oldPath.length);
              }
              return p;
            }
            return p === oldPath ? newPath : p;
          };

          const rewriteTab = (tab: typeof state.openDocuments[number]) => {
            const rewritten = rewritePath(tab.filePath);
            if (rewritten === tab.filePath) return tab;
            return {
              ...tab,
              filePath: rewritten,
              // Only update fileName for exact-match (file rename); folder
              // renames keep the filename unchanged.
              fileName: resolvedIsDirectory ? tab.fileName : (newPath.split("/").pop() ?? newPath),
            };
          };

          const rewriteRecentFile = (rf: typeof state.recentFiles[number]) => {
            const rewritten = rewritePath(rf.path);
            if (rewritten === rf.path) return rf;
            return {
              ...rf,
              path: rewritten,
              name: resolvedIsDirectory ? rf.name : (newPath.split("/").pop() ?? newPath),
            };
          };

          return {
            openDocuments: state.openDocuments.map(rewriteTab),
            persistedTabs: state.persistedTabs.map((pt) => {
              const rewritten = rewritePath(pt.filePath);
              if (rewritten === pt.filePath) return pt;
              return {
                ...pt,
                filePath: rewritten,
                fileName: resolvedIsDirectory ? pt.fileName : (newPath.split("/").pop() ?? newPath),
              };
            }),
            persistedActiveFilePath: state.persistedActiveFilePath
              ? rewritePath(state.persistedActiveFilePath)
              : null,
            recentFiles: state.recentFiles.map(rewriteRecentFile),
            scrollPositions: Object.fromEntries(
              Object.entries(state.scrollPositions).map(([k, v]) => [rewritePath(k), v])
            ),
          };
        });
      },

      setViewMode: (tabId: string, mode: ViewMode) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
            tab.id === tabId ? { ...tab, viewMode: mode } : tab
          ),
        }));
      },

      toggleViewMode: (tabId: string) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
            tab.id === tabId
              ? { ...tab, viewMode: tab.viewMode === "source" ? "wysiwyg" : "source" }
              : tab
          ),
        }));
      },

      toggleCopilotForTab: (tabId: string) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
            tab.id === tabId ? { ...tab, copilotDisabled: !tab.copilotDisabled } : tab
          ),
        }));
      },

      reorderTab: (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        set((state) => {
          const newTabs = [...state.openDocuments];
          const [moved] = newTabs.splice(fromIndex, 1);
          if (!moved) return state;
          newTabs.splice(toIndex, 0, moved);

          const newPersisted = [...state.persistedTabs];
          const [movedPersisted] = newPersisted.splice(fromIndex, 1);
          if (movedPersisted) {
            newPersisted.splice(toIndex, 0, movedPersisted);
          }

          return { openDocuments: newTabs, persistedTabs: newPersisted };
        });
      },

      setScrollToTag: (tabId: string, target: ScrollToTag | undefined) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
            tab.id === tabId ? { ...tab, scrollToTag: target } : tab
          ),
        }));
      },

      setScrollToText: (tabId: string, text: string | undefined) => {
        set((state) => ({
          openDocuments: state.openDocuments.map((tab) =>
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
            openDocuments: state.openDocuments.map((tab) => ({
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
      version: 2,

      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1) {
          // ui-refresh task #75 — rename `tabs` field to `openDocuments`.
          // The persisted shape only carries `persistedTabs` (not `tabs` — the
          // in-memory array was never persisted, see `partialize`), so the
          // rename is effectively a no-op for existing users. We still run the
          // migration defensively to cover any hand-edited or future-forked
          // states that may have the legacy key lying around.
          if (Array.isArray((state as { tabs?: unknown }).tabs)) {
            state.openDocuments = (state as { tabs: unknown[] }).tabs;
            delete (state as { tabs?: unknown }).tabs;
          }
        }
        if (version < 2) {
          // #141 — Recent rows added a `lastAccessedAt` field after the
          // initial release; pre-existing recents persisted before that
          // bump have no timestamp and were falling back to the parent-
          // folder hint (which read like a project name, not a relative
          // time). Backfill in MRU order: the most-recent entry gets a
          // timestamp 1 minute ago, the next 2 minutes ago, etc. This
          // preserves the relative ordering as visible "1m", "2m", …
          // hints until the user reopens each file (which then stamps
          // the real timestamp via `openTab`).
          const recents = (state as { recentFiles?: unknown }).recentFiles;
          if (Array.isArray(recents)) {
            const now = Date.now();
            state.recentFiles = recents.map((entry, index) => {
              const rec = entry as Record<string, unknown>;
              if (typeof rec.lastAccessedAt === "number") return rec;
              return { ...rec, lastAccessedAt: now - (index + 1) * 60_000 };
            });
          }
        }
        return state;
      },

      partialize: (state) => ({
        recentFiles: state.recentFiles,
        scrollPositions: state.scrollPositions,
        persistedTabs: state.persistedTabs,
        persistedActiveFilePath: state.persistedActiveFilePath,
      }),
    }
  )
);
