import { FileText } from "lucide-react";

interface PdfPlaceholderProps {
  fileName: string;
}

export function PdfPlaceholder({ fileName }: PdfPlaceholderProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <FileText className="h-16 w-16" strokeWidth={1} />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">{fileName}</p>
        <p className="text-xs">PDF viewer coming soon</p>
      </div>
    </div>
  );
}
