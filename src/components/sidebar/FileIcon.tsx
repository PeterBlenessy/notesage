import {
  File,
  FileText,
  FileCode,
  FileImage,
  FileSpreadsheet,
  Presentation,
  BookOpen,
  FileJson,
  FileTerminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
  // Markdown
  md: FileText,
  markdown: FileText,
  mdx: FileText,
  // PDF
  pdf: File,
  // Word
  doc: FileText,
  docx: FileText,
  // EPUB
  epub: BookOpen,
  // PowerPoint
  ppt: Presentation,
  pptx: Presentation,
  // Spreadsheets
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  // Images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  bmp: FileImage,
  ico: FileImage,
  avif: FileImage,
  // Code — web
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  html: FileCode,
  css: FileCode,
  scss: FileCode,
  // Code — data
  json: FileJson,
  yaml: FileJson,
  yml: FileJson,
  toml: FileJson,
  xml: FileCode,
  // Code — languages
  rs: FileCode,
  go: FileCode,
  py: FileCode,
  rb: FileCode,
  java: FileCode,
  kt: FileCode,
  swift: FileCode,
  c: FileCode,
  cpp: FileCode,
  h: FileCode,
  php: FileCode,
  sql: FileCode,
  // Shell / config
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
};

interface FileIconProps {
  fileName: string;
  className?: string;
}

export function FileIcon({ fileName, className }: FileIconProps) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ICON_MAP[ext] ?? File;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/70", className)} strokeWidth={1.5} />;
}
