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
