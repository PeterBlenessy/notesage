import { FileSpreadsheet } from "lucide-react";

interface DocxPlaceholderProps {
  fileName: string;
}

export function DocxPlaceholder({ fileName }: DocxPlaceholderProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <FileSpreadsheet className="h-16 w-16" strokeWidth={1} />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">{fileName}</p>
        <p className="text-xs">DOCX viewer coming soon</p>
      </div>
    </div>
  );
}
