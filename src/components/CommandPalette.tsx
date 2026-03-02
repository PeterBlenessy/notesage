import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  File,
  FilePlus,
  FolderDot,
  Hash,
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
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileEntry, TagOccurrence, ContentMatch, tauriApi } from "@/lib/tauri";

const MAX_FILE_RESULTS = 50;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewNote: () => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onExportPdf: () => void;
  onToggleFocusMode: () => void;
  /** When true, show only file search (no actions/recent). Used by ⌘⇧F. */
  filesOnly?: boolean;
  /** Pre-fill search input when palette opens (e.g. from tag badge click). */
  initialSearch?: string;
  /** Pre-filtered file paths to show (e.g. files containing a tag). */
  tagFiles?: { path: string; name: string }[];
  /** Individual tag occurrences with line numbers and snippets. */
  tagOccurrences?: TagOccurrence[];
  /** Callback to open a file at a specific tag occurrence. */
  onOpenFileAtTag?: (path: string, name: string, tag: string, occurrence: number) => void;
  /** When true, palette is in direct tag search mode (⌘#). User types a tag name
   *  and occurrences are fetched via debounced backend call. */
  tagSearchMode?: boolean;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewNote,
  onNewProject,
  onOpenFolder,
  onOpenSettings,
  onExportPdf,
  onToggleFocusMode,
  filesOnly,
  initialSearch,
  tagFiles,
  tagOccurrences,
  onOpenFileAtTag,
  tagSearchMode,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");

  // Direct tag search state (⌘#): debounced backend call as user types
  const [liveTagOccurrences, setLiveTagOccurrences] = useState<TagOccurrence[]>([]);
  const [liveTagQuery, setLiveTagQuery] = useState("");
  const tagSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill search when initialSearch prop is provided
  useEffect(() => {
    if (open && initialSearch) {
      setSearch(initialSearch);
    }
  }, [open, initialSearch]);

  // Debounced tag occurrence search for ⌘# mode
  useEffect(() => {
    if (!tagSearchMode || !open) {
      setLiveTagOccurrences([]);
      setLiveTagQuery("");
      return;
    }

    const q = search.trim();
    if (!q) {
      setLiveTagOccurrences([]);
      setLiveTagQuery("");
      return;
    }

    if (tagSearchTimerRef.current) clearTimeout(tagSearchTimerRef.current);
    tagSearchTimerRef.current = setTimeout(async () => {
      tagSearchTimerRef.current = null;
      try {
        const ws = useWorkspaceStore.getState();
        const settings = useSettingsStore.getState();
        const paths: string[] = [];
        for (const folder of ws.explorerFolders) paths.push(folder.path);
        for (const project of ws.projects) paths.push(project.path);
        if (settings.notesRootPath) paths.push(settings.notesRootPath);
        if (paths.length > 0) {
          const occurrences = await tauriApi.findTagOccurrences(q, paths);
          setLiveTagOccurrences(occurrences);
          setLiveTagQuery(q);
        }
      } catch (error) {
        console.error("Failed to search tags:", error);
      }
    }, 300);

    return () => {
      if (tagSearchTimerRef.current) clearTimeout(tagSearchTimerRef.current);
    };
  }, [tagSearchMode, open, search]);

  // Content search state (filesOnly mode): debounced backend call for grep-like search
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const [contentSearching, setContentSearching] = useState(false);
  const contentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced file content search for filesOnly mode (⌘⇧F)
  useEffect(() => {
    if (!filesOnly || !open || tagSearchMode) {
      setContentMatches([]);
      setContentSearching(false);
      return;
    }

    const q = search.trim();
    if (q.length < 3) {
      setContentMatches([]);
      setContentSearching(false);
      return;
    }

    setContentSearching(true);
    if (contentSearchTimerRef.current) clearTimeout(contentSearchTimerRef.current);
    contentSearchTimerRef.current = setTimeout(async () => {
      contentSearchTimerRef.current = null;
      try {
        const ws = useWorkspaceStore.getState();
        const settings = useSettingsStore.getState();
        const searchPaths: string[] = [];
        for (const folder of ws.explorerFolders) searchPaths.push(folder.path);
        for (const project of ws.projects) searchPaths.push(project.path);
        if (settings.notesRootPath) searchPaths.push(settings.notesRootPath);
        if (searchPaths.length > 0) {
          const matches = await tauriApi.searchFileContent(q, searchPaths);
          setContentMatches(matches);
        } else {
          setContentMatches([]);
        }
      } catch (error) {
        console.error("Failed to search file content:", error);
        setContentMatches([]);
      } finally {
        setContentSearching(false);
      }
    }, 300);

    return () => {
      if (contentSearchTimerRef.current) clearTimeout(contentSearchTimerRef.current);
    };
  }, [filesOnly, open, search, tagSearchMode]);

  const { recentFiles, activeTabId } = useEditorStore();
  const { explorerFolders, projects, notesTree } = useWorkspaceStore();
  const { theme, setTheme, sidebarPinned, setSidebarPinned, chatPanelOpen, setChatPanelOpen } = useSettingsStore();
  const { openFile } = useFileOperations();

  // Flatten all workspace files (memoized on tree changes, not on every keystroke)
  const allFiles = useMemo(() => {
    const files: FileEntry[] = [];

    const flatten = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (!entry.is_directory) {
          files.push(entry);
        }
        if (entry.children) {
          flatten(entry.children);
        }
      }
    };

    for (const folder of explorerFolders) {
      flatten(folder.fileTree);
    }
    for (const project of projects) {
      flatten(project.fileTree);
    }
    flatten(notesTree);

    // Deduplicate by path
    const seen = new Set<string>();
    return files.filter((f) => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  }, [explorerFolders, projects, notesTree]);

  // Recent file paths for exclusion from "Go to File"
  const recentPaths = useMemo(
    () => new Set(recentFiles.map((r) => r.path)),
    [recentFiles]
  );

  // Only compute filtered file results when user is actually searching
  // (or in filesOnly mode where files are always shown).
  // This avoids rendering thousands of DOM nodes on initial palette open.
  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && !filesOnly) return [];
    const results: FileEntry[] = [];
    for (const file of allFiles) {
      if (recentPaths.has(file.path)) continue;
      if (!q || file.name.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
        results.push(file);
        if (results.length >= MAX_FILE_RESULTS) break;
      }
    }
    return results;
  }, [allFiles, search, recentPaths, filesOnly]);

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

  const handleOpenAtTag = useCallback(async (path: string, name: string, tag: string, occurrence: number) => {
    onOpenChange(false);
    try {
      if (onOpenFileAtTag) {
        onOpenFileAtTag(path, name, tag, occurrence);
      } else {
        await openFile(path, name);
      }
    } catch (error) {
      console.error("Failed to open file at tag:", error);
    }
  }, [onOpenChange, onOpenFileAtTag, openFile]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setSearch("");
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search for files and actions"
      showCloseButton={false}
      shouldFilter={tagSearchMode || tagOccurrences || tagFiles || filesOnly ? false : undefined}
    >
      <CommandInput
        placeholder={
          tagSearchMode
            ? "Type a tag name to search..."
            : filesOnly
              ? `Search ${allFiles.length.toLocaleString()} files by name or content...`
              : allFiles.length > 0
                ? `Type a command or search ${allFiles.length.toLocaleString()} files...`
                : "Type a command or file name..."
        }
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>{tagSearchMode && !search.trim() ? "Type a tag name to search." : "No results found."}</CommandEmpty>

        {/* Direct tag search results (⌘# mode) */}
        {tagSearchMode && liveTagOccurrences.length > 0 && (
          <CommandGroup heading={`#${liveTagQuery}`}>
            {liveTagOccurrences.map((occ, idx) => (
              <CommandItem
                key={`live-occ-${occ.path}-${occ.line_number}-${idx}`}
                value={`tag ${occ.file_name} ${occ.path} ${occ.snippet}`}
                onSelect={() => handleOpenAtTag(occ.path, occ.file_name, liveTagQuery, occ.occurrence_in_file)}
                className="flex-col items-start gap-0.5"
              >
                <div className="flex items-center gap-2 w-full">
                  <Hash className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{occ.file_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">:{occ.line_number}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate w-full pl-6">{occ.snippet}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Tag occurrence results from badge click (with line numbers and snippets) */}
        {!tagSearchMode && tagOccurrences && tagOccurrences.length > 0 && (
          <CommandGroup heading={`#${initialSearch ?? ""}`}>
            {tagOccurrences.map((occ, idx) => (
              <CommandItem
                key={`occ-${occ.path}-${occ.line_number}-${idx}`}
                value={`tag ${occ.file_name} ${occ.path} ${occ.snippet}`}
                onSelect={() => handleOpenAtTag(occ.path, occ.file_name, initialSearch ?? "", occ.occurrence_in_file)}
                className="flex-col items-start gap-0.5"
              >
                <div className="flex items-center gap-2 w-full">
                  <Hash className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{occ.file_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">:{occ.line_number}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate w-full pl-6">{occ.snippet}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Tag file results (fallback when occurrences not available) */}
        {!tagOccurrences && tagFiles && tagFiles.length > 0 && (
          <CommandGroup heading={`Files with #${initialSearch ?? ""}`}>
            {tagFiles.map((file) => (
              <CommandItem
                key={`tag-${file.path}`}
                value={`tag ${file.name} ${file.path}`}
                onSelect={() => handleOpenFile(file.path, file.name)}
              >
                <Hash className="h-4 w-4" strokeWidth={1.5} />
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {file.path}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Recent Files */}
        {!tagSearchMode && !tagOccurrences && !tagFiles && recentFiles.length > 0 && (
          <CommandGroup heading="Recent">
            {recentFiles.map((file) => (
              <CommandItem
                key={`recent-${file.path}`}
                value={`recent ${file.name} ${file.path}`}
                onSelect={() => handleOpenFile(file.path, file.name)}
              >
                <Clock className="h-4 w-4" strokeWidth={1.5} />
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {file.path}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!tagSearchMode && !tagOccurrences && !tagFiles && recentFiles.length > 0 && <CommandSeparator />}

        {/* Actions — hidden in filesOnly mode */}
        {!filesOnly && <CommandGroup heading="Actions">
          <CommandItem
            value="new note"
            onSelect={() => runAndClose(onNewNote)}
          >
            <FilePlus className="h-4 w-4" strokeWidth={1.5} />
            <span>New Note</span>
            <CommandShortcut>&#8984;N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="new project"
            onSelect={() => runAndClose(onNewProject)}
          >
            <FolderDot className="h-4 w-4" strokeWidth={1.5} />
            <span>New Project</span>
            <CommandShortcut>&#8984;&#8679;N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="open folder"
            onSelect={() => runAndClose(onOpenFolder)}
          >
            <FolderOpen className="h-4 w-4" strokeWidth={1.5} />
            <span>Open Folder</span>
            <CommandShortcut>&#8984;O</CommandShortcut>
          </CommandItem>
          {activeTabId && (
            <CommandItem
              value="export pdf"
              onSelect={() => runAndClose(onExportPdf)}
            >
              <FileOutput className="h-4 w-4" strokeWidth={1.5} />
              <span>Export as PDF</span>
              <CommandShortcut>&#8984;&#8679;E</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem
            value="toggle theme dark light"
            onSelect={() =>
              runAndClose(() => setTheme(theme === "dark" ? "light" : "dark"))
            }
          >
            <SunMoon className="h-4 w-4" strokeWidth={1.5} />
            <span>Toggle Theme</span>
            <CommandShortcut>&#8984;T</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle sidebar"
            onSelect={() => runAndClose(() => setSidebarPinned(!sidebarPinned))}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
            <span>Toggle Sidebar</span>
            <CommandShortcut>&#8984;B</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle chat ai"
            onSelect={() =>
              runAndClose(() => setChatPanelOpen(!chatPanelOpen))
            }
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.5} />
            <span>Toggle Chat</span>
            <CommandShortcut>&#8984;&#8679;A</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle focus mode distraction free"
            onSelect={() => runAndClose(onToggleFocusMode)}
          >
            <Focus className="h-4 w-4" strokeWidth={1.5} />
            <span>Toggle Focus Mode</span>
            <CommandShortcut>&#8984;.</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="open settings preferences"
            onSelect={() => runAndClose(onOpenSettings)}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
            <span>Settings</span>
            <CommandShortcut>&#8984;,</CommandShortcut>
          </CommandItem>
        </CommandGroup>}

        {/* Go to File — hidden when tag results are shown (tag mode shows only tag hits) */}
        {!tagSearchMode && !tagOccurrences && !tagFiles && filteredFiles.length > 0 && (
          <>
            {!filesOnly && <CommandSeparator />}
            <CommandGroup heading="Files">
              {filteredFiles.map((file) => (
                <CommandItem
                  key={`file-${file.path}`}
                  value={`file ${file.name} ${file.path}`}
                  onSelect={() => handleOpenFile(file.path, file.name)}
                >
                  <File className="h-4 w-4" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {file.path}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Content Matches — grep-like results in filesOnly mode */}
        {filesOnly && !tagSearchMode && (contentSearching || contentMatches.length > 0) && (
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
                  key={`content-${match.path}-${match.line_number}-${idx}`}
                  value={`content ${match.file_name} ${match.path} ${match.snippet}`}
                  onSelect={() => handleOpenFile(match.path, match.file_name)}
                  className="flex-col items-start gap-0.5"
                >
                  <div className="flex items-center gap-2 w-full">
                    <FileText className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 truncate">{match.file_name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">:{match.line_number}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate w-full pl-6">{match.snippet}</span>
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
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">&#8593;&#8595;</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">&#8629;</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-sm border border-border bg-background font-mono text-xs shadow-[0_1px_0_0_var(--color-border)]">esc</kbd> close
          </span>
        </div>
      </div>
    </CommandDialog>
  );
}
