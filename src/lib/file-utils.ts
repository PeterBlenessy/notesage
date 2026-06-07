import { isCodeFile } from "@/lib/codemirror-languages";

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

/**
 * Map a file to a low-cardinality telemetry document format (document_opened).
 * Derives from the resolved `FileType` plus a code-file check on the name so
 * `.ts`/`.py`/etc. report `code` while plain `.txt`/`.log` report `text`.
 * Pure — no DOM, no PII (format, not path).
 */
export function documentFormat(
  fileName: string,
  fileType: FileType,
): "md" | "epub" | "pdf" | "docx" | "pptx" | "code" | "image" | "text" {
  switch (fileType) {
    case "markdown":
      return "md";
    case "epub":
      return "epub";
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "pptx":
      return "pptx";
    case "image":
      return "image";
    default:
      return isCodeFile(fileName) ? "code" : "text";
  }
}
