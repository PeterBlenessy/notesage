import { useCallback, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Link, Unlink, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isExternalUrl, isLocalFilePath, searchWorkspaceFiles } from "@/lib/link-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";

export function LinkButton({ editor }: { editor: Editor }) {
  const isLink = editor.isActive("link");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const activeFileDir = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    if (!tab?.filePath) return undefined;
    const parts = tab.filePath.split('/');
    parts.pop();
    return parts.join('/');
  });

  const trees = useMemo(() => [
    ...projects.map((p) => ({
      rootPath: p.path,
      name: p.path.split('/').pop() || p.path,
      fileTree: p.fileTree,
    })),
    ...explorerFolders.map((f) => ({
      rootPath: f.path,
      name: f.path.split('/').pop() || f.path,
      fileTree: f.fileTree,
    })),
  ], [projects, explorerFolders]);

  const isUrlInput = useMemo(() => {
    const trimmed = url.trim();
    return !trimmed || isExternalUrl(trimmed) || /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
  }, [url]);

  const searchResults = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed || isUrlInput) return [];
    return searchWorkspaceFiles(trimmed, trees, activeFileDir);
  }, [url, isUrlInput, trees, activeFileDir]);

  const handleOpen = useCallback(() => {
    if (isLink) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    setUrl(editor.getAttributes("link").href || "");
    setSelectedIndex(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [editor, isLink]);

  const applyLink = useCallback((href: string, displayText?: string) => {
    const finalHref = isExternalUrl(href) || isLocalFilePath(href) ? href : `https://${href}`;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      editor.chain().focus().setLink({ href: finalHref }).run();
    } else {
      const text = displayText || href;
      editor.chain().focus().insertContent({
        type: "text",
        marks: [{ type: "link", attrs: { href: finalHref } }],
        text,
      }).run();
    }
    setOpen(false);
    setUrl("");
    setSelectedIndex(0);
  }, [editor]);

  const handleSubmit = useCallback(() => {
    const raw = url.trim();
    if (!raw) {
      setOpen(false);
      return;
    }

    // If there are search results and one is selected, use it
    if (searchResults.length > 0 && selectedIndex < searchResults.length) {
      const result = searchResults[selectedIndex];
      const nameWithoutExt = result.name.replace(/\.[^.]+$/, '');
      applyLink(result.relativePath, nameWithoutExt);
      return;
    }

    applyLink(raw);
  }, [url, searchResults, selectedIndex, applyLink]);

  const selectResult = useCallback((index: number) => {
    const result = searchResults[index];
    if (!result) return;
    const nameWithoutExt = result.name.replace(/\.[^.]+$/, '');
    applyLink(result.relativePath, nameWithoutExt);
  }, [searchResults, applyLink]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (searchResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
    }
  }, [searchResults.length, handleSubmit]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 w-6 p-0 text-muted-foreground transition-colors duration-150",
                isLink && "bg-[var(--color-accent-primary)]/12 text-foreground"
              )}
              onClick={(e) => {
                if (isLink) {
                  e.preventDefault();
                  handleOpen();
                }
              }}
              title={isLink ? "Remove link" : "Insert link"}
            >
              {isLink ? (
                <Unlink className="size-4" strokeWidth={1.5} />
              ) : (
                <Link className="size-4" strokeWidth={1.5} />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {isLink ? "Remove link" : "Insert link"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-80 p-2"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search documents or paste URL..."
            className="flex-1 h-7 px-2 text-xs rounded-md border border-input bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSubmit}>
            Apply
          </Button>
        </div>
        {searchResults.length > 0 && (
          <div ref={listRef} className="mt-1.5 max-h-48 overflow-y-auto thin-scrollbar">
            {searchResults.map((result, i) => {
              const parentFolder = result.absolutePath.split('/').slice(-2, -1)[0] || result.project;
              return (
                <button
                  key={result.absolutePath}
                  className={cn(
                    "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100",
                    i === selectedIndex ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "hover:bg-accent/50"
                  )}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => selectResult(i)}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <span className="truncate font-medium">{result.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-muted-foreground truncate">
                    <FolderOpen className="size-3 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{parentFolder}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
