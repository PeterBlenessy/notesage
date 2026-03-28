import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import {
  File,
  FilePlus,
  FolderDot,
  Hash,
  AtSign,
  FolderOpen,
  FileOutput,
  SunMoon,
  PanelLeft,
  MessageSquare,
  Settings,
  Clock,
  Focus,
  FileText,
  Loader2,
  BookOpen,
  Globe,
  CheckSquare,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { SymbolSearchResults } from "@/components/SymbolSearchResults";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileEntry, IndexContentSearchResult, IndexResearchResult, tauriApi } from "@/lib/tauri";
import type { PaletteMode, SymbolSearchConfig } from "@/lib/command-palette";
import { deriveMode, getQuery, getPrefixForMode, getPlaceholder, getSearchPaths } from "@/lib/command-palette";

const MAX_FILE_RESULTS = 50;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: PaletteMode;
  drilldownName?: string;
  onOpenFileAtSymbol?: (path: string, name: string, symbol: string, occurrenceInFile: number) => void;
  onNewNote: () => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onExportPdf: () => void;
  onToggleFocusMode: () => void;
  onOpenActions?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  initialMode = "default",
  drilldownName,
  onOpenFileAtSymbol,
  onNewNote,
  onNewProject,
  onOpenFolder,
  onOpenSettings,
  onExportPdf,
  onToggleFocusMode,
  onOpenActions,
}: CommandPaletteProps) {
  const [input, setInput] = useState("");

  // Derive mode from input prefix (or external files mode)
  const mode = deriveMode(input, initialMode === "files" ? "files" : undefined);
  const query = getQuery(input, mode);

  // Set initial input when palette opens with a mode.
  // Use a ref to move the cursor after the prefix on the first focus
  // (otherwise the Dialog auto-focus selects the prefix character).
  const needsCursorFix = useRef(false);

  useEffect(() => {
    if (open) {
      const prefix = getPrefixForMode(initialMode);
      setInput(prefix ?? "");
      if (prefix) {
        needsCursorFix.current = true;
      }
    }
  }, [open, initialMode]);

  // --- Tag config (reads from SQLite index) ---
  const tagConfig: SymbolSearchConfig = useMemo(
    () => ({
      prefix: "#",
      label: "Tags",
      labelSingular: "Tag",
      icon: Hash,
      fetchItems: async (query, paths) => {
        const tags = await tauriApi.indexTags(paths, query || undefined);
        return tags.map((t) => ({ name: t.tag, fileCount: t.file_count }));
      },
      findOccurrences: async (name, paths) => tauriApi.indexTagOccurrences(name, paths),
    }),
    []
  );

  // --- Mention config (reads from SQLite index) ---
  const mentionConfig: SymbolSearchConfig = useMemo(
    () => ({
      prefix: "@",
      label: "Mentions",
      labelSingular: "Mention",
      icon: AtSign,
      fetchItems: async (query, paths) => {
        const mentions = await tauriApi.indexMentions(paths, query || undefined);
        return mentions.map((m) => ({ name: m.mention, fileCount: m.file_count }));
      },
      findOccurrences: async (name, paths) => tauriApi.indexMentionOccurrences(name, paths),
    }),
    []
  );

  // --- Research search (from SQLite index) ---
  const [researchResults, setResearchResults] = useState<IndexResearchResult[]>([]);
  const [researchSearching, setResearchSearching] = useState(false);
  const researchSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "research" || !open) {
      setResearchResults([]);
      setResearchSearching(false);
      return;
    }

    setResearchSearching(true);
    if (researchSearchTimerRef.current) clearTimeout(researchSearchTimerRef.current);
    const researchStartTotal = performance.now();
    researchSearchTimerRef.current = setTimeout(async () => {
      researchSearchTimerRef.current = null;
      try {
        const paths = getSearchPaths();
        const q = query.trim();
        const ipcStart = performance.now();
        const results = await tauriApi.indexSearchResearch(paths, q || undefined, undefined, 50);
        console.log('[perf:palette] ipc', { mode: 'research' as const, ms: Math.round(performance.now() - ipcStart) });
        setResearchResults(results);
        console.log('[perf:palette]', { mode: 'research' as const, query: q, resultCount: results.length, ms: Math.round(performance.now() - researchStartTotal) });
      } catch (error) {
        console.error("Failed to search research:", error);
        setResearchResults([]);
      } finally {
        setResearchSearching(false);
      }
    }, 300);

    return () => {
      if (researchSearchTimerRef.current) clearTimeout(researchSearchTimerRef.current);
    };
  }, [mode, open, query]);

  // --- Content search (files mode, FTS5) ---
  const [contentMatches, setContentMatches] = useState<IndexContentSearchResult[]>([]);
  const [contentSearching, setContentSearching] = useState(false);
  const contentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "files" || !open) {
      setContentMatches([]);
      setContentSearching(false);
      return;
    }

    const q = query.trim();
    if (q.length < 2) {
      setContentMatches([]);
      setContentSearching(false);
      return;
    }

    setContentSearching(true);
    if (contentSearchTimerRef.current) clearTimeout(contentSearchTimerRef.current);
    const contentStartTotal = performance.now();
    contentSearchTimerRef.current = setTimeout(async () => {
      contentSearchTimerRef.current = null;
      try {
        const searchPaths = getSearchPaths();
        if (searchPaths.length > 0) {
          const ipcStart = performance.now();
          const matches = await tauriApi.indexSearchContent(searchPaths, q, 50);
          console.log('[perf:palette] ipc', { mode: 'files' as const, ms: Math.round(performance.now() - ipcStart) });
          setContentMatches(matches);
          console.log('[perf:palette]', { mode: 'files' as const, query: q, resultCount: matches.length, ms: Math.round(performance.now() - contentStartTotal) });
        } else {
          setContentMatches([]);
        }
      } catch (error) {
        console.error("Failed to search file content:", error);
        setContentMatches([]);
      } finally {
        setContentSearching(false);
      }
    }, 200);

    return () => {
      if (contentSearchTimerRef.current) clearTimeout(contentSearchTimerRef.current);
    };
  }, [mode, open, query]);

  // --- Workspace files ---
  const recentFiles = useEditorStore(s => s.recentFiles);
  const explorerFolders = useWorkspaceStore(s => s.explorerFolders);
  const projects = useWorkspaceStore(s => s.projects);
  const notesTree = useWorkspaceStore(s => s.notesTree);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const setTheme = useSettingsStore(s => s.setTheme);
  const setSidebarPinned = useSettingsStore(s => s.setSidebarPinned);
  const setChatPanelOpen = useSettingsStore(s => s.setChatPanelOpen);
  const { openFile } = useFileOperations();

  // Helper: find the parent category + folder name for a file path
  const getFileLocation = useMemo(() => {
    const projectPaths = projects.map((p) => p.path);
    const explorerPaths = explorerFolders.map((f) => f.path);
    return (filePath: string): { category: string; name: string } | null => {
      // Check projects first (longest match)
      for (const root of [...projectPaths].sort((a, b) => b.length - a.length)) {
        if (filePath.startsWith(root + '/') || filePath === root) {
          return { category: 'PROJECTS', name: root.split('/').pop() || root };
        }
      }
      // Check explorer folders
      for (const root of [...explorerPaths].sort((a, b) => b.length - a.length)) {
        if (filePath.startsWith(root + '/') || filePath === root) {
          return { category: 'FOLDERS', name: root.split('/').pop() || root };
        }
      }
      // Quick Notes (files from notesTree not in projects or explorer folders)
      return { category: 'QUICK NOTES', name: '' };
    };
  }, [projects, explorerFolders]);

  const allFiles = useMemo(() => {
    const files: FileEntry[] = [];
    const flatten = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (!entry.is_directory) files.push(entry);
        if (entry.children) flatten(entry.children);
      }
    };
    for (const folder of explorerFolders) flatten(folder.fileTree);
    for (const project of projects) flatten(project.fileTree);
    flatten(notesTree);

    const seen = new Set<string>();
    return files.filter((f) => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  }, [explorerFolders, projects, notesTree]);

  const recentPaths = useMemo(
    () => new Set(recentFiles.map((r) => r.path)),
    [recentFiles]
  );

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && mode !== "files") return [];
    const results: FileEntry[] = [];
    for (const file of allFiles) {
      if (recentPaths.has(file.path)) continue;
      if (!q || file.name.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
        results.push(file);
        if (results.length >= MAX_FILE_RESULTS) break;
      }
    }
    return results;
  }, [allFiles, query, recentPaths, mode]);

  // --- Toggle callbacks (read current state at call time to avoid stale closures) ---
  const toggleTheme = useCallback(() => {
    const current = useSettingsStore.getState().theme;
    setTheme(current === "dark" ? "light" : "dark");
  }, [setTheme]);

  const toggleSidebar = useCallback(() => {
    const current = useSettingsStore.getState().sidebarPinned;
    setSidebarPinned(!current);
  }, [setSidebarPinned]);

  const toggleChat = useCallback(() => {
    const current = useSettingsStore.getState().chatPanelOpen;
    setChatPanelOpen(!current);
  }, [setChatPanelOpen]);

  // --- Actions list (for commands mode filtering) ---
  interface Action {
    value: string;
    label: string;
    icon: typeof FilePlus;
    shortcut?: string;
    action: () => void;
    condition?: boolean;
  }

  const actions: Action[] = useMemo(() => [
    { value: "new note", label: "New Note", icon: FilePlus, shortcut: "\u2318N", action: onNewNote },
    { value: "new project", label: "New Project", icon: FolderDot, shortcut: "\u2318\u21E7N", action: onNewProject },
    { value: "open folder", label: "Open Folder", icon: FolderOpen, shortcut: "\u2318O", action: onOpenFolder },
    { value: "export pdf", label: "Export as PDF", icon: FileOutput, shortcut: "\u2318\u21E7E", action: onExportPdf, condition: !!activeTabId },
    { value: "toggle theme dark light", label: "Toggle Theme", icon: SunMoon, shortcut: "\u2318T", action: toggleTheme },
    { value: "toggle sidebar", label: "Toggle Sidebar", icon: PanelLeft, shortcut: "\u2318B", action: toggleSidebar },
    { value: "toggle chat ai", label: "Toggle Chat", icon: MessageSquare, shortcut: "\u2318\u21E7A", action: toggleChat },
    { value: "toggle focus mode distraction free", label: "Toggle Focus Mode", icon: Focus, shortcut: "\u2318.", action: onToggleFocusMode },
    { value: "open settings preferences", label: "Settings", icon: Settings, shortcut: "\u2318,", action: onOpenSettings },
    ...(onOpenActions ? [{ value: "open actions dashboard tasks", label: "Open Actions", icon: CheckSquare, shortcut: "\u23185", action: onOpenActions }] : []),
  ], [activeTabId, onNewNote, onNewProject, onOpenFolder, onExportPdf, toggleTheme, toggleSidebar, toggleChat, onToggleFocusMode, onOpenSettings, onOpenActions]);

  const filteredActions = useMemo(() => {
    if (mode !== "commands") return actions;
    const q = query.trim().toLowerCase();
    return actions.filter((a) => {
      if (a.condition === false) return false;
      return !q || a.value.includes(q) || a.label.toLowerCase().includes(q);
    });
  }, [actions, mode, query]);

  // --- Callbacks ---
  const runAndClose = useCallback((action: () => void) => {
    onOpenChange(false);
    action();
  }, [onOpenChange]);

  const handleOpenFile = useCallback(async (path: string, name: string) => {
    onOpenChange(false);
    try {
      await openFile(path, name);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  }, [onOpenChange, openFile]);

  const handleSymbolSelect = useCallback(async (path: string, name: string, symbol: string, occurrenceInFile: number) => {
    onOpenChange(false);
    try {
      if (onOpenFileAtSymbol) {
        onOpenFileAtSymbol(path, name, symbol, occurrenceInFile);
      } else {
        await openFile(path, name);
      }
    } catch (error) {
      console.error("Failed to open file at symbol:", error);
    }
  }, [onOpenChange, onOpenFileAtSymbol, openFile]);

  const handleOpenResearchFile = useCallback(async (filePath: string) => {
    onOpenChange(false);
    try {
      const name = filePath.split("/").pop() ?? filePath;
      await openFile(filePath, name);
    } catch (error) {
      console.error("Failed to open research file:", error);
    }
  }, [onOpenChange, openFile]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setInput("");
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  // --- Perf: measure synchronous filter time for non-IPC modes ---
  const perfFilterStart = useRef<number>(0);
  const prevModeQuery = useRef<string>("");

  // Capture start time when mode or query changes (synchronous modes only)
  useEffect(() => {
    const key = `${mode}:${query}`;
    if (key !== prevModeQuery.current) {
      prevModeQuery.current = key;
      if (mode === "default" || mode === "commands" || mode === "files") {
        perfFilterStart.current = performance.now();
      }
    }
  }, [mode, query]);

  // Log after render for synchronous modes
  useLayoutEffect(() => {
    if (perfFilterStart.current > 0 && (mode === "default" || mode === "commands")) {
      const resultCount = mode === "commands" ? filteredActions.length : filteredFiles.length + recentFiles.length + actions.length;
      console.log('[perf:palette]', { mode, query, resultCount, ms: Math.round(performance.now() - perfFilterStart.current) });
      perfFilterStart.current = 0;
    }
  }, [mode, query, filteredActions, filteredFiles, recentFiles, actions]);

  // --- Empty state text ---
  const emptyText = useMemo(() => {
    switch (mode) {
      case "research": return "No research files found.";
      case "tags": return "No matching tags.";
      case "mentions": return "No matching mentions.";
      case "commands": return "No commands found.";
      default: return "No results found.";
    }
  }, [mode]);

  // Compute drilldown name for symbol modes — either from prop (badge click) or internal state
  // The SymbolSearchResults component manages its own drilldown state internally,
  // but we pass the external drilldownName prop for the initial auto-drill case.
  const symbolDrilldownName = (mode === "tags" || mode === "mentions") ? drilldownName : undefined;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search for files and actions"
      showCloseButton={false}
      shouldFilter={mode === "default" ? undefined : false}
    >
      <CommandInput
        placeholder={getPlaceholder(mode, allFiles.length, symbolDrilldownName)}
        value={input}
        onValueChange={setInput}
        onFocus={(e) => {
          if (needsCursorFix.current) {
            needsCursorFix.current = false;
            const el = e.target as HTMLInputElement;
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = el.value.length;
            });
          }
        }}
      />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>{emptyText}</CommandEmpty>

        {/* Tags mode */}
        {mode === "tags" && (
          <SymbolSearchResults
            config={tagConfig}
            query={query}
            open={open}
            drilldownName={drilldownName}
            onSelect={handleSymbolSelect}
          />
        )}

        {/* Mentions mode */}
        {mode === "mentions" && (
          <SymbolSearchResults
            config={mentionConfig}
            query={query}
            open={open}
            drilldownName={drilldownName}
            onSelect={handleSymbolSelect}
          />
        )}

        {/* Research mode */}
        {mode === "research" && (researchSearching || researchResults.length > 0) && (
          <CommandGroup heading={query.trim() ? `Research: "${query.trim()}"` : "All Research"}>
            {researchSearching && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!researchSearching && researchResults.map((result, idx) => {
              let domain = "";
              try {
                domain = new URL(result.source_url).hostname;
              } catch {
                // invalid URL
              }
              const wordCountStr = result.word_count > 0
                ? `${result.word_count.toLocaleString()} words`
                : "";
              return (
                <CommandItem
                  key={`research-${result.file}-${idx}`}
                  value={`research ${result.title} ${result.tags.join(" ")} ${result.file}`}
                  onSelect={() => handleOpenResearchFile(result.file)}
                  className="flex-col items-start gap-0.5"
                >
                  <div className="flex items-center gap-2 w-full">
                    <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 truncate font-medium">{result.title}</span>
                  </div>
                  <div className="flex items-center gap-2 w-full pl-6">
                    {result.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {result.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-1.5 py-0 rounded-full bg-muted text-muted-foreground text-[10px] font-medium leading-4"
                          >
                            {tag}
                          </span>
                        ))}
                        {result.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{result.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {domain && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground truncate">
                        <Globe className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                        {domain}
                      </span>
                    )}
                    {wordCountStr && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{wordCountStr}</span>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Commands mode */}
        {mode === "commands" && (
          <CommandGroup heading="Commands">
            {filteredActions.map((action) => {
              if (action.condition === false) return null;
              const Icon = action.icon;
              return (
                <CommandItem
                  key={action.value}
                  value={action.value}
                  onSelect={() => runAndClose(action.action)}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span>{action.label}</span>
                  {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Default mode: Recent files */}
        {mode === "default" && recentFiles.length > 0 && (
          <CommandGroup heading="Recent">
            {recentFiles.map((file) => (
              <CommandItem
                key={`recent-${file.path}`}
                value={`recent ${file.name} ${file.path}`}
                onSelect={() => handleOpenFile(file.path, file.name)}
                title={file.path}
              >
                <Clock className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{file.name}</span>
                {(() => {
                  const loc = getFileLocation(file.path);
                  if (!loc) return null;
                  return (
                    <span className="text-[10px] text-muted-foreground shrink-0 tracking-wide">
                      {loc.category}{loc.name ? ` : ${loc.name}` : ''}
                    </span>
                  );
                })()}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {mode === "default" && recentFiles.length > 0 && <CommandSeparator />}

        {/* Default mode: Actions */}
        {mode === "default" && (
          <CommandGroup heading="Actions">
            {actions.map((action) => {
              if (action.condition === false) return null;
              const Icon = action.icon;
              return (
                <CommandItem
                  key={action.value}
                  value={action.value}
                  onSelect={() => runAndClose(action.action)}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span>{action.label}</span>
                  {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Default + Files mode: File results */}
        {(mode === "default" || mode === "files") && filteredFiles.length > 0 && (
          <>
            {mode === "default" && <CommandSeparator />}
            <CommandGroup heading="Files">
              {filteredFiles.map((file) => (
                <CommandItem
                  key={`file-${file.path}`}
                  value={`file ${file.name} ${file.path}`}
                  onSelect={() => handleOpenFile(file.path, file.name)}
                  title={file.path}
                >
                  <File className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{file.name}</span>
                  {(() => {
                    const loc = getFileLocation(file.path);
                    if (!loc) return null;
                    return (
                      <span className="text-[10px] text-muted-foreground shrink-0 tracking-wide">
                        {loc.category}{loc.name ? ` : ${loc.name}` : ''}
                      </span>
                    );
                  })()}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Files mode: Content matches */}
        {mode === "files" && (contentSearching || contentMatches.length > 0) && (
          <>
            <CommandSeparator />
            <CommandGroup heading={
              contentSearching
                ? "Searching content..."
                : `Content Matches (${contentMatches.length})`
            }>
              {contentSearching && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!contentSearching && contentMatches.map((match, idx) => (
                <CommandItem
                  key={`content-${match.path}-${idx}`}
                  value={`content ${match.file_name} ${match.path} ${match.snippet}`}
                  onSelect={() => handleOpenFile(match.path, match.file_name)}
                  className="flex-col items-start gap-0.5"
                >
                  <div className="flex items-center gap-2 w-full">
                    <FileText className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 truncate">{match.title || match.file_name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate w-full pl-6">
                    {match.snippet.split(/<b>|<\/b>/).map((part, i) =>
                      i % 2 === 1
                        ? <span key={i} className="font-bold text-foreground">{part}</span>
                        : part
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>

      {/* Footer hints */}
      <div className="flex items-center justify-between px-3 h-8 border-t border-border bg-muted text-muted-foreground text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">&#8629;</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">esc</kbd> close
          </span>
        </div>
        <div className="flex items-center gap-3">
          {mode === "default" ? (
            <>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">#</kbd>
                <span>tags</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">@</kbd>
                <span>mentions</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">&gt;</kbd>
                <span>commands</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">?</kbd>
                <span>research</span>
              </span>
            </>
          ) : mode !== "files" ? (
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">&#9003;</kbd>
              <span>back to search</span>
            </span>
          ) : null}
        </div>
      </div>
    </CommandDialog>
  );
}
