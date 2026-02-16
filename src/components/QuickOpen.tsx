import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, File } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileEntry } from "@/lib/tauri";

interface QuickOpenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickOpen({ open, onOpenChange }: QuickOpenProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { explorerTree, projects, notesTree } = useWorkspaceStore();
  const { openFile } = useFileOperations();

  // Flatten all file trees to get all files
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

    flatten(explorerTree);
    for (const project of projects) {
      flatten(project.fileTree);
    }
    flatten(notesTree);

    // Deduplicate by path (a file might appear in both explorer and a project)
    const seen = new Set<string>();
    return files.filter((f) => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  }, [explorerTree, projects, notesTree]);

  // Filter files based on search
  const filteredFiles = useMemo(() => {
    if (!search) return allFiles;

    const searchLower = search.toLowerCase();
    return allFiles.filter((file) => {
      return (
        file.name.toLowerCase().includes(searchLower) ||
        file.path.toLowerCase().includes(searchLower)
      );
    });
  }, [allFiles, search]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredFiles]);

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filteredFiles.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const file = filteredFiles[selectedIndex];
      if (file) {
        handleSelectFile(file);
      }
    }
  };

  const handleSelectFile = async (file: FileEntry) => {
    try {
      await openFile(file.path, file.name);
      onOpenChange(false);
    } catch (error) {
      alert(`Failed to open file: ${error}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 h-12 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-muted-foreground)' }} />
          <input
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50"
            style={{ color: 'var(--color-foreground)' }}
          />
          {search && (
            <span className="text-[11px] shrink-0" style={{ color: 'var(--color-muted-foreground)' }}>
              {filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filteredFiles.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--color-muted-foreground)' }}>
                {allFiles.length === 0
                  ? "No files in workspace"
                  : "No files match your search"}
              </p>
            </div>
          ) : (
            filteredFiles.map((file, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={file.path}
                  onClick={() => handleSelectFile(file)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors mx-1"
                  style={{
                    width: 'calc(100% - 8px)',
                    borderRadius: '6px',
                    backgroundColor: isSelected ? 'var(--color-accent)' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    setSelectedIndex(index);
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '';
                  }}
                >
                  <File className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-muted-foreground)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--color-foreground)' }}>
                      {file.name}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--color-muted-foreground)' }}>
                      {file.path}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div
          className="flex items-center justify-between px-4 h-8 border-t text-[11px]"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-muted)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono">↵</kbd> open
            </span>
            <span>
              <kbd className="font-mono">esc</kbd> close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
