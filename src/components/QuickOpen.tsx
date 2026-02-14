import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { File } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface QuickOpenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickOpen({ open, onOpenChange }: QuickOpenProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { fileTree, rootPath } = useProjectStore();
  const { openFile } = useFileOperations();

  // Flatten the file tree to get all files
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

    flatten(fileTree);
    return files;
  }, [fileTree]);

  // Filter files based on search
  const filteredFiles = useMemo(() => {
    if (!search) return allFiles;

    const searchLower = search.toLowerCase();
    return allFiles.filter((file) => {
      // Simple fuzzy match: file name or path contains search term
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

  const getRelativePath = (path: string) => {
    if (!rootPath) return path;
    return path.replace(rootPath + "/", "");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0">
        <div className="p-4 border-b border-border">
          <Input
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {filteredFiles.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {allFiles.length === 0
                ? "No files in project"
                : "No files match your search"}
            </div>
          ) : (
            filteredFiles.map((file, index) => (
              <button
                key={file.path}
                onClick={() => handleSelectFile(file)}
                className={cn(
                  "w-full text-left px-4 py-2 flex items-center gap-3 transition-colors",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getRelativePath(file.path)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-2 border-t border-border bg-muted/50 text-xs text-muted-foreground flex items-center justify-between">
          <span>Use ↑↓ to navigate, Enter to open, Esc to close</span>
          <span>{filteredFiles.length} files</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
