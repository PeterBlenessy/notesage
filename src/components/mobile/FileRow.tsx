import { ChevronRight, Folder, FileText, FileImage, FileType, FileCode, File } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Classify a file by extension for icon + viewer routing. */
export function classifyFile(
  name: string,
): "markdown" | "image" | "text" | "pdf" | "doc" | "html" | "other" {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["epub", "docx", "pptx"].includes(ext)) return "doc";
  // Rendered, not shown as source: exported reports are self-contained HTML
  // whose charts and interactivity are inline scripts. iOS Files shows them as
  // markup with scripts disabled, which is the gap this reader closes.
  if (ext === "html" || ext === "htm") return "html";
  // Treated as readable text (code files, txt, csv, json, yaml, etc.)
  if (
    [
      "txt", "text", "log", "csv", "json", "yaml", "yml", "toml", "xml",
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
    case "html":
      return FileCode;
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
        "ios-press-row flex w-full items-center gap-3 px-4 py-3 text-left",
        "border-b border-border last:border-b-0",
        "hover:bg-muted/50",
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
          "flex-1 truncate text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground",
          entry.hidden && "opacity-60",
        )}
        style={{
          fontWeight: active
            ? "max(500, var(--ns-a11y-weight, 400))"
            : "var(--ns-a11y-weight, 400)",
        }}
      >
        {entry.name}
      </span>
      {entry.is_directory && (
        <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
