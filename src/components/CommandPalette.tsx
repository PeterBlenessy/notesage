import { useState, useMemo, useCallback } from "react";
import {
  File,
  FilePlus,
  FolderDot,
  FolderOpen,
  FileOutput,
  SunMoon,
  PanelLeft,
  MessageSquare,
  Settings,
  Clock,
  Focus,
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
import { FileEntry } from "@/lib/tauri";

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
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
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
      if (!filesOnly && recentPaths.has(file.path)) continue;
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
    >
      <CommandInput
        placeholder={
          filesOnly
            ? `Search ${allFiles.length.toLocaleString()} files...`
            : allFiles.length > 0
              ? `Type a command or search ${allFiles.length.toLocaleString()} files...`
              : "Type a command or file name..."
        }
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Recent Files — hidden in filesOnly mode */}
        {!filesOnly && recentFiles.length > 0 && (
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

        {!filesOnly && recentFiles.length > 0 && <CommandSeparator />}

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

        {/* Go to File — only rendered when searching (or always in filesOnly mode) */}
        {filteredFiles.length > 0 && (
          <>
            {!filesOnly && <CommandSeparator />}
            <CommandGroup heading={filesOnly ? undefined : "Files"}>
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
