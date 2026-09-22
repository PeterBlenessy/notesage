import type { FileEntry } from "@/lib/tauri";

/**
 * Recursively count files (not directories) in a FileEntry tree.
 *
 * Shared rather than duplicated because two perf metrics report a file count
 * and they must mean the same thing: `[perf:tree] list` counts this way, while
 * `[perf:startup] trees validated` used to report `explorerFolders.length +
 * projects.length` under the name `totalFiles` — 16, on a launch that had
 * ~3,254 files. See the v0.60.2 entry in docs/performance-baseline.md.
 */
export function countFiles(entries: FileEntry[] | undefined): number {
  if (!entries) return 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.is_directory) {
      if (entry.children) count += countFiles(entry.children);
    } else {
      count += 1;
    }
  }
  return count;
}

export type FileType = "markdown" | "pdf" | "docx" | "epub" | "pptx" | "image" | "other";
export type ViewMode = "wysiwyg" | "source";

const EXTENSION_MAP: Record<string, FileType> = {
  // Markdown
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  // PDF
  pdf: "pdf",
  // Word
  docx: "docx",
  doc: "docx",
  // EPUB
  epub: "epub",
  // PowerPoint
  pptx: "pptx",
  ppt: "pptx",
  // Images
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  // Text
  log: "other",
  txt: "other",
};

/**
 * Determine the file type from a file name or path based on its extension.
 */
export function getFileType(fileName: string): FileType {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "other";
}

/**
 * Returns true if the file type requires binary reading (not UTF-8 text).
 */
export function isBinaryFileType(fileType: FileType): boolean {
  return fileType === "pdf" || fileType === "docx" || fileType === "epub" || fileType === "pptx" || fileType === "image";
}

