import { ChevronRight, Folder, FileText, FileImage, FileType, File } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Classify a file by extension for icon + viewer routing. */
export function classifyFile(name: string): "markdown" | "image" | "text" | "pdf" | "doc" | "other" {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["epub", "docx", "pptx"].includes(ext)) return "doc";
  // Treated as readable text (code files, txt, csv, json, yaml, etc.)
  if (
    [
      "txt", "text", "log", "csv", "json", "yaml", "yml", "toml", "xml", "html", "htm",
      "css", "js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "h", "sh",
      "sql", "swift", "kt", "rb", "php",
    ].includes(ext)
  ) {
    return "text";
  }
  return "other";
}

function iconFor(entry: FileEntry) {
  if (entry.is_directory) return Folder;
  switch (classifyFile(entry.name)) {
    case "markdown":
      return FileText;
    case "image":
      return FileImage;
    case "pdf":
    case "doc":
      return FileType;
    case "text":
      return FileText;
    default:
      return File;
  }
}

interface FileRowProps {
  entry: FileEntry;
  active?: boolean;
  onActivate: (entry: FileEntry) => void;
}

/** A single tappable row in the mobile library browser. */
export function FileRow({ entry, active, onActivate }: FileRowProps) {
  const Icon = iconFor(entry);
  return (
    <button
      type="button"
      onClick={() => onActivate(entry)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        "border-b border-border last:border-b-0",
        "active:bg-muted/70 hover:bg-muted/50",
        active && "bg-muted",
      )}
    >
      <Icon
        strokeWidth={1.5}
        className={cn(
          "h-5 w-5 shrink-0",
          active ? "text-[var(--color-accent-primary)]" : "text-muted-foreground",
          entry.hidden && "opacity-50",
        )}
      />
      <span
        className={cn(
          "flex-1 truncate text-sm",
          active ? "font-medium text-foreground" : "text-foreground",
          entry.hidden && "opacity-60",
        )}
      >
        {entry.name}
      </span>
      {entry.is_directory && (
        <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
